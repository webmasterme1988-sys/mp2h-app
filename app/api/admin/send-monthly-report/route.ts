import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getMailTransporter, fetchEmailCredentials } from '@/lib/mailer';
import { fetchSiteSettings } from '@/lib/siteSettings';
import { previousManilaMonthRange } from '@/lib/manilaTime';
import { buildMonthlyReportCsvRows } from '@/lib/monthlyReport';
import { buildCsvString } from '@/lib/csv';

// Lets a super admin send the previous month's report immediately instead
// of waiting for the next scheduled day/hour — same underlying logic as
// the cron route (lib/monthlyReport), just triggered from the dashboard.
// Also stamps monthly_report_last_run_month so the cron job doesn't send
// a duplicate for the same month later.
export async function POST() {
  const cookieStore = await cookies();
  const authedSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Not needed for a read-only session check in a Route Handler.
        },
      },
    }
  );

  const {
    data: { user },
  } = await authedSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  if (user.app_metadata?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only a super admin can send the report.' }, { status: 403 });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Monthly report is not configured yet.' }, { status: 500 });
  }

  const credentials = await fetchEmailCredentials(supabaseAdmin);
  if (!credentials?.gmailUser || !credentials.gmailAppPassword) {
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
  }

  let transporter;
  try {
    transporter = getMailTransporter(credentials.gmailUser, credentials.gmailAppPassword);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
  }

  const settings = await fetchSiteSettings(supabaseAdmin);
  const to = credentials.adminNotificationEmail || credentials.gmailUser;
  const { startIso, endIso, monthKey, monthLabel } = previousManilaMonthRange();

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
    }

    return NextResponse.json({ success: true, sent: true, bookingsCount: rows.length, to, monthLabel });
  } catch (err) {
    console.error('Failed to send monthly report:', err);
    return NextResponse.json({ error: 'Could not send monthly report.' }, { status: 500 });
  }
}
