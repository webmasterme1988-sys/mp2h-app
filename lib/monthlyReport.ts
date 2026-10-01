import 'server-only';
import { getSupabaseAdmin } from './supabase/admin';
import type { SiteSettings } from './siteSettings';

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

type BookingStatus = 'pending' | 'confirmed' | 'cancelled';

interface MonthlyReportBookingRow {
  id: string;
  admin_remark: string | null;
  reschedule_reason: string | null;
  player_name: string;
  player_phone: string;
  player_email: string | null;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  price: number | null;
  created_at: string;
  transactions: { confirmation_number: string | null } | null;
  courts: { name: string } | null;
}

// Same column shape/formatting as the "Booked Customers" export in
// app/admin/_components/ReportBookedCustomers.tsx (Export to Excel button)
// — kept in sync by hand, since that one builds its rows client-side from
// a browser Supabase query and this one runs server-side in a cron route.

function formatDatePH(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatSlotTimeRange(startIso: string, endIso: string) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Manila',
    });
  return `${fmt(startIso)} - ${fmt(endIso)}`;
}

function formatTransactionDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Fetches every booking whose slot date (start_time) falls in
// [startIso, endIso) — any status, any court, matching the "Booked Date"
// filter set to the full month with no other filters applied — and shapes
// it into the same CSV columns the manual export uses.
export async function buildMonthlyReportCsvRows(
  supabaseAdmin: SupabaseAdmin,
  startIso: string,
  endIso: string,
  showPrice: SiteSettings['show_price']
): Promise<Record<string, string | number>[]> {
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select(
      'id, admin_remark, reschedule_reason, player_name, player_phone, player_email, start_time, end_time, status, price, created_at, transactions(confirmation_number), courts(name)'
    )
    .gte('start_time', startIso)
    .lt('start_time', endIso)
    .order('start_time', { ascending: false });

  if (error) {
    throw new Error(`Failed to load bookings for monthly report: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as MonthlyReportBookingRow[];

  return rows.map((b) => ({
    'Confirmation #': b.transactions?.confirmation_number ?? '',
    'Transaction Date/Time': formatTransactionDateTime(b.created_at),
    Player: b.player_name,
    Phone: b.player_phone,
    Email: b.player_email ?? '',
    Court: b.courts?.name ?? '—',
    Date: formatDatePH(b.start_time),
    Time: formatSlotTimeRange(b.start_time, b.end_time),
    Status: b.status,
    ...(showPrice ? { Price: b.price !== null ? b.price : '' } : {}),
    Remark: b.admin_remark ?? '',
    'Reschedule Reason': b.reschedule_reason ?? '',
  }));
}
