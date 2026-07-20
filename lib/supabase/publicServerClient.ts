import { createClient } from '@supabase/supabase-js';

// For Server Components reading public, unauthenticated data (site
// branding, QR codes, holidays) before the page ever reaches the browser —
// no cookies/session needed since this data has no per-user access rules.
export function createPublicServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
