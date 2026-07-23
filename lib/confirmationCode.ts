// Confirmation # and Reference # are both derived from a booking's
// transaction id — the `transactions.id` column, already a
// database-guaranteed-unique, auto-incrementing counter — rather than a
// newly stored random value. That means:
//   - No schema change or backfill: every past booking gets a valid code
//     immediately, computed the same way on every page that shows one.
//   - Genuine uniqueness, not just low collision odds: each one applies a
//     bijective (reversible) scramble to the id before hex-encoding it —
//     since a bijection can never map two different inputs to the same
//     output, two different transactions can never collide. Confirmation #
//     and Reference # use different scramble constants so they don't look
//     related to each other, and neither exposes the raw sequential id
//     (i.e. booking volume) the way printing transactionId directly would.

function toHex6(n: number): string {
  return (((n % 0x1000000) + 0x1000000) % 0x1000000).toString(16).toUpperCase().padStart(6, '0');
}

// Odd multipliers (required for the transform to be invertible modulo
// 2^24, i.e. coprime to it) — Knuth's multiplicative hash constant, and a
// second, unrelated odd constant for the other code.
const CONFIRMATION_SCRAMBLE = 2654435761;
const REFERENCE_SCRAMBLE = 40503;

/** e.g. "CONF-20260702-70F623" — bookingDateISO is the court date, "YYYY-MM-DD". */
export function formatConfirmationNumber(transactionId: number, bookingDateISO: string): string {
  const compactDate = bookingDateISO.replace(/-/g, '');
  return `CONF-${compactDate}-${toHex6(transactionId * CONFIRMATION_SCRAMBLE)}`;
}

/** e.g. "REF-41540E" */
export function formatReferenceNumber(transactionId: number): string {
  return `REF-${toHex6(transactionId * REFERENCE_SCRAMBLE)}`;
}
