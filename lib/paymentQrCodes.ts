import type { SupabaseClient } from '@supabase/supabase-js';

export interface PaymentQrCode {
  id: number;
  label: string;
  image_url: string;
  sort_order: number;
}

export const MAX_PAYMENT_QR_CODES = 6;

// Payment options are a nice-to-have, not core booking functionality — if
// the table isn't set up yet or the query fails, fall back to an empty list
// so the page can fall back to the static default QR image instead.
export async function fetchPaymentQrCodes(supabase: SupabaseClient): Promise<PaymentQrCode[]> {
  const { data, error } = await supabase
    .from('payment_qr_codes')
    .select('id, label, image_url, sort_order')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error('Failed to load payment QR codes, using none:', error);
    return [];
  }

  return data ?? [];
}
