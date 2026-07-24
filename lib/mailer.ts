import 'server-only';
import nodemailer from 'nodemailer';
import type { SupabaseClient } from '@supabase/supabase-js';

// Sends via a regular Gmail account using an "App Password" — Gmail
// rejects plain account passwords for SMTP. Generate one at
// https://myaccount.google.com/apppasswords (requires 2-Step Verification
// to be enabled on the account first). Configured from the admin dashboard
// (Branding & Settings) rather than env vars, so it's the same in local
// dev and production without needing to touch either separately.
export function getMailTransporter(user: string | null | undefined, pass: string | null | undefined) {
  if (!user || !pass) {
    throw new Error(
      'Gmail is not configured yet. Set it up in Admin → Branding & Settings → Email Notifications.'
    );
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

export interface EmailCredentials {
  gmailUser: string;
  gmailAppPassword: string;
  adminNotificationEmail: string;
  // Shared secret the Supabase pg_cron job presents to authenticate itself
  // to /api/cron/send-reminders — null if the admin hasn't set one yet.
  cronSecret: string | null;
}

// Reads the actual secrets, so this must only ever be called with a
// service-role client — the admin-dashboard (authenticated) role can see
// that a password/secret is configured but is deliberately blocked at the
// database level from reading the values back out.
export async function fetchEmailCredentials(
  supabaseAdmin: SupabaseClient
): Promise<EmailCredentials | null> {
  const { data, error } = await supabaseAdmin
    .from('email_settings')
    .select('gmail_user, gmail_app_password, admin_notification_email, cron_secret')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('Failed to load email settings:', error);
    return null;
  }

  return {
    gmailUser: data.gmail_user ?? '',
    gmailAppPassword: data.gmail_app_password ?? '',
    adminNotificationEmail: data.admin_notification_email ?? '',
    cronSecret: data.cron_secret ?? null,
  };
}
