import type { SiteSettings } from './siteSettings';

// Prefers the admin's pasted Google Maps share link; falls back to one
// generated from the Address setting (no Maps API key needed either way).
// Shared between the landing page and the customer confirmation email so
// both link to the same place.
export function getDirectionsUrl(settings: Pick<SiteSettings, 'landing_google_maps_url' | 'landing_address'>): string | null {
  if (settings.landing_google_maps_url) return settings.landing_google_maps_url;
  if (settings.landing_address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(settings.landing_address)}`;
  }
  return null;
}

// The pasted share link (the admin UI's placeholder asks for a
// maps.app.goo.gl link specifically) is a short redirect link, not an
// embeddable URL — Google blocks that shortener domain from being framed,
// so dropping it straight into an <iframe src> shows a blank box. Resolving
// the redirect server-side first (only ever called from the landing page's
// Server Component, never the browser, so no CORS concerns) gets the real
// google.com/maps/place/... URL — but that page itself sends
// `X-Frame-Options: SAMEORIGIN`, which still blocks it from being framed on
// our domain even with `output=embed` appended. The one form confirmed (by
// checking response headers directly) to omit that header is the plain
// `/maps?q=<lat,lng>&output=embed` query form, so the resolved URL's
// coordinates get extracted and re-embedded in that form instead of being
// used as-is. Falls back to null on any failure so the caller can fall
// back to the address-based embed instead of breaking the page.
async function resolveGoogleMapsEmbedUrl(shareUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(shareUrl, { redirect: 'follow', signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;

    const match = response.url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (!match) return null;

    const [, lat, lng] = match;
    return `https://www.google.com/maps?q=${lat},${lng}&output=embed`;
  } catch (err) {
    console.error('Could not resolve Google Maps share link for embedding:', err);
    return null;
  }
}

// For the landing page's embedded map preview — distinct from
// getDirectionsUrl above, which is fine to point straight at the raw share
// link since a normal click/navigation follows redirects with no framing
// involved.
export async function getMapsEmbedUrl(
  settings: Pick<SiteSettings, 'landing_google_maps_url' | 'landing_address'>
): Promise<string | null> {
  if (settings.landing_google_maps_url) {
    const resolved = await resolveGoogleMapsEmbedUrl(settings.landing_google_maps_url);
    if (resolved) return resolved;
  }
  if (settings.landing_address) {
    return `https://www.google.com/maps?q=${encodeURIComponent(settings.landing_address)}&output=embed`;
  }
  return null;
}
