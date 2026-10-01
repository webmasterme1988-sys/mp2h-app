import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

// Deliberately narrower than the backup file's full table list — bookings,
// transactions, and booking_addons are never restored here. Those are the
// highest-volume, most foreign-key-sensitive tables, and this route uses
// upsert-by-id (never deletes), so restoring them could silently mix old
// and new booking data together rather than cleanly rolling anything back.
// This is meant for "I misconfigured something and want an earlier
// settings/courts/pricing snapshot back," not disaster recovery.
const RESTORABLE_TABLES = [
  'site_settings',
  'email_settings',
  'courts',
  'price_tiers',
  'addons',
  'holidays',
  'blocked_slots',
  'payment_qr_codes',
  'landing_photos',
  'blacklist',
] as const;

// Never written back, even if an uploaded file happens to include them
// (e.g. an older or hand-edited backup) — same secrets the backup route
// itself withholds.
const REDACTED_COLUMNS: Partial<Record<(typeof RESTORABLE_TABLES)[number], string[]>> = {
  email_settings: ['gmail_app_password', 'cron_secret'],
};

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const authedSupabase = createServerClient(
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
  } = await authedSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  if (user.app_metadata?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only a super admin can restore a backup.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid backup file.' }, { status: 400 });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Restore is not configured yet.' }, { status: 500 });
  }

  const restored: Record<string, number> = {};
  const skipped: string[] = [];
  const errors: string[] = [];

  // Anything in the uploaded file that isn't one of the restorable tables
  // (bookings, transactions, booking_addons, or an unrecognized key) is
  // reported back as skipped rather than silently ignored, so it's obvious
  // the restore didn't touch it.
  for (const key of Object.keys(body)) {
    if (key === 'generated_at' || key === '_errors') continue;
    if (!RESTORABLE_TABLES.includes(key as (typeof RESTORABLE_TABLES)[number])) {
      skipped.push(key);
    }
  }

  for (const table of RESTORABLE_TABLES) {
    const rows = body[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const redact = REDACTED_COLUMNS[table];
    const cleaned = redact
      ? rows.map((row: Record<string, unknown>) => {
          const copy = { ...row };
          for (const col of redact) delete copy[col];
          return copy;
        })
      : rows;

    const { error, count } = await supabaseAdmin
      .from(table)
      .upsert(cleaned, { onConflict: 'id', count: 'exact' });

    if (error) {
      console.error(`Restore: failed to upsert ${table}:`, error);
      errors.push(`${table}: ${error.message}`);
      continue;
    }

    restored[table] = count ?? cleaned.length;
  }

  return NextResponse.json({ success: true, restored, skipped, errors });
}
