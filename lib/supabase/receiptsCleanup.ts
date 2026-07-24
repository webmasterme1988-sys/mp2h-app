import { getSupabaseAdmin } from './admin';

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

// Shared between the two admin "reset" routes (full data wipe, and
// bookings-only wipe) — both need to clear every uploaded GCash receipt,
// which live one folder deep (`${date}/filename`) in the "receipts" bucket.
export async function clearReceiptsBucket(admin: SupabaseAdmin) {
  const { data: topLevel, error } = await admin.storage.from('receipts').list('', { limit: 1000 });
  if (error) throw error;

  const paths: string[] = [];
  for (const entry of topLevel ?? []) {
    if (entry.id === null) {
      // A "folder" (our upload paths are `${date}/filename`) — list one level deep.
      const { data: inner, error: innerError } = await admin.storage
        .from('receipts')
        .list(entry.name, { limit: 1000 });
      if (innerError) throw innerError;
      for (const file of inner ?? []) {
        paths.push(`${entry.name}/${file.name}`);
      }
    } else {
      paths.push(entry.name);
    }
  }

  if (paths.length === 0) return 0;

  const { error: removeError } = await admin.storage.from('receipts').remove(paths);
  if (removeError) throw removeError;
  return paths.length;
}
