import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getMailTransporter, fetchEmailCredentials } from '@/lib/mailer';
import { fetchSiteSettings } from '@/lib/siteSettings';
import { manilaDayOfMonth, manilaHour, previousManilaMonthRange } from '@/lib/manilaTime';
import { buildMonthlyReportCsvRows } from '@/lib/monthlyReport';
import { buildCsvString } from '@/lib/csv';

// Same pg_cron-hits-this-on-a-schedule shape as the other /api/cron
// routes — meant to be pinged daily; the admin's configured "day of
// month" + "hour" + "already sent this month" guard below are what
// actually make the report go out once a month, rather than the pg_cron
// schedule itself needing to change whenever the admin changes that
// setting.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const providedSecret = authHeader?.match(/^Bearer\s+(.+)$/)?.[1] ?? null;

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Monthly report is not configured yet.' }, { status: 500 });
  }

  const credentials = await fetchEmailCredentials(supabaseAdmin);
  if (!credentials?.cronSecret || providedSecret !== credentials.cronSecret) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!credentials.gmailUser || !credentials.gmailAppPassword) {
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
  }

  const settings = await fetchSiteSettings(supabaseAdmin);
  if (!settings.monthly_report_enabled) {
    return NextResponse.json({ success: true, skipped: 'disabled' });
  }

  const now = new Date();
  if (manilaDayOfMonth(now) !== settings.monthly_report_day) {
    return NextResponse.json({ success: true, skipped: 'not_scheduled_day' });
  }
  if (manilaHour(now) !== settings.monthly_report_hour) {
    return NextResponse.json({ success: true, skipped: 'not_scheduled_hour' });
  }

  const { startIso, endIso, monthKey, monthLabel } = previousManilaMonthRange(now);
  if (settings.monthly_report_last_run_month === monthKey) {
    return NextResponse.json({ success: true, skipped: 'already_sent_this_month' });
  }

  let transporter;
  try {
    transporter = getMailTransporter(credentials.gmailUser, credentials.gmailAppPassword);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
  }

  const to = credentials.adminNotificationEmail || credentials.gmailUser;

  try {
    const rows = await buildMonthlyReportCsvRows(supabaseAdmin, startIso, endIso, settings.show_price);
    const csv = buildCsvString(rows);

    await transporter.sendMail({
      from: credentials.gmailUser,
      to,
      subject: `Monthly Booking Report — ${monthLabel}`,
      text:
        rows.length > 0
          ? `Attached: every booking for ${monthLabel} (${rows.length} total) — same columns as the "Booked Customers" export in the admin dashboard.`
          : `No bookings were recorded for ${monthLabel}.`,
      attachments:
        rows.length > 0
          ? [
              {
                filename: `booked-customers-${monthKey}.csv`,
                content: Buffer.from(csv, 'utf8'),
                contentType: 'text/csv;charset=utf-8',
              },
            ]
          : undefined,
    });

    const { error: updateError } = await supabaseAdmin
      .from('site_settings')
      .update({ monthly_report_last_run_month: monthKey })
      .eq('id', 1);
    if (updateError) {
      console.error('Failed to stamp monthly_report_last_run_month:', updateError);
      return NextResponse.json({
        success: true,
        sent: true,
        bookingsCount: rows.length,
        warning: `Report sent but last-run tracking failed: ${updateError.message}`,
      });
    }

    return NextResponse.json({ success: true, sent: true, bookingsCount: rows.length });
  } catch (err) {
    console.error('Failed to send monthly report:', err);
    return NextResponse.json({ error: 'Could not send monthly report.' }, { status: 500 });
  }
}
