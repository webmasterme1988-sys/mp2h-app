import type { SupabaseClient } from '@supabase/supabase-js';

export interface BlacklistEntry {
  id: number;
  email: string | null;
  phone: string | null;
  reason: string | null;
  created_at: string;
}

// Admin-only data (RLS restricts SELECT to authenticated users) — if the
// table isn't set up yet or the query fails, fall back to an empty list
// rather than breaking the tab.
export async function fetchBlacklist(supabase: SupabaseClient): Promise<BlacklistEntry[]> {
  const { data, error } = await supabase
    .from('blacklist')
    .select('id, email, phone, reason, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load blacklist, using none:', error);
    return [];
  }

  return data ?? [];
}
