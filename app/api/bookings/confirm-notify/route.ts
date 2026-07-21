import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createPublicServerClient } from '@/lib/supabase/publicServerClient';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getMailTransporter, fetchEmailCredentials } from '@/lib/mailer';
import { fetchSiteSettings } from '@/lib/siteSettings';
import { buildCustomerConfirmationEmail } from '@/lib/customerEmailTemplate';

interface ConfirmedBookingRow {
  id: string;
  transaction_id: number | null;
  player_name: string;
  player_phone: string;
  player_email: string | null;
  start_time: string;
  end_time: string;
  price: number | null;
  receipt_url: string | null;
  courts: { name: string } | null;
}

export async function POST(request: NextRequest) {
  // Only triggered from the admin dashboard's Approve action — verify the
  // caller is actually a logged-in admin rather than trusting the request.
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

  const { bookingId } = (await request.json().catch(() => ({}))) as { bookingId?: string };
  if (!bookingId) {
    return NextResponse.json({ error: 'Missing bookingId.' }, { status: 400 });
  }

  const supabase = createPublicServerClient();

  // The setting is authoritative here too, not just on the client — if it's
  // off, this route is a no-op regardless of what triggered the call.
  const settings = await fetchSiteSettings(supabase);
  if (!settings.notify_customer_on_approval) {
    return NextResponse.json({ success: true, skipped: 'notifications_disabled' });
  }

  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, transaction_id, player_name, player_phone, player_email, start_time, end_time, price, receipt_url, courts(name)'
    )
    .eq('id', bookingId)
    .eq('status', 'confirmed')
    .maybeSingle();

  const booking = data as unknown as ConfirmedBookingRow | null;

  if (error || !booking) {
    return NextResponse.json({ error: 'Confirmed booking not found.' }, { status: 404 });
  }

  if (!booking.player_email) {
    // Bookings made before the email field existed won't have one — not an
    // error, just nothing to send.
    return NextResponse.json({ success: true, skipped: 'no_email_on_file' });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
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

  const courtName = booking.courts?.name ?? 'your court';
  const dateLabel = new Date(booking.start_time).toLocaleDateString('en-US', {
    dateStyle: 'medium',
    timeZone: 'Asia/Manila',
  });
  // "9:00 AM to 10:00 AM" — the actual booked slot, not just its start time.
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Manila',
    });
  const timeRange = `${formatTime(booking.start_time)} to ${formatTime(booking.end_time)}`;

  // Optional attachments, both admin-configured.
  const customerAttachments: { filename: string; path: string }[] = [];
  if (settings.attach_receipt_to_customer_email && booking.receipt_url) {
    const receiptExt = booking.receipt_url.split('.').pop()?.split(/[?#]/)[0] || 'jpg';
    customerAttachments.push({ filename: `receipt.${receiptExt}`, path: booking.receipt_url });
  }
  if (settings.attach_marketing_image && settings.marketing_image_url) {
    const marketingExt = settings.marketing_image_url.split('.').pop()?.split(/[?#]/)[0] || 'jpg';
    customerAttachments.push({ filename: `promo.${marketingExt}`, path: settings.marketing_image_url });
  }

  const { text, html } = buildCustomerConfirmationEmail({
    playerName: booking.player_name,
    playerPhone: booking.player_phone,
    transactionId: booking.transaction_id,
    courtName,
    dateLabel,
    slots: [{ timeRange, price: booking.price }],
    totalHours: 1,
    totalPrice: booking.price,
    footerHtml: settings.customer_email_footer_html,
  });

  try {
    await transporter.sendMail({
      from: credentials.gmailUser,
      to: booking.player_email,
      subject: `Booking confirmed — ${courtName}, ${dateLabel} ${timeRange}`,
      text,
      html,
      attachments: customerAttachments.length > 0 ? customerAttachments : undefined,
    });
  } catch (err) {
    console.error('Failed to send confirmation email:', err);
    return NextResponse.json({ error: 'Could not send confirmation email.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
