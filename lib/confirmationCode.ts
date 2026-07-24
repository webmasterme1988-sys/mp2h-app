// Confirmation # is "MP2H-YYYYMMDD-NNN", where NNN is `bookings.daily_sequence`
// — a real, atomically-assigned counter (via a Postgres trigger, see the
// migration SQL) that starts over at 001 for each new court date. It's
// not derived/computed here; this just formats the value the DB already
// assigned.
//
// Reference # is "REF-XXXXXX", a hex encoding of the transaction id (offset
// by an arbitrary constant purely for appearance) — no scrambling, so
// consecutive transactions produce consecutive Reference #s, and it's
// unique for exactly the same reason transaction ids are unique: it's a
// direct, reversible encoding of the database's own auto-increment column.

function toHex6(n: number): string {
  return (((n % 0x1000000) + 0x1000000) % 0x1000000).toString(16).toUpperCase().padStart(6, '0');
}

// Arbitrary starting point so Reference #s don't start at REF-000001 —
// doesn't affect uniqueness, since adding a constant to a unique sequence
// keeps it unique.
const REFERENCE_BASE = 0x0e36f0;

/** e.g. "MP2H-20260723-001" */
export function formatConfirmationNumber(dailySequence: number, bookingDateISO: string): string {
  const compactDate = bookingDateISO.replace(/-/g, '');
  const seq = String(dailySequence).padStart(3, '0');
  return `MP2H-${compactDate}-${seq}`;
}

/** e.g. "REF-0E36F1" */
export function formatReferenceNumber(transactionId: number): string {
  return `REF-${toHex6(REFERENCE_BASE + transactionId)}`;
}
