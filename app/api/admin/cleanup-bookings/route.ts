import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { fetchSiteSettings } from '@/lib/siteSettings';
import { runBookingCleanup } from '@/lib/bookingCleanup';
import { manilaDateString } from '@/lib/manilaTime';

// Lets a super admin run the configured cleanup immediately instead of
// waiting for the next scheduled hour — same underlying logic as the cron
// route (lib/bookingCleanup), just triggered from the dashboard. Also
// stamps booking_cleanup_last_run_date so the cron job doesn't redundantly
// run again later the same day.
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
    return NextResponse.json({ error: 'Only a super admin can run cleanup.' }, { status: 403 });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Cleanup is not configured yet.' }, { status: 500 });
  }

  const settings = await fetchSiteSettings(supabaseAdmin);
  const summary = await runBookingCleanup(supabaseAdmin, settings.booking_cleanup_retention_days);

  const { error: updateError } = await supabaseAdmin
    .from('site_settings')
    .update({ booking_cleanup_last_run_date: manilaDateString() })
    .eq('id', 1);
  if (updateError) {
    summary.errors.push(`last_run_date: ${updateError.message}`);
  }

  return NextResponse.json({ success: true, ...summary });
}
