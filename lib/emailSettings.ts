import type { SupabaseClient } from '@supabase/supabase-js';

export interface EmailSettings {
  gmailUser: string;
  adminNotificationEmail: string;
  appPasswordSet: boolean;
}

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  gmailUser: '',
  adminNotificationEmail: '',
  appPasswordSet: false,
};

// Admin-only (RLS restricts SELECT to authenticated users), and even then
// the database itself withholds the actual gmail_app_password column —
// this only ever gets back whether one is set, never the value.
export async function fetchEmailSettings(supabase: SupabaseClient): Promise<EmailSettings> {
  const { data, error } = await supabase
    .from('email_settings')
    .select('gmail_user, admin_notification_email, app_password_set')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('Failed to load email settings, using defaults:', error);
    return DEFAULT_EMAIL_SETTINGS;
  }

  return {
    gmailUser: data.gmail_user ?? '',
    adminNotificationEmail: data.admin_notification_email ?? '',
    appPasswordSet: data.app_password_set ?? false,
  };
}
