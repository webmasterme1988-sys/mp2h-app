import type { SupabaseClient } from '@supabase/supabase-js';

export interface PriceTier {
  id: number;
  start_hour: number;
  end_hour: number;
  price: number;
}

export type PricingMode = 'flat' | 'tiered';

// Pricing is a nice-to-have on top of core booking — if the table isn't set
// up yet or the query fails, fall back to no tiers rather than breaking the
// booking page.
export async function fetchPriceTiers(supabase: SupabaseClient): Promise<PriceTier[]> {
  const { data, error } = await supabase
    .from('price_tiers')
    .select('id, start_hour, end_hour, price')
    .order('start_hour', { ascending: true });

  if (error) {
    console.error('Failed to load price tiers, using none:', error);
    return [];
  }

  return data ?? [];
}

export function getSlotPrice(
  hour: number,
  pricingMode: PricingMode,
  flatPrice: number,
  tiers: PriceTier[]
): number {
  if (pricingMode === 'flat') return flatPrice;
  const tier = tiers.find((t) => hour >= t.start_hour && hour < t.end_hour);
  return tier ? tier.price : 0;
}

export function formatPrice(amount: number): string {
  return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
