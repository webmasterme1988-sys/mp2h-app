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
  booking_reminder_1_enabled: boolean;
  booking_reminder_1_hours: number;
  booking_reminder_2_enabled: boolean;
  booking_reminder_2_hours: number;
  booking_cleanup_enabled: boolean;
  booking_cleanup_retention_days: number;
  booking_cleanup_hour: number; // 0-23, Philippine time
  booking_cleanup_last_run_date: string | null; // 'YYYY-MM-DD', Philippine calendar date
  monthly_report_enabled: boolean;
  monthly_report_day: number; // 1-28, Philippine calendar day of month
  monthly_report_hour: number; // 0-23, Philippine time
  monthly_report_last_run_month: string | null; // 'YYYY-MM' of the last month a report covered
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
  // Off by default — enabling requires the admin to explicitly opt in from
  // the dashboard, same as notify_customer_on_approval above, rather than
  // silently start emailing customers the moment the cron job is wired up.
  booking_reminder_1_enabled: false,
  booking_reminder_1_hours: 24,
  booking_reminder_2_enabled: false,
  booking_reminder_2_hours: 4,
  // Off by default, same reasoning — deleting bookings is irreversible, so
  // it only starts happening once an admin explicitly turns it on.
  booking_cleanup_enabled: false,
  booking_cleanup_retention_days: 90,
  booking_cleanup_hour: 3, // 3 AM Philippine time — off-peak
  booking_cleanup_last_run_date: null,
  // Off by default, same reasoning as the two settings above.
  monthly_report_enabled: false,
  monthly_report_day: 1,
  monthly_report_hour: 6, // 6 AM Philippine time
  monthly_report_last_run_month: null,
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
  'site_title, site_subtitle, logo_url, logo_height, primary_color, selection_color, button_bg_color, button_label_color, submit_button_label, gcash_qr_url, payment_note, opening_hour, closing_hour, open_days, pending_hold_minutes, checkout_hold_minutes, availability_refresh_seconds, booking_hold_warning_text, auto_confirm_bookings, allow_multi_slot_booking, show_price, pricing_mode, flat_price, notify_customer_on_approval, attach_marketing_image, marketing_image_url, customer_email_footer_html, attach_receipt_to_customer_email, booking_reminder_1_enabled, booking_reminder_1_hours, booking_reminder_2_enabled, booking_reminder_2_hours, booking_cleanup_enabled, booking_cleanup_retention_days, booking_cleanup_hour, booking_cleanup_last_run_date, monthly_report_enabled, monthly_report_day, monthly_report_hour, monthly_report_last_run_month, admin_tab_font_color, admin_tab_active_bg_color, landing_tagline, landing_about_html, landing_policy_html, landing_address, landing_contact_phone, landing_contact_email, landing_facebook_url, landing_instagram_url, landing_google_maps_url, landing_facebook_page_id, landing_enable_fb_chat, landing_show_gallery, landing_tiktok_url, landing_youtube_url, landing_twitter_url, landing_whatsapp_number';

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
