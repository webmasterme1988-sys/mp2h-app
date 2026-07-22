'use client';

import { useEffect, useState } from 'react';
import type { LandingPhoto } from '@/lib/landingPhotos';

interface GalleryLightboxProps {
  photos: LandingPhoto[];
}

export default function GalleryLightbox({ photos }: GalleryLightboxProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    if (openIndex === null) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenIndex(null);
      else if (e.key === 'ArrowRight') setOpenIndex((i) => (i === null ? i : (i + 1) % photos.length));
      else if (e.key === 'ArrowLeft')
        setOpenIndex((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
    }

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKey);
    };
  }, [openIndex, photos.length]);

  if (photos.length === 0) return null;

  const current = openIndex !== null ? photos[openIndex] : null;

  function showPrev() {
    setOpenIndex((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
  }

  function showNext() {
    setOpenIndex((i) => (i === null ? i : (i + 1) % photos.length));
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((photo, i) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setOpenIndex(i)}
            className="rounded-2xl overflow-hidden border border-slate-200 text-left cursor-zoom-in group"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.image_url}
              alt={photo.caption ?? ''}
              className="w-full h-40 object-cover group-hover:scale-105 transition-transform duration-200"
            />
            {photo.caption && (
              <p className="text-xs text-slate-500 px-2 py-1.5">{photo.caption}</p>
            )}
          </button>
        ))}
      </div>

      {current && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center px-4"
          onClick={() => setOpenIndex(null)}
        >
          <button
            type="button"
            onClick={() => setOpenIndex(null)}
            aria-label="Close"
            className="absolute top-4 right-4 text-white/80 hover:text-white text-3xl leading-none"
          >
            &times;
          </button>

          {photos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                showPrev();
              }}
              aria-label="Previous image"
              className="absolute left-2 sm:left-6 text-white/80 hover:text-white text-4xl leading-none px-2 py-4"
            >
              &lsaquo;
            </button>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.image_url}
            alt={current.caption ?? ''}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-full object-contain rounded-lg"
          />

          {photos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                showNext();
              }}
              aria-label="Next image"
              className="absolute right-2 sm:right-6 text-white/80 hover:text-white text-4xl leading-none px-2 py-4"
            >
              &rsaquo;
            </button>
          )}

          {current.caption && (
            <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 text-sm px-4 text-center">
              {current.caption}
            </p>
          )}
        </div>
      )}
    </>
  );
}
