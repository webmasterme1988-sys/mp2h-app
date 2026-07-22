import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  // Verify the caller is a logged-in admin before letting them invite anyone.
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

  // Only the super admin may invite new admins — matches the Admins tab
  // being hidden from everyone else, checked against app_metadata, which
  // regular users cannot set on themselves (only the service-role key can).
  if (user.app_metadata?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only a super admin can invite new admins.' }, { status: 403 });
  }

  const { email } = (await request.json().catch(() => ({}))) as { email?: string };

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Please provide a valid email address.' }, { status: 400 });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: 'Admin invites are not configured yet.' },
      { status: 500 }
    );
  }

  // Prefer an explicitly configured production URL over the incoming
  // request's own origin — otherwise an invite sent while testing locally
  // would point recipients at an unreachable localhost link. Supabase also
  // requires this exact URL to be allow-listed under Authentication → URL
  // Configuration → Redirect URLs, or it silently falls back to the
  // project's default Site URL instead of honoring redirectTo.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.url;

  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: new URL('/admin/set-password', siteUrl).toString(),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
