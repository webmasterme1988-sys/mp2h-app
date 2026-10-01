import 'server-only';
import { getSupabaseAdmin } from './supabase/admin';
import { receiptPathFromPublicUrl } from './supabase/receiptsCleanup';
import { manilaDateString } from './manilaTime';

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export interface BookingCleanupSummary {
  bookingsDeleted: number;
  transactionsDeleted: number;
  receiptsDeleted: number;
  errors: string[];
}

// The instant that is exactly `retentionDays` before today's Philippine
// calendar-date midnight — a booking whose start_time is earlier than this
// is more than `retentionDays` full days in the past.
function retentionCutoffIso(retentionDays: number, now: Date = new Date()): string {
  const [y, m, d] = manilaDateString(now).split('-').map(Number);
  const manilaMidnightUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - 8 * 60 * 60 * 1000;
  return new Date(manilaMidnightUtcMs - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

interface CandidateBooking {
  id: string;
  transaction_id: number | null;
  receipt_url: string | null;
}

// Deletes bookings whose slot date is more than `retentionDays` days in the
// past (Philippine calendar date), regardless of status — along with their
// add-ons, transaction row, and receipt file. A multi-slot booking is only
// deleted once EVERY one of its slots qualifies, so e.g. a reschedule that
// leaves one old hour and one still-upcoming hour on the same transaction
// doesn't get split: the shared receipt and add-ons stay intact and
// nothing is orphaned.
export async function runBookingCleanup(
  supabaseAdmin: SupabaseAdmin,
  retentionDays: number
): Promise<BookingCleanupSummary> {
  const summary: BookingCleanupSummary = {
    bookingsDeleted: 0,
    transactionsDeleted: 0,
    receiptsDeleted: 0,
    errors: [],
  };

  const cutoffIso = retentionCutoffIso(retentionDays);

  const { data: candidates, error: candidatesError } = await supabaseAdmin
    .from('bookings')
    .select('id, transaction_id, receipt_url')
    .lt('start_time', cutoffIso);

  if (candidatesError) {
    summary.errors.push(`bookings lookup: ${candidatesError.message}`);
    return summary;
  }
  const rows = (candidates ?? []) as CandidateBooking[];
  if (rows.length === 0) return summary;

  const candidateTransactionIds = Array.from(
    new Set(rows.map((r) => r.transaction_id).filter((id): id is number => id !== null))
  );

  // Exclude any transaction that still has a slot on or after the cutoff —
  // it doesn't fully qualify yet.
  let disqualifiedTransactionIds = new Set<number>();
  if (candidateTransactionIds.length > 0) {
    const { data: stillActive, error: activeError } = await supabaseAdmin
      .from('bookings')
      .select('transaction_id')
      .in('transaction_id', candidateTransactionIds)
      .gte('start_time', cutoffIso);

    if (activeError) {
      summary.errors.push(`active-slot lookup: ${activeError.message}`);
      return summary;
    }
    disqualifiedTransactionIds = new Set(
      (stillActive ?? [])
        .map((r) => (r as { transaction_id: number | null }).transaction_id)
        .filter((id): id is number => id !== null)
    );
  }

  const toDelete = rows.filter(
    (r) => r.transaction_id === null || !disqualifiedTransactionIds.has(r.transaction_id)
  );
  if (toDelete.length === 0) return summary;

  const bookingIds = toDelete.map((r) => r.id);
  const qualifyingTransactionIds = Array.from(
    new Set(toDelete.map((r) => r.transaction_id).filter((id): id is number => id !== null))
  );
  const receiptPaths = Array.from(
    new Set(
      toDelete
        .map((r) => (r.receipt_url ? receiptPathFromPublicUrl(r.receipt_url) : null))
        .filter((p): p is string => p !== null)
    )
  );

  // Deletion order matters: booking_addons and bookings both reference
  // transactions, so they have to go first, same as /api/admin/reset-bookings.
  if (qualifyingTransactionIds.length > 0) {
    const { error } = await supabaseAdmin
      .from('booking_addons')
      .delete()
      .in('transaction_id', qualifyingTransactionIds);
    if (error) summary.errors.push(`booking_addons: ${error.message}`);
  }

  const { error: bookingsError, count } = await supabaseAdmin
    .from('bookings')
    .delete({ count: 'exact' })
    .in('id', bookingIds);
  if (bookingsError) {
    summary.errors.push(`bookings: ${bookingsError.message}`);
  } else {
    summary.bookingsDeleted = count ?? bookingIds.length;
  }

  if (qualifyingTransactionIds.length > 0) {
    const { error, count: txCount } = await supabaseAdmin
      .from('transactions')
      .delete({ count: 'exact' })
      .in('id', qualifyingTransactionIds);
    if (error) {
      summary.errors.push(`transactions: ${error.message}`);
    } else {
      summary.transactionsDeleted = txCount ?? qualifyingTransactionIds.length;
    }
  }

  if (receiptPaths.length > 0) {
    const { error } = await supabaseAdmin.storage.from('receipts').remove(receiptPaths);
    if (error) {
      summary.errors.push(`receipts: ${error.message}`);
    } else {
      summary.receiptsDeleted = receiptPaths.length;
    }
  }

  return summary;
}
