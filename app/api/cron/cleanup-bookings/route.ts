import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { fetchEmailCredentials } from '@/lib/mailer';
import { fetchSiteSettings } from '@/lib/siteSettings';
import { runBookingCleanup } from '@/lib/bookingCleanup';
import { manilaDateString, manilaHour } from '@/lib/manilaTime';

// Same pg_cron-hits-this-on-a-schedule shape as /api/cron/send-reminders —
// no logged-in admin session to check, so a shared secret (configured in
// Admin → Branding & Settings → Email Notifications, same one reminders
// use) takes its place. Meant to be pinged hourly; the admin's configured
// "run at hour" + "already ran today" guard below are what actually make
// the cleanup happen once a day at the chosen Philippine-time hour, rather
// than the pg_cron schedule itself needing to change whenever the admin
// changes that setting.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const providedSecret = authHeader?.match(/^Bearer\s+(.+)$/)?.[1] ?? null;

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Cleanup is not configured yet.' }, { status: 500 });
  }

  const credentials = await fetchEmailCredentials(supabaseAdmin);
  if (!credentials?.cronSecret || providedSecret !== credentials.cronSecret) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const settings = await fetchSiteSettings(supabaseAdmin);
  if (!settings.booking_cleanup_enabled) {
    return NextResponse.json({ success: true, skipped: 'disabled' });
  }

  const now = new Date();
  if (manilaHour(now) !== settings.booking_cleanup_hour) {
    return NextResponse.json({ success: true, skipped: 'not_scheduled_hour' });
  }

  const today = manilaDateString(now);
  if (settings.booking_cleanup_last_run_date === today) {
    return NextResponse.json({ success: true, skipped: 'already_ran_today' });
  }

  const summary = await runBookingCleanup(supabaseAdmin, settings.booking_cleanup_retention_days);

  const { error: updateError } = await supabaseAdmin
    .from('site_settings')
    .update({ booking_cleanup_last_run_date: today })
    .eq('id', 1);
  if (updateError) {
    summary.errors.push(`last_run_date: ${updateError.message}`);
  }

  return NextResponse.json({ success: true, ...summary });
}
