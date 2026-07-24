import type { SupabaseClient } from '@supabase/supabase-js';

export interface EmailSettings {
  gmailUser: string;
  adminNotificationEmail: string;
  appPasswordSet: boolean;
  cronSecretSet: boolean;
}

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  gmailUser: '',
  adminNotificationEmail: '',
  appPasswordSet: false,
  cronSecretSet: false,
};

// Admin-only (RLS restricts SELECT to authenticated users), and even then
// the database itself withholds the actual gmail_app_password/cron_secret
// columns — this only ever gets back whether each is set, never the value.
export async function fetchEmailSettings(supabase: SupabaseClient): Promise<EmailSettings> {
  const { data, error } = await supabase
    .from('email_settings')
    .select('gmail_user, admin_notification_email, app_password_set, cron_secret_set')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    // Logging the raw PostgrestError object renders as "{}" in Next's dev
    // overlay (it doesn't serialize that class well) — pull out the actual
    // message/code/details fields so failures are diagnosable from the
    // console instead of just "something went wrong".
    if (error) {
      console.error('Failed to load email settings, using defaults:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }
    return DEFAULT_EMAIL_SETTINGS;
  }

  return {
    gmailUser: data.gmail_user ?? '',
    adminNotificationEmail: data.admin_notification_email ?? '',
    appPasswordSet: data.app_password_set ?? false,
    cronSecretSet: data.cron_secret_set ?? false,
  };
}
