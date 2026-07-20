// Downscales + re-encodes an image client-side before upload, so receipt
// photos (often several MB straight off a phone camera) don't bloat Storage
// usage or the email attachment sent on every booking. Caps the longest
// side at maxDimension and re-encodes as JPEG at the given quality — plenty
// to keep a payment receipt's amount/reference number legible.
export async function compressImage(
  file: File,
  maxDimension = 1600,
  quality = 0.8
): Promise<File> {
  // Skip already-small files and non-raster types Canvas can't reliably
  // re-encode (e.g. animated GIFs would lose their animation).
  if (file.size < 300 * 1024 || file.type === 'image/gif') {
    return file;
  }

  try {
    const objectUrl = URL.createObjectURL(file);
    const image = await loadImage(objectUrl);
    URL.revokeObjectURL(objectUrl);

    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
  } catch (err) {
    // Compression is an optimization, not a requirement — never block the
    // booking over it.
    console.error('Image compression failed, using original file:', err);
    return file;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
