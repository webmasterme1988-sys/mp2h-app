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
