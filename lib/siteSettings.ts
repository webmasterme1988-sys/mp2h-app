import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_OPENING_HOUR, DEFAULT_CLOSING_HOUR } from './timeSlots';
import type { PricingMode } from './priceTiers';

// 0 = Sunday ... 6 = Saturday, matching JS Date#getDay().
export const ALL_DAYS_OPEN = [0, 1, 2, 3, 4, 5, 6];

export interface SiteSettings {
  site_title: string;
  site_subtitle: string;
  logo_url: string | null;
  logo_height: number;
  primary_color: string;
  selection_color: string;
  button_bg_color: string;
  button_label_color: string;
  submit_button_label: string;
  /** @deprecated superseded by the payment_qr_codes table, kept for backward compatibility */
  gcash_qr_url: string | null;
  payment_note: string | null;
  opening_hour: number;
  closing_hour: number;
  open_days: number[];
  pending_hold_minutes: number;
  checkout_hold_minutes: number;
  availability_refresh_seconds: number;
  booking_hold_warning_text: string | null;
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
  admin_tab_font_color: string;
  admin_tab_active_bg_color: string;
  landing_tagline: string | null;
  landing_about_html: string | null;
  landing_policy_html: string | null;
  landing_address: string | null;
  landing_contact_phone: string | null;
  landing_contact_email: string | null;
  landing_facebook_url: string | null;
  landing_instagram_url: string | null;
  landing_google_maps_url: string | null;
  landing_facebook_page_id: string | null;
  landing_enable_fb_chat: boolean;
  landing_show_gallery: boolean;
  landing_tiktok_url: string | null;
  landing_youtube_url: string | null;
  landing_twitter_url: string | null;
  landing_whatsapp_number: string | null;
}

// Matches the current hardcoded look of the app, so sites that haven't
// configured branding yet (or if the site_settings table isn't set up)
// render exactly as before.
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  site_title: 'MP2H Pickleball',
  site_subtitle: 'Book a court online — quick, easy, and no phone calls needed.',
  logo_url: null,
  logo_height: 48, // px
  primary_color: '#059669', // Tailwind emerald-600
  selection_color: '#059669',
  button_bg_color: '#059669',
  button_label_color: '#ffffff',
  submit_button_label: 'Submit Booking',
  gcash_qr_url: null,
  payment_note: null,
  opening_hour: DEFAULT_OPENING_HOUR,
  closing_hour: DEFAULT_CLOSING_HOUR,
  open_days: ALL_DAYS_OPEN,
  pending_hold_minutes: 15,
  checkout_hold_minutes: 15,
  availability_refresh_seconds: 60,
  booking_hold_warning_text:
    'This time slot is reserved for a limited time only. Please complete your payment and submit before it expires.',
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
  admin_tab_font_color: '#475569', // Tailwind slate-600
  admin_tab_active_bg_color: '#059669', // Tailwind emerald-600
  landing_tagline: null,
  landing_about_html: null,
  landing_policy_html: null,
  landing_address: null,
  landing_contact_phone: null,
  landing_contact_email: null,
  landing_facebook_url: null,
  landing_instagram_url: null,
  landing_google_maps_url: null,
  landing_facebook_page_id: null,
  landing_enable_fb_chat: false,
  landing_show_gallery: true,
  landing_tiktok_url: null,
  landing_youtube_url: null,
  landing_twitter_url: null,
  landing_whatsapp_number: null,
};

const SITE_SETTINGS_COLUMNS =
  'site_title, site_subtitle, logo_url, logo_height, primary_color, selection_color, button_bg_color, button_label_color, submit_button_label, gcash_qr_url, payment_note, opening_hour, closing_hour, open_days, pending_hold_minutes, checkout_hold_minutes, availability_refresh_seconds, booking_hold_warning_text, auto_confirm_bookings, allow_multi_slot_booking, show_price, pricing_mode, flat_price, notify_customer_on_approval, attach_marketing_image, marketing_image_url, customer_email_footer_html, attach_receipt_to_customer_email, admin_tab_font_color, admin_tab_active_bg_color, landing_tagline, landing_about_html, landing_policy_html, landing_address, landing_contact_phone, landing_contact_email, landing_facebook_url, landing_instagram_url, landing_google_maps_url, landing_facebook_page_id, landing_enable_fb_chat, landing_show_gallery, landing_tiktok_url, landing_youtube_url, landing_twitter_url, landing_whatsapp_number';

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
