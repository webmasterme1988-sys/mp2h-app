import { NextResponse, type NextRequest } from 'next/server';
import { createPublicServerClient } from '@/lib/supabase/publicServerClient';
import { getMailTransporter } from '@/lib/mailer';

interface NotifyBookingRow {
  id: string;
  player_name: string;
  player_phone: string;
  start_time: string;
  status: string;
  receipt_url: string | null;
  courts: { name: string } | null;
}

export async function POST(request: NextRequest) {
  const { bookingId } = (await request.json().catch(() => ({}))) as { bookingId?: string };

  if (!bookingId) {
    return NextResponse.json({ error: 'Missing bookingId.' }, { status: 400 });
  }

  // Re-fetch the booking server-side instead of trusting whatever the
  // client claims it booked — ties every email to a real row rather than
  // letting arbitrary POSTs put fabricated text in your inbox.
  const supabase = createPublicServerClient();
  const { data, error } = await supabase
    .from('bookings')
    .select('id, player_name, player_phone, start_time, status, receipt_url, courts(name)')
    .eq('id', bookingId)
    .maybeSingle();

  const booking = data as unknown as NotifyBookingRow | null;

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  }

  const to = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER;
  if (!to) {
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
  }

  let transporter;
  try {
    transporter = getMailTransporter();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
  }

  const courtName = booking.courts?.name ?? 'a court';
  // Must pin the timezone explicitly — this runs on the server (Vercel's
  // Node.js functions default to UTC), not in the customer's or admin's
  // browser, so leaving it implicit silently shows UTC instead of the
  // Philippine time the slot was actually booked for.
  const when = new Date(booking.start_time).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  });

  const receiptExt = booking.receipt_url?.split('.').pop()?.split(/[?#]/)[0] || 'jpg';

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: `New booking: ${booking.player_name} — ${courtName}`,
      text: [
        `${booking.player_name} (${booking.player_phone}) just booked ${courtName}.`,
        `When: ${when} (Philippine time)`,
        `Status: ${booking.status}`,
        booking.receipt_url ? 'Receipt: attached to this email.' : 'Receipt: not uploaded.',
        '',
        'Review and approve it in the admin dashboard.',
      ].join('\n'),
      // nodemailer fetches the file itself when `path` is an http(s) URL —
      // no need to download it ourselves first.
      attachments: booking.receipt_url
        ? [{ filename: `receipt.${receiptExt}`, path: booking.receipt_url }]
        : undefined,
    });
  } catch (err) {
    console.error('Failed to send booking notification email:', err);
    return NextResponse.json({ error: 'Could not send notification email.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
