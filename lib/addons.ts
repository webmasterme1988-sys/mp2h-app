import type { SupabaseClient } from '@supabase/supabase-js';

export interface Addon {
  id: number;
  name: string;
  price: number;
  max_quantity: number;
  active: boolean;
  sort_order: number;
}

// Rentable add-ons (paddles, etc) are a nice-to-have — if the table isn't
// set up yet or the query fails, fall back to none instead of breaking the
// booking page. Only active ones are offered to customers; fetchAllAddons
// (admin) sees everything including disabled ones.
export async function fetchActiveAddons(supabase: SupabaseClient): Promise<Addon[]> {
  const { data, error } = await supabase
    .from('addons')
    .select('id, name, price, max_quantity, active, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error('Failed to load add-ons, using none:', error);
    return [];
  }

  return data ?? [];
}

export async function fetchAllAddons(supabase: SupabaseClient): Promise<Addon[]> {
  const { data, error } = await supabase
    .from('addons')
    .select('id, name, price, max_quantity, active, sort_order')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error('Failed to load add-ons, using none:', error);
    return [];
  }

  return data ?? [];
}
