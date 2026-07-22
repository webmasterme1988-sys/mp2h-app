import type { SupabaseClient } from '@supabase/supabase-js';

export interface LandingPhoto {
  id: number;
  image_url: string;
  caption: string | null;
  sort_order: number;
}

export const MAX_LANDING_PHOTOS = 12;

// Gallery photos on the marketing landing page are a nice-to-have — if the
// table isn't set up yet or the query fails, fall back to an empty gallery
// (the section just doesn't render) instead of breaking the page.
export async function fetchLandingPhotos(supabase: SupabaseClient): Promise<LandingPhoto[]> {
  const { data, error } = await supabase
    .from('landing_photos')
    .select('id, image_url, caption, sort_order')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error('Failed to load landing page photos, using none:', error);
    return [];
  }

  return data ?? [];
}
