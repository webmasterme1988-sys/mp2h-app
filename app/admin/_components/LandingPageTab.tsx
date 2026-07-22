'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchSiteSettings } from '@/lib/siteSettings';
import { fetchLandingPhotos, MAX_LANDING_PHOTOS, type LandingPhoto } from '@/lib/landingPhotos';
import { uploadBrandingImage, brandingPathFromPublicUrl } from '@/lib/brandingStorage';
import RichTextEditor from './RichTextEditor';

export default function LandingPageTab() {
  const [loading, setLoading] = useState(true);

  const [tagline, setTagline] = useState('');
  const [aboutHtml, setAboutHtml] = useState('');
  const [policyHtml, setPolicyHtml] = useState('');
  const [address, setAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [facebookUrl, setFacebookUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [facebookPageId, setFacebookPageId] = useState('');
  const [enableFbChat, setEnableFbChat] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetchSiteSettings(supabase).then((loaded) => {
      setTagline(loaded.landing_tagline ?? '');
      setAboutHtml(loaded.landing_about_html ?? '');
      setPolicyHtml(loaded.landing_policy_html ?? '');
      setAddress(loaded.landing_address ?? '');
      setContactPhone(loaded.landing_contact_phone ?? '');
      setContactEmail(loaded.landing_contact_email ?? '');
      setFacebookUrl(loaded.landing_facebook_url ?? '');
      setInstagramUrl(loaded.landing_instagram_url ?? '');
      setGoogleMapsUrl(loaded.landing_google_maps_url ?? '');
      setFacebookPageId(loaded.landing_facebook_page_id ?? '');
      setEnableFbChat(loaded.landing_enable_fb_chat ?? false);
      setLoading(false);
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSaving(true);

    const { error: upsertError } = await supabase.from('site_settings').upsert({
      id: 1,
      landing_tagline: tagline.trim() || null,
      landing_about_html: aboutHtml.trim() || null,
      landing_policy_html: policyHtml.trim() || null,
      landing_address: address.trim() || null,
      landing_contact_phone: contactPhone.trim() || null,
      landing_contact_email: contactEmail.trim() || null,
      landing_facebook_url: facebookUrl.trim() || null,
      landing_instagram_url: instagramUrl.trim() || null,
      landing_google_maps_url: googleMapsUrl.trim() || null,
      landing_facebook_page_id: facebookPageId.trim() || null,
      landing_enable_fb_chat: enableFbChat,
    });

    if (upsertError) {
      setError(upsertError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setSuccess(true);
  }

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-2xl">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Landing Page</h2>
        <p className="text-sm text-slate-500 mb-6">
          Content for the public marketing page at <code className="text-xs">/</code> — the
          booking flow itself now lives at <code className="text-xs">/booking</code>. Sections
          left blank here are simply hidden on the page.
        </p>

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Tagline</label>
              <input
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="One Court. One Community. All Good Vibes!"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">About</label>
              <RichTextEditor
                value={aboutHtml}
                onChange={setAboutHtml}
                placeholder="Tell customers about the facility…"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Booking &amp; Reservation Policy
              </label>
              <RichTextEditor
                value={policyHtml}
                onChange={setPolicyHtml}
                placeholder="e.g. cancellation policy, rain/weather policy…"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Contact Phone
                </label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Contact Email
                </label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Facebook URL
                </label>
                <input
                  type="url"
                  value={facebookUrl}
                  onChange={(e) => setFacebookUrl(e.target.value)}
                  placeholder="https://facebook.com/…"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Instagram URL
                </label>
                <input
                  type="url"
                  value={instagramUrl}
                  onChange={(e) => setInstagramUrl(e.target.value)}
                  placeholder="https://instagram.com/…"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Google Maps URL <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="url"
                value={googleMapsUrl}
                onChange={(e) => setGoogleMapsUrl(e.target.value)}
                placeholder="https://maps.app.goo.gl/…"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                Paste a Google Maps share link for this location. If left blank, the map and
                directions button on the landing page will be generated automatically from the
                Address above.
              </p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-emerald-600">Saved.</p>}

            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] font-medium px-6 py-2.5 text-sm hover:brightness-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </form>
        )}
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-2xl">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Facebook Messenger Chat</h2>
        <p className="text-sm text-slate-500 mb-4">
          Adds the Facebook Customer Chat widget to the landing page so visitors can message your
          Page directly.
        </p>

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Facebook Page ID
              </label>
              <input
                type="text"
                value={facebookPageId}
                onChange={(e) => setFacebookPageId(e.target.value)}
                placeholder="e.g. 123456789012345"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                Find this under your Facebook Page&apos;s About → Page transparency, or Meta
                Business Suite → Settings.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={enableFbChat}
                onChange={(e) => setEnableFbChat(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Show Facebook Chat widget on the landing page
            </label>

            <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 space-y-1">
              <p className="font-medium text-slate-600">Before this will work, in Meta Business Suite:</p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Enable &quot;Customer Chat&quot; for your Page under Inbox → Settings.</li>
                <li>
                  Under your Facebook App → Facebook Login → Settings, add this site&apos;s domain
                  to &quot;Allowed Domains for the JavaScript SDK&quot;.
                </li>
              </ol>
              <p>The widget won&apos;t appear to visitors until both are done.</p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-emerald-600">Saved.</p>}

            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] font-medium px-6 py-2.5 text-sm hover:brightness-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </form>
        )}
      </section>

      <PhotoGallerySection />
    </div>
  );
}

// ---------- Photo Gallery (up to MAX_LANDING_PHOTOS) ----------

function PhotoGallerySection() {
  const [photos, setPhotos] = useState<LandingPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [photosError, setPhotosError] = useState<string | null>(null);

  const [newCaption, setNewCaption] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [removingPhotoId, setRemovingPhotoId] = useState<number | null>(null);

  const newFileInputRef = useRef<HTMLInputElement>(null);

  const fetchPhotos = useCallback(async () => {
    setPhotosLoading(true);
    setPhotosError(null);
    const list = await fetchLandingPhotos(supabase);
    setPhotos(list);
    setPhotosLoading(false);
  }, []);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  async function handleAddPhoto(e: React.FormEvent) {
    e.preventDefault();
    if (!newFile) return;

    setAddingPhoto(true);
    setPhotosError(null);

    try {
      const imageUrl = await uploadBrandingImage(newFile, 'landing');

      const { error } = await supabase.from('landing_photos').insert({
        image_url: imageUrl,
        caption: newCaption.trim() || null,
        sort_order: photos.length,
      });

      if (error) throw new Error(error.message);

      setNewCaption('');
      setNewFile(null);
      if (newFileInputRef.current) newFileInputRef.current.value = '';
      await fetchPhotos();
    } catch (err) {
      setPhotosError(err instanceof Error ? err.message : 'Could not add photo.');
    } finally {
      setAddingPhoto(false);
    }
  }

  async function handleRemovePhoto(photo: LandingPhoto) {
    if (!window.confirm('Remove this photo from the gallery?')) return;

    setRemovingPhotoId(photo.id);
    setPhotosError(null);

    const { error } = await supabase.from('landing_photos').delete().eq('id', photo.id);

    if (error) {
      setPhotosError(`Could not remove photo: ${error.message}`);
      setRemovingPhotoId(null);
      return;
    }

    const path = brandingPathFromPublicUrl(photo.image_url);
    if (path) {
      await supabase.storage.from('branding').remove([path]);
    }

    setRemovingPhotoId(null);
    await fetchPhotos();
  }

  const atMax = photos.length >= MAX_LANDING_PHOTOS;

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Photo Gallery</h2>
      <p className="text-sm text-slate-500 mb-4">
        Up to {MAX_LANDING_PHOTOS} photos shown on the landing page — court shots, events, the
        community in action.
      </p>

      {photosError && <p className="text-sm text-red-600 mb-3">{photosError}</p>}

      {photosLoading ? (
        <p className="text-sm text-slate-400 mb-4">Loading photos…</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
          {photos.length === 0 && (
            <p className="text-sm text-slate-400 col-span-full">No photos added yet.</p>
          )}
          {photos.map((photo) => (
            <div key={photo.id} className="rounded-xl border border-slate-200 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.image_url}
                alt={photo.caption ?? 'Gallery photo'}
                className="w-full h-24 object-cover"
              />
              <div className="p-2">
                {photo.caption && (
                  <p className="text-xs text-slate-600 truncate mb-1">{photo.caption}</p>
                )}
                <button
                  onClick={() => handleRemovePhoto(photo)}
                  disabled={removingPhotoId === photo.id}
                  className="w-full rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-2 py-1 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {removingPhotoId === photo.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {atMax ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Maximum of {MAX_LANDING_PHOTOS} photos reached. Remove one to add another.
        </p>
      ) : (
        <form onSubmit={handleAddPhoto} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Caption <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={newCaption}
                onChange={(e) => setNewCaption(e.target.value)}
                placeholder="Court 1 at sunset"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Photo</label>
              <input
                ref={newFileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-emerald-100"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={addingPhoto || !newFile}
            className="rounded-lg bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] text-sm font-medium px-4 py-2.5 hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {addingPhoto ? 'Adding…' : 'Add Photo'}
          </button>
        </form>
      )}
    </section>
  );
}
