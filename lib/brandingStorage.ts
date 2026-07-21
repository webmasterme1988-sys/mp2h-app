import { supabase } from '@/lib/supabase';

// Shared by every branding-style image (logo, payment QR codes, marketing
// image) — they all live in the same public "branding" storage bucket,
// distinguished only by filename prefix.
export async function uploadBrandingImage(file: File, prefix: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'png';
  const path = `${prefix}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from('branding')
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = supabase.storage.from('branding').getPublicUrl(path);
  return data.publicUrl;
}

// Public URLs look like `.../storage/v1/object/public/branding/<path>` —
// pull the path back out so we can also delete the underlying file.
export function brandingPathFromPublicUrl(url: string): string | null {
  const marker = '/branding/';
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length);
}
