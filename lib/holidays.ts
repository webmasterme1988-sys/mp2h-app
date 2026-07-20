import type { SupabaseClient } from '@supabase/supabase-js';

export interface Holiday {
  id: number;
  holiday_date: string; // 'YYYY-MM-DD'
  name: string | null;
}

// Closures are a nice-to-have on top of core booking — if the table isn't
// set up yet or the query fails, fall back to "no holidays" rather than
// breaking the booking page.
export async function fetchHolidays(supabase: SupabaseClient): Promise<Holiday[]> {
  const { data, error } = await supabase
    .from('holidays')
    .select('id, holiday_date, name')
    .order('holiday_date', { ascending: true });

  if (error) {
    console.error('Failed to load holidays, using none:', error);
    return [];
  }

  return data ?? [];
}
