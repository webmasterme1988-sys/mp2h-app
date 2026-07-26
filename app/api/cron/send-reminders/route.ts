import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getMailTransporter, fetchEmailCredentials } from '@/lib/mailer';
import { fetchSiteSettings } from '@/lib/siteSettings';
import { buildCustomerReminderEmail } from '@/lib/reminderEmailTemplate';
import { getDirectionsUrl } from '@/lib/googleMaps';

interface ReminderBookingRow {
  id: string;
  transaction_id: number | null;
  player_name: string;
  player_email: string | null;
  start_time: string;
  end_time: string;
  price: number | null;
  transactions: { confirmation_number: string | null } | null;
  courts: { name: string } | null;
}

// Not triggered by anything in the app itself — a Supabase pg_cron job
// (see the setup SQL) hits this on a schedule, so there's no logged-in
// admin session to check. A shared secret takes its place — configured in
// Admin → Branding & Settings → Email Notifications (stored in the same
// write-only-to-the-client fashion as the Gmail App Password) rather than
// an environment variable, so it's the same in local dev and production
// without needing to touch either separately. Uses the service-role client
// throughout (not the anon/public client other routes use) since this call
// has no Supabase Auth session for RLS to key off of.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const providedSecret = authHeader?.match(/^Bearer\s+(.+)$/)?.[1] ?? null;

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
  }

  const credentials = await fetchEmailCredentials(supabaseAdmin);
  if (!credentials?.cronSecret || providedSecret !== credentials.cronSecret) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!credentials.gmailUser || !credentials.gmailAppPassword) {
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
  }

  const settings = await fetchSiteSettings(supabaseAdmin);

  let transporter;
  try {
    transporter = getMailTransporter(credentials.gmailUser, credentials.gmailAppPassword);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
  }

  const tiers = [
    {
      column: 'reminder_1_sent_at' as const,
      enabled: settings.booking_reminder_1_enabled,
      hours: settings.booking_reminder_1_hours,
    },
    {
      column: 'reminder_2_sent_at' as const,
      enabled: settings.booking_reminder_2_enabled,
      hours: settings.booking_reminder_2_hours,
    },
  ];

  // Must pin the timezone explicitly — this runs on the server (Vercel's
  // Node.js functions default to UTC), not in the customer's browser.
  // `dateStyle` can't be mixed with individual component options like
  // `weekday`, hence spelling out month/day/year explicitly here.
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Manila',
    });
  const formatSlotRange = (startIso: string, endIso: string) => {
    const fmt = (iso: string) =>
      new Date(iso).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Manila',
      });
    return `${fmt(startIso)} to ${fmt(endIso)}`;
  };

  let totalSent = 0;
  const errors: string[] = [];

  for (const tier of tiers) {
    if (!tier.enabled) continue;

    const now = new Date();
    const cutoff = new Date(now.getTime() + tier.hours * 60 * 60 * 1000);

    // Bookings whose reminder threshold has arrived (or passed, if the cron
    // job was down for a while) but haven't started yet — reminder_N_sent_at
    // being the only dedup guard means this is safe to re-run at any
    // interval without double- or un-sending anything.
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select(
        'id, transaction_id, player_name, player_email, start_time, end_time, price, transactions(confirmation_number), courts(name)'
      )
      .eq('status', 'confirmed')
      .not('player_email', 'is', null)
      .is(tier.column, null)
      .gt('start_time', now.toISOString())
      .lte('start_time', cutoff.toISOString());

    if (error) {
      console.error(`Failed to load bookings due for ${tier.column}:`, error);
      errors.push(error.message);
      continue;
    }

    const dueBookings = (data ?? []) as unknown as ReminderBookingRow[];
    if (dueBookings.length === 0) continue;

    // One email per transaction, not per slot — if a multi-slot booking's
    // several hours all happen to come due in the same run, it gets one
    // combined reminder instead of one per slot.
    const groups = new Map<string, ReminderBookingRow[]>();
    for (const b of dueBookings) {
      const key = b.transaction_id !== null ? `t-${b.transaction_id}` : `b-${b.id}`;
      const existing = groups.get(key);
      if (existing) existing.push(b);
      else groups.set(key, [b]);
    }

    for (const groupBookings of groups.values()) {
      const sorted = [...groupBookings].sort(
        (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );
      const first = sorted[0];
      if (!first.player_email) continue;

      const courtName = first.courts?.name ?? 'your court';
      const hasPrices = sorted.some((b) => b.price !== null);
      const total = sorted.reduce((sum, b) => sum + (b.price ?? 0), 0);

      const { text, html } = buildCustomerReminderEmail({
        playerName: first.player_name,
        hoursBefore: tier.hours,
        confirmationNumber: first.transactions?.confirmation_number ?? null,
        courtName,
        dateLabel: formatDate(first.start_time),
        slots: sorted.map((b) => ({
          timeRange: formatSlotRange(b.start_time, b.end_time),
          price: b.price,
        })),
        totalHours: sorted.length,
        totalPrice: hasPrices ? total : null,
        footerHtml: settings.customer_email_footer_html,
        address: settings.landing_address,
        directionsUrl: getDirectionsUrl(settings),
      });

      try {
        await transporter.sendMail({
          from: credentials.gmailUser,
          to: first.player_email,
          subject: `Reminder: your booking at ${courtName} is coming up`,
          text,
          html,
        });

        const { error: updateError } = await supabaseAdmin
          .from('bookings')
          .update({ [tier.column]: new Date().toISOString() })
          .in(
            'id',
            sorted.map((b) => b.id)
          );

        if (updateError) {
          console.error(`Failed to mark ${tier.column} sent:`, updateError);
          errors.push(updateError.message);
        } else {
          totalSent++;
        }
      } catch (err) {
        console.error('Failed to send reminder email:', err);
        errors.push(err instanceof Error ? err.message : 'Unknown error sending reminder email.');
      }
    }
  }

  return NextResponse.json({ success: true, sent: totalSent, errors });
}
