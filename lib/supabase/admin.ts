import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Bypasses RLS — only ever import this from server-only code (Route Handlers),
// never from a Client Component. Used to manage Supabase Auth users (inviting
// new admins), which requires the service role key.
//
// Built lazily (not at module load) so that importing this file doesn't throw
// before a caller's own auth checks get a chance to run — e.g. an
// unauthenticated request should get 401 from the route, not a 500 from a
// missing env var.
export function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (Supabase Dashboard → Project Settings → API).'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
