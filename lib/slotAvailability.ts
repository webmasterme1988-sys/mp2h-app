import type { SupabaseClient } from '@supabase/supabase-js';
import type { TimeSlot } from './timeSlots';

// Shared between the public booking flow and the admin "Book for Customer"
// flow so both enforce the exact same anti-double-booking rule — a slot is
// taken if it has a real booking (pending within its approval-hold window,
// or confirmed), a blocked_slots row, or (optionally) another customer's
// active checkout hold.
export async function hasSlotConflict(
  supabase: SupabaseClient,
  courtId: string,
  date: string,
  slots: TimeSlot[],
  approvalHoldMs: number,
  options: { includeActiveHolds?: boolean; checkoutHoldMs?: number } = {}
): Promise<boolean> {
  const { includeActiveHolds = false, checkoutHoldMs = 0 } = options;

  const dayStart = new Date(`${date}T00:00:00`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59`).toISOString();

  const [bookingsResult, blockedResult, holdsResult] = await Promise.all([
    supabase
      .from('bookings')
      .select('start_time, status, created_at')
      .eq('court_id', courtId)
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd)
      .in('status', ['pending', 'confirmed']),
    supabase
      .from('blocked_slots')
      .select('start_time')
      .eq('court_id', courtId)
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd),
    includeActiveHolds
      ? supabase
          .from('slot_holds')
          .select('start_time, created_at')
          .eq('court_id', courtId)
          .gte('start_time', dayStart)
          .lte('start_time', dayEnd)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const nowTime = Date.now();
  const takenTimes = new Set<number>(
    ((bookingsResult.data as { start_time: string; status: string; created_at: string }[]) ?? [])
      .filter((row) => {
        if (row.status !== 'pending') return true;
        return nowTime - new Date(row.created_at).getTime() < approvalHoldMs;
      })
      .map((row) => new Date(row.start_time).getTime())
  );
  ((blockedResult.data as { start_time: string }[]) ?? []).forEach((row) =>
    takenTimes.add(new Date(row.start_time).getTime())
  );
  if (includeActiveHolds) {
    ((holdsResult.data as { start_time: string; created_at: string }[] | null) ?? [])
      .filter((row) => nowTime - new Date(row.created_at).getTime() < checkoutHoldMs)
      .forEach((row) => takenTimes.add(new Date(row.start_time).getTime()));
  }

  return slots.some((slot) => takenTimes.has(new Date(slot.startISO(date)).getTime()));
}
