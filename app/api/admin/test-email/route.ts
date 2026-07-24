import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getMailTransporter, fetchEmailCredentials } from '@/lib/mailer';

// Lets an admin confirm their Gmail App Password actually works, right from
// Branding & Settings, instead of finding out only when a real booking
// notification silently fails to send.
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

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
  }

  const credentials = await fetchEmailCredentials(supabaseAdmin);
  if (!credentials?.gmailUser || !credentials.gmailAppPassword) {
    return NextResponse.json(
      { error: 'Gmail Address and App Password must be saved first.' },
      { status: 400 }
    );
  }

  let transporter;
  try {
    transporter = getMailTransporter(credentials.gmailUser, credentials.gmailAppPassword);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Notifications are not configured yet.' }, { status: 500 });
  }

  // Same recipient the real "new booking" admin alert uses, so a
  // successful test genuinely confirms that path works end to end.
  const to = credentials.adminNotificationEmail || credentials.gmailUser;

  try {
    await transporter.sendMail({
      from: credentials.gmailUser,
      to,
      subject: 'Test email from MP2H Admin',
      text: `This is a test email sent from Admin → Branding & Settings → Email Notifications, confirming ${credentials.gmailUser} is set up correctly.\n\nSent at ${new Date().toISOString()}.`,
    });
  } catch (err) {
    console.error('Failed to send test email:', err);
    const message = err instanceof Error ? err.message : 'Could not send test email.';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true, to });
}
