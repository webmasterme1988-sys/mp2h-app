import Script from 'next/script';
import { createPublicServerClient } from '@/lib/supabase/publicServerClient';
import { fetchSiteSettings } from '@/lib/siteSettings';
import { fetchLandingPhotos } from '@/lib/landingPhotos';
import { formatHourLabel } from '@/lib/timeSlots';
import { getDirectionsUrl } from '@/lib/googleMaps';
import GalleryLightbox from '@/components/GalleryLightbox';
import {
  FacebookIcon,
  InstagramIcon,
  TiktokIcon,
  YoutubeIcon,
  TwitterIcon,
  WhatsappIcon,
} from '@/components/SocialIcons';

// Content here (about/policy text, photos, contact info) is admin-editable
// and must reflect changes on the next load, not just after a rebuild.
export const dynamic = 'force-dynamic';

interface Court {
  id: string;
  name: string;
  image_url: string | null;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatOpenDays(openDays: number[]) {
  if (openDays.length === 7) return 'Every day';
  return [...openDays].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d]).join(', ');
}

export default async function LandingPage() {
  const supabase = createPublicServerClient();

  const [settings, photos, courtsResult] = await Promise.all([
    fetchSiteSettings(supabase),
    fetchLandingPhotos(supabase),
    supabase.from('courts').select('id, name, image_url').order('id'),
  ]);

  const courts = (courtsResult.data ?? []) as Court[];
  const tagline = settings.landing_tagline || settings.site_subtitle;
  const whatsappUrl = settings.landing_whatsapp_number
    ? `https://wa.me/${settings.landing_whatsapp_number.replace(/\D/g, '')}`
    : null;
  const hasSocialLinks =
    settings.landing_facebook_url ||
    settings.landing_instagram_url ||
    settings.landing_tiktok_url ||
    settings.landing_youtube_url ||
    settings.landing_twitter_url ||
    whatsappUrl;
  const hasContact =
    settings.landing_address ||
    settings.landing_contact_phone ||
    settings.landing_contact_email ||
    hasSocialLinks;

  const mapsEmbedUrl = settings.landing_address
    ? `https://www.google.com/maps?q=${encodeURIComponent(settings.landing_address)}&output=embed`
    : null;
  const directionsUrl = getDirectionsUrl(settings);
  const showFbChat = settings.landing_enable_fb_chat && settings.landing_facebook_page_id;

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <header className="bg-mp2h-navy text-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {settings.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.logo_url}
                alt={settings.site_title}
                style={{ height: settings.logo_height }}
                className="w-auto object-contain shrink-0"
              />
            )}
            <span className="font-display text-lg sm:text-xl tracking-wide truncate">
              {settings.site_title}
            </span>
          </div>
          <nav className="flex items-center gap-3 sm:gap-4 text-sm shrink-0">
            <a
              href="/my-bookings"
              className="hidden sm:inline text-white/80 hover:text-white underline underline-offset-2"
            >
              My Bookings
            </a>
            <a
              href="/booking"
              className="rounded-xl bg-mp2h-lime text-mp2h-navy font-semibold px-4 py-2 hover:brightness-95 transition-[filter]"
            >
              Book a Court
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-mp2h-navy text-white">
        <div className="max-w-4xl mx-auto px-4 py-16 sm:py-24 text-center">
          <h1 className="font-display text-4xl sm:text-6xl leading-tight tracking-wide">
            {settings.site_title}
          </h1>
          {tagline && (
            <p className="mt-4 text-lg sm:text-2xl text-mp2h-lime font-display tracking-wide">
              {tagline}
            </p>
          )}
          <a
            href="/booking"
            className="inline-block mt-8 rounded-xl bg-mp2h-lime text-mp2h-navy font-display text-lg tracking-wide px-8 py-3 hover:brightness-95 transition-[filter]"
          >
            Book a Court
          </a>
        </div>
      </section>

      {/* About */}
      {settings.landing_about_html && (
        <section className="max-w-3xl mx-auto px-4 py-16">
          <h2 className="font-display text-3xl text-mp2h-navy mb-4 tracking-wide">About Us</h2>
          <div
            className="rich-content text-slate-700 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: settings.landing_about_html }}
          />
        </section>
      )}

      {/* Courts */}
      {courts.length > 0 && (
        <section className="bg-slate-50 py-16">
          <div className="max-w-5xl mx-auto px-4">
            <h2 className="font-display text-3xl text-mp2h-navy mb-6 text-center tracking-wide">
              Our Courts
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {courts.map((court) => (
                <div
                  key={court.id}
                  className="bg-white rounded-2xl border border-slate-200 overflow-hidden text-center"
                >
                  {court.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={court.image_url}
                      alt={court.name}
                      className="w-full h-32 object-cover"
                    />
                  ) : null}
                  <p className="font-display text-lg text-mp2h-navy tracking-wide p-4">
                    {court.name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Hours */}
      <section className="bg-mp2h-navy text-white py-12">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="font-display text-2xl mb-2 tracking-wide">Hours</h2>
          <p className="text-white/80">
            {formatOpenDays(settings.open_days)} · {formatHourLabel(settings.opening_hour)} –{' '}
            {formatHourLabel(settings.closing_hour)}
          </p>
        </div>
      </section>

      {/* Gallery */}
      {settings.landing_show_gallery && photos.length > 0 && (
        <section className="max-w-5xl mx-auto px-4 py-16">
          <h2 className="font-display text-3xl text-mp2h-navy mb-6 text-center tracking-wide">
            Gallery
          </h2>
          <GalleryLightbox photos={photos} />
        </section>
      )}

      {/* Location & Directions */}
      {mapsEmbedUrl && (
        <section className="max-w-4xl mx-auto px-4 py-16">
          <h2 className="font-display text-3xl text-mp2h-navy mb-2 text-center tracking-wide">
            Location &amp; Directions
          </h2>
          {settings.landing_address && (
            <p className="text-slate-600 text-center mb-6">{settings.landing_address}</p>
          )}
          <div className="rounded-2xl overflow-hidden border border-slate-200">
            <iframe
              src={mapsEmbedUrl}
              className="w-full h-80 border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="Map to our location"
            />
          </div>
          {directionsUrl && (
            <div className="text-center mt-6">
              <a
                href={directionsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block rounded-xl bg-mp2h-navy text-white font-display text-base tracking-wide px-6 py-3 hover:brightness-110 transition-[filter]"
              >
                Get Directions
              </a>
            </div>
          )}
        </section>
      )}

      {/* Policy */}
      {settings.landing_policy_html && (
        <section className="max-w-3xl mx-auto px-4 py-16">
          <h2 className="font-display text-3xl text-mp2h-navy mb-4 tracking-wide">
            Booking &amp; Reservation Policy
          </h2>
          <div
            className="rich-content text-slate-700 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: settings.landing_policy_html }}
          />
        </section>
      )}

      {/* Contact / Footer */}
      <footer className="bg-mp2h-navy text-white py-12">
        <div className="max-w-3xl mx-auto px-4 text-center space-y-2">
          {hasContact && (
            <>
              {settings.landing_address && (
                <p className="text-white/80 text-sm">{settings.landing_address}</p>
              )}
              {(settings.landing_contact_phone || settings.landing_contact_email) && (
                <p className="text-white/80 text-sm">
                  {settings.landing_contact_phone}
                  {settings.landing_contact_phone && settings.landing_contact_email ? ' · ' : ''}
                  {settings.landing_contact_email}
                </p>
              )}
              {hasSocialLinks && (
                <div className="flex items-center justify-center gap-4 pt-2">
                  {settings.landing_facebook_url && (
                    <a
                      href={settings.landing_facebook_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Facebook"
                      className="text-white/80 hover:text-mp2h-lime transition-colors"
                    >
                      <FacebookIcon className="w-5 h-5" />
                    </a>
                  )}
                  {settings.landing_instagram_url && (
                    <a
                      href={settings.landing_instagram_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Instagram"
                      className="text-white/80 hover:text-mp2h-lime transition-colors"
                    >
                      <InstagramIcon className="w-5 h-5" />
                    </a>
                  )}
                  {settings.landing_tiktok_url && (
                    <a
                      href={settings.landing_tiktok_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="TikTok"
                      className="text-white/80 hover:text-mp2h-lime transition-colors"
                    >
                      <TiktokIcon className="w-5 h-5" />
                    </a>
                  )}
                  {settings.landing_youtube_url && (
                    <a
                      href={settings.landing_youtube_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="YouTube"
                      className="text-white/80 hover:text-mp2h-lime transition-colors"
                    >
                      <YoutubeIcon className="w-5 h-5" />
                    </a>
                  )}
                  {settings.landing_twitter_url && (
                    <a
                      href={settings.landing_twitter_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Twitter / X"
                      className="text-white/80 hover:text-mp2h-lime transition-colors"
                    >
                      <TwitterIcon className="w-5 h-5" />
                    </a>
                  )}
                  {whatsappUrl && (
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="WhatsApp"
                      className="text-white/80 hover:text-mp2h-lime transition-colors"
                    >
                      <WhatsappIcon className="w-5 h-5" />
                    </a>
                  )}
                </div>
              )}
            </>
          )}
          <p className="text-white/40 text-xs pt-6">
            © {new Date().getFullYear()} {settings.site_title}. All rights reserved.
          </p>
        </div>
      </footer>

      {/* Facebook Customer Chat */}
      {showFbChat && (
        <>
          <div id="fb-root" />
          <div
            className="fb-customerchat"
            {...({
              page_id: settings.landing_facebook_page_id ?? '',
              attribution: 'setup_tool',
            } as Record<string, string>)}
          />
          <Script
            id="fb-sdk"
            strategy="lazyOnload"
            src="https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v19.0"
          />
        </>
      )}
    </div>
  );
}
