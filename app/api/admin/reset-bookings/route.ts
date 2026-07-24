import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { clearReceiptsBucket } from '@/lib/supabase/receiptsCleanup';

// Deletes every booking (and everything derived from one — add-ons,
// transactions, confirmation/reference numbers, reschedule reasons,
// remarks, uploaded receipts) without touching site settings, courts,
// pricing, holidays, blocked slots, or any admin account. That's the
// scope difference from /api/admin/reset, which wipes bookings *and*
// every other admin account.
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
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
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  if (user.app_metadata?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only a super admin can reset bookings.' }, { status: 403 });
  }

  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Reset is not configured yet.' }, { status: 500 });
  }

  const summary = {
    bookingsDeleted: 0,
    receiptsDeleted: 0,
    errors: [] as string[],
  };

  // Deletion order matters: booking_addons and bookings both reference
  // transactions, so they have to go first, or the FK constraint blocks
  // deleting the transaction rows.
  try {
    const { error } = await supabaseAdmin.from('booking_addons').delete().not('id', 'is', null);
    if (error) throw error;
  } catch (err) {
    summary.errors.push(`booking add-ons: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const { error, count } = await supabaseAdmin
      .from('bookings')
      .delete({ count: 'exact' })
      .not('id', 'is', null);
    if (error) throw error;
    summary.bookingsDeleted = count ?? 0;
  } catch (err) {
    summary.errors.push(`bookings: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Active checkout holds are ephemeral and self-expire anyway, but a
  // reset should leave nothing stale behind.
  try {
    const { error } = await supabaseAdmin.from('slot_holds').delete().not('id', 'is', null);
    if (error) throw error;
  } catch (err) {
    summary.errors.push(`slot holds: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const { error } = await supabaseAdmin.from('transactions').delete().not('id', 'is', null);
    if (error) throw error;
  } catch (err) {
    summary.errors.push(`transactions: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Confirmation # and Reference # are both derived from transactions.id —
  // resetting its sequence is what makes the *next* booking start back at
  // Confirmation #001 / the original Reference # base, instead of
  // continuing from wherever the old (now-deleted) transactions left off.
  try {
    const { error } = await supabaseAdmin.rpc('reset_transactions_sequence');
    if (error) throw error;
  } catch (err) {
    summary.errors.push(`sequence reset: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    summary.receiptsDeleted = await clearReceiptsBucket(supabaseAdmin);
  } catch (err) {
    summary.errors.push(`receipts: ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json(summary);
}
