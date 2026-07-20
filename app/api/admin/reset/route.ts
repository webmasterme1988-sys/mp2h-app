import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

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

  // Only the super admin may wipe data — this is checked against
  // `app_metadata`, which regular users cannot set on themselves (only the
  // service-role key can), unlike `user_metadata`.
  if (user.app_metadata?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only a super admin can reset all data.' }, { status: 403 });
  }

  let supabaseAdmin: SupabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Reset is not configured yet.' }, { status: 500 });
  }

  const summary = {
    bookingsDeleted: 0,
    receiptsDeleted: 0,
    usersDeleted: 0,
    errors: [] as string[],
  };

  // 1. Delete all bookings
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

  // 2. Clear uploaded GCash receipts
  try {
    summary.receiptsDeleted = await clearReceiptsBucket(supabaseAdmin);
  } catch (err) {
    summary.errors.push(`receipts: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Delete every admin user except whoever is running the reset, so the
  //    person clicking the button never locks themselves out of the panel.
  try {
    const { data: usersList, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;

    const others = usersList.users.filter((u) => u.id !== user.id);
    for (const other of others) {
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(other.id);
      if (deleteError) {
        summary.errors.push(`user ${other.email}: ${deleteError.message}`);
      } else {
        summary.usersDeleted += 1;
      }
    }
  } catch (err) {
    summary.errors.push(`users: ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json(summary);
}

async function clearReceiptsBucket(admin: SupabaseAdmin) {
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
