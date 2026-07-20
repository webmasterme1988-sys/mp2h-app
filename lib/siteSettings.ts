import type { SupabaseClient } from '@supabase/supabase-js';

export interface SiteSettings {
  site_title: string;
  site_subtitle: string;
  logo_url: string | null;
  primary_color: string;
  submit_button_label: string;
  gcash_qr_url: string | null;
}

// Matches the current hardcoded look of the app, so sites that haven't
// configured branding yet (or if the site_settings table isn't set up)
// render exactly as before.
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  site_title: 'MP2H Pickleball',
  site_subtitle: 'Book a court online — quick, easy, and no phone calls needed.',
  logo_url: null,
  primary_color: '#059669', // Tailwind emerald-600
  submit_button_label: 'Submit Booking',
  gcash_qr_url: null,
};

const SITE_SETTINGS_COLUMNS =
  'site_title, site_subtitle, logo_url, primary_color, submit_button_label, gcash_qr_url';

// Branding is a nice-to-have, not core booking functionality — if the table
// isn't set up yet or the query fails for any reason, fall back to defaults
// instead of breaking the page.
export async function fetchSiteSettings(supabase: SupabaseClient): Promise<SiteSettings> {
  const { data, error } = await supabase
    .from('site_settings')
    .select(SITE_SETTINGS_COLUMNS)
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('Failed to load site settings, using defaults:', error);
    return DEFAULT_SITE_SETTINGS;
  }

  return { ...DEFAULT_SITE_SETTINGS, ...data };
}
