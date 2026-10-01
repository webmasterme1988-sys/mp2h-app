import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

// Every table with meaningful data to preserve. Deliberately excludes
// slot_holds (a few-minutes-long checkout reservation, not data worth
// keeping) and doesn't touch the "branding"/"receipts" storage buckets —
// this is a data snapshot of the tables, not a full asset backup.
const BACKUP_TABLES = [
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
  'transactions',
  'bookings',
  'booking_addons',
] as const;

// Columns withheld from every table dump — mirrors the same
// write-only-to-the-dashboard protection these already have (see
// lib/emailSettings.ts / lib/mailer.ts): a downloaded backup file can end up
// in an inbox or a shared drive, so the actual secret values never leave
// the database, only whether each is currently set.
const REDACTED_COLUMNS: Partial<Record<(typeof BACKUP_TABLES)[number], string[]>> = {
  email_settings: ['gmail_app_password', 'cron_secret'],
};

export async function POST() {
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
    return NextResponse.json({ error: 'Only a super admin can download a backup.' }, { status: 403 });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Backup is not configured yet.' }, { status: 500 });
  }

  const backup: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
  };
  const errors: string[] = [];

  for (const table of BACKUP_TABLES) {
    const { data, error } = await supabaseAdmin.from(table).select('*');

    if (error) {
      console.error(`Backup: failed to read ${table}:`, error);
      errors.push(`${table}: ${error.message}`);
      continue;
    }

    const redact = REDACTED_COLUMNS[table];
    backup[table] = redact
      ? (data ?? []).map((row) => {
          const copy = { ...(row as Record<string, unknown>) };
          for (const col of redact) delete copy[col];
          return copy;
        })
      : (data ?? []);
  }

  if (errors.length > 0) {
    backup._errors = errors;
  }

  const filename = `mp2h-backup-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(backup, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
