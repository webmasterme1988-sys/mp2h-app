import { NextResponse, type NextRequest } from 'next/server';
import { createPublicServerClient } from '@/lib/supabase/publicServerClient';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getMailTransporter, fetchEmailCredentials } from '@/lib/mailer';
import { formatPrice } from '@/lib/priceTiers';
import { fetchSiteSettings } from '@/lib/siteSettings';
import { buildCustomerConfirmationEmail } from '@/lib/customerEmailTemplate';
import { getDirectionsUrl } from '@/lib/googleMaps';

interface NotifyBookingRow {
  id: string;
  transaction_id: number | null;
  daily_sequence: number | null;
  admin_remark: string | null;
  player_name: string;
  player_phone: string;
  player_email: string | null;
  start_time: string;
  end_time: string;
  status: string;
  receipt_url: string | null;
  price: number | null;
  courts: { name: string } | null;
}

export async function POST(request: NextRequest) {
  const { bookingIds } = (await request.json().catch(() => ({}))) as { bookingIds?: string[] };

  if (!bookingIds || bookingIds.length === 0) {
    return NextResponse.json({ error: 'Missing bookingIds.' }, { status: 400 });
  }

  // Re-fetch the bookings server-side instead of trusting whatever the
  // client claims it booked — ties every email to real rows rather than
  // letting arbitrary POSTs put fabricated text in your inbox.
  const supabase = createPublicServerClient();
  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, transaction_id, daily_sequence, admin_remark, player_name, player_phone, player_email, start_time, end_time, status, receipt_url, price, courts(name)'
    )
    .in('id', bookingIds)
    .order('start_time', { ascending: true });

  const bookings = data as unknown as NotifyBookingRow[] | null;

  if (error || !bookings || bookings.length === 0) {
    return NextResponse.json({ error: 'Booking(s) not found.' }, { status: 404 });
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

  const to = credentials.adminNotificationEmail || credentials.gmailUser;

  let transporter;
  try {
    transporter = getMailTransporter(credentials.gmailUser, credentials.gmailAppPassword);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
  }

  const first = bookings[0];
  const courtName = first.courts?.name ?? 'a court';
  // Must pin the timezone explicitly — this runs on the server (Vercel's
  // Node.js functions default to UTC), not in the customer's or admin's
  // browser, so leaving it implicit silently shows UTC instead of the
  // Philippine time the slot was actually booked for.
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'Asia/Manila' });
  // "9:00 AM to 10:00 AM" — the actual booked slot, not just its start time.
  const formatSlotRange = (startIso: string, endIso: string) => {
    const fmt = (iso: string) =>
      new Date(iso).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Manila',
      });
    return `${fmt(startIso)} to ${fmt(endIso)}`;
  };

  const hasPrices = bookings.some((b) => b.price !== null);
  const total = bookings.reduce((sum, b) => sum + (b.price ?? 0), 0);
  // Each row is one hour-long slot, so the count of rows is the hour total —
  // same convention the admin dashboard and booking-summary screen use.
  const totalHours = bookings.length;

  const slotLines =
    bookings.length > 1
      ? bookings.map((b) => {
          const range = formatSlotRange(b.start_time, b.end_time);
          return `  - ${range}${hasPrices ? ` (${formatPrice(b.price ?? 0)})` : ''}`;
        })
      : [];

  const receiptExt = first.receipt_url?.split('.').pop()?.split(/[?#]/)[0] || 'jpg';

  const bookedByAdmin = first.admin_remark !== null;

  const subject =
    bookings.length > 1
      ? `New booking: ${first.player_name} — ${courtName} (${bookings.length} slots)`
      : `New booking: ${first.player_name} — ${courtName}`;

  try {
    await transporter.sendMail({
      from: credentials.gmailUser,
      to,
      subject,
      text: [
        `${first.player_name} (${first.player_phone}${
          first.player_email ? `, ${first.player_email}` : ''
        }) ${bookedByAdmin ? 'was booked by an admin for' : 'just booked'} ${courtName}${
          bookings.length > 1 ? ` (${bookings.length} slots)` : ''
        }.`,
        bookings.length > 1
          ? `Date: ${formatDate(first.start_time)} (Philippine time)`
          : `When: ${formatDate(first.start_time)}, ${formatSlotRange(first.start_time, first.end_time)} (Philippine time)`,
        ...slotLines,
        `Total Hours: ${totalHours}`,
        hasPrices ? `Total: ${formatPrice(total)}` : '',
        `Status: ${first.status}`,
        bookedByAdmin
          ? `Remark: ${first.admin_remark}`
          : first.receipt_url
            ? 'Receipt: attached to this email.'
            : 'Receipt: not uploaded.',
        '',
        'Review in the admin dashboard.',
      ]
        .filter(Boolean)
        .join('\n'),
      // nodemailer fetches the file itself when `path` is an http(s) URL —
      // no need to download it ourselves first. All slots in one
      // submission share the same receipt, so one attachment covers them.
      attachments: first.receipt_url
        ? [{ filename: `receipt.${receiptExt}`, path: first.receipt_url }]
        : undefined,
    });
  } catch (err) {
    console.error('Failed to send booking notification email:', err);
    return NextResponse.json({ error: 'Could not send notification email.' }, { status: 500 });
  }

  // Auto-confirm mode skips the manual approval step entirely, so there's
  // no separate "Approve" click to trigger the customer's confirmation
  // email from — send it right away instead. Best-effort: the admin alert
  // above already succeeded, so a failure here shouldn't fail the request.
  if (first.status === 'confirmed' && first.player_email) {
    const settings = await fetchSiteSettings(supabase);
    if (settings.notify_customer_on_approval) {
      // Optional attachments, both admin-configured — same http(s)-URL
      // attachment mechanism as the admin alert's receipt above.
      const customerAttachments: { filename: string; path: string }[] = [];
      if (settings.attach_receipt_to_customer_email && first.receipt_url) {
        customerAttachments.push({ filename: `receipt.${receiptExt}`, path: first.receipt_url });
      }
      if (settings.attach_marketing_image && settings.marketing_image_url) {
        const marketingExt =
          settings.marketing_image_url.split('.').pop()?.split(/[?#]/)[0] || 'jpg';
        customerAttachments.push({ filename: `promo.${marketingExt}`, path: settings.marketing_image_url });
      }

      const { text, html } = buildCustomerConfirmationEmail({
        playerName: first.player_name,
        playerPhone: first.player_phone,
        transactionId: first.transaction_id,
        dailySequence: first.daily_sequence,
        courtName,
        dateLabel: formatDate(first.start_time),
        bookingDateISO: new Date(first.start_time).toLocaleDateString('en-CA', {
          timeZone: 'Asia/Manila',
        }),
        slots: bookings.map((b) => ({
          timeRange: formatSlotRange(b.start_time, b.end_time),
          price: b.price,
        })),
        totalHours,
        totalPrice: hasPrices ? total : null,
        footerHtml: settings.customer_email_footer_html,
        address: settings.landing_address,
        directionsUrl: getDirectionsUrl(settings),
      });

      try {
        await transporter.sendMail({
          from: credentials.gmailUser,
          to: first.player_email,
          subject: `Booking confirmed — ${courtName}${bookings.length > 1 ? ` (${bookings.length} slots)` : ''}`,
          text,
          html,
          attachments: customerAttachments.length > 0 ? customerAttachments : undefined,
        });
      } catch (err) {
        console.error('Failed to send auto-confirm customer email:', err);
      }
    }
  }

  return NextResponse.json({ success: true });
}
