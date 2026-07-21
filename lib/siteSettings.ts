import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_OPENING_HOUR, DEFAULT_CLOSING_HOUR } from './timeSlots';
import type { PricingMode } from './priceTiers';

// 0 = Sunday ... 6 = Saturday, matching JS Date#getDay().
export const ALL_DAYS_OPEN = [0, 1, 2, 3, 4, 5, 6];

export interface SiteSettings {
  site_title: string;
  site_subtitle: string;
  logo_url: string | null;
  primary_color: string;
  submit_button_label: string;
  /** @deprecated superseded by the payment_qr_codes table, kept for backward compatibility */
  gcash_qr_url: string | null;
  payment_note: string | null;
  opening_hour: number;
  closing_hour: number;
  open_days: number[];
  pending_hold_minutes: number;
  auto_confirm_bookings: boolean;
  allow_multi_slot_booking: boolean;
  show_price: boolean;
  pricing_mode: PricingMode;
  flat_price: number;
  notify_customer_on_approval: boolean;
  attach_marketing_image: boolean;
  marketing_image_url: string | null;
  customer_email_footer_html: string | null;
  attach_receipt_to_customer_email: boolean;
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
  payment_note: null,
  opening_hour: DEFAULT_OPENING_HOUR,
  closing_hour: DEFAULT_CLOSING_HOUR,
  open_days: ALL_DAYS_OPEN,
  pending_hold_minutes: 10,
  auto_confirm_bookings: false,
  allow_multi_slot_booking: false,
  show_price: false,
  pricing_mode: 'flat',
  flat_price: 0,
  notify_customer_on_approval: false,
  attach_marketing_image: false,
  marketing_image_url: null,
  customer_email_footer_html: null,
  attach_receipt_to_customer_email: false,
};

const SITE_SETTINGS_COLUMNS =
  'site_title, site_subtitle, logo_url, primary_color, submit_button_label, gcash_qr_url, payment_note, opening_hour, closing_hour, open_days, pending_hold_minutes, auto_confirm_bookings, allow_multi_slot_booking, show_price, pricing_mode, flat_price, notify_customer_on_approval, attach_marketing_image, marketing_image_url, customer_email_footer_html, attach_receipt_to_customer_email';

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

  const merged = { ...DEFAULT_SITE_SETTINGS, ...data };
  if (!merged.open_days || merged.open_days.length === 0) {
    merged.open_days = ALL_DAYS_OPEN;
  }
  return merged;
}
