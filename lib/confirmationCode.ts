// Confirmation # ("MP2H-YYYYMMDD-NNN") is generated and stored directly on
// `transactions.confirmation_number` by a Postgres trigger at insert time
// (see the migration SQL) — every read path fetches it via an embedded
// `transactions(confirmation_number)` join rather than computing it here.
// That's a deliberate change from an earlier version of this file, which
// derived it on the fly from a per-booking daily_sequence + date; storing
// it directly means every screen reads the exact same value the DB
// assigned, with no risk of two call sites' formatting drifting apart.
//
// Reference # is "REF-XXXXXX", a hex encoding of the transaction id (offset
// by an arbitrary constant purely for appearance) — no scrambling, so
// consecutive transactions produce consecutive Reference #s, and it's
// unique for exactly the same reason transaction ids are unique: it's a
// direct, reversible encoding of the database's own auto-increment column.
// This one's still cheap enough to compute on the fly rather than store.

function toHex6(n: number): string {
  return (((n % 0x1000000) + 0x1000000) % 0x1000000).toString(16).toUpperCase().padStart(6, '0');
}

// Arbitrary starting point so Reference #s don't start at REF-000001 —
// doesn't affect uniqueness, since adding a constant to a unique sequence
// keeps it unique.
const REFERENCE_BASE = 0x0e36f0;

/** e.g. "REF-0E36F1" */
export function formatReferenceNumber(transactionId: number): string {
  return `REF-${toHex6(REFERENCE_BASE + transactionId)}`;
}
