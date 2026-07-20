'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';

async function uploadBrandingImage(file: File, prefix: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'png';
  const path = `${prefix}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from('branding')
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = supabase.storage.from('branding').getPublicUrl(path);
  return data.publicUrl;
}

export default function BrandingTab() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);

  const [siteTitle, setSiteTitle] = useState('');
  const [siteSubtitle, setSiteSubtitle] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#059669');
  const [submitButtonLabel, setSubmitButtonLabel] = useState('');

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);

  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const [removeQr, setRemoveQr] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSiteSettings(supabase).then((loaded) => {
      setSettings(loaded);
      setSiteTitle(loaded.site_title);
      setSiteSubtitle(loaded.site_subtitle);
      setPrimaryColor(loaded.primary_color);
      setSubmitButtonLabel(loaded.submit_button_label);
      setLoading(false);
    });
  }, []);

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setLogoFile(file);
    setRemoveLogo(false);
    setLogoPreview(file ? URL.createObjectURL(file) : null);
  }

  function handleQrChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setQrFile(file);
    setRemoveQr(false);
    setQrPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSaving(true);

    try {
      let logoUrl = settings.logo_url;
      if (removeLogo) logoUrl = null;
      if (logoFile) logoUrl = await uploadBrandingImage(logoFile, 'logo');

      let qrUrl = settings.gcash_qr_url;
      if (removeQr) qrUrl = null;
      if (qrFile) qrUrl = await uploadBrandingImage(qrFile, 'gcash-qr');

      const { error: upsertError } = await supabase.from('site_settings').upsert({
        id: 1,
        site_title: siteTitle.trim() || DEFAULT_SITE_SETTINGS.site_title,
        site_subtitle: siteSubtitle.trim(),
        primary_color: primaryColor,
        submit_button_label: submitButtonLabel.trim() || DEFAULT_SITE_SETTINGS.submit_button_label,
        logo_url: logoUrl,
        gcash_qr_url: qrUrl,
      });

      if (upsertError) throw new Error(upsertError.message);

      const refreshed = await fetchSiteSettings(supabase);
      setSettings(refreshed);
      setLogoFile(null);
      setLogoPreview(null);
      setRemoveLogo(false);
      setQrFile(null);
      setQrPreview(null);
      setRemoveQr(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
      if (qrInputRef.current) qrInputRef.current.value = '';
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save branding settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
        <p className="text-sm text-slate-400">Loading branding settings…</p>
      </section>
    );
  }

  const currentLogo = logoPreview ?? (removeLogo ? null : settings.logo_url);
  const currentQr = qrPreview ?? (removeQr ? null : settings.gcash_qr_url);

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Branding &amp; Settings</h2>
      <p className="text-sm text-slate-500 mb-6">
        Customize how the public booking page and receipts page look to customers.
      </p>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Header Title</label>
            <input
              type="text"
              value={siteTitle}
              onChange={(e) => setSiteTitle(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Primary Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-10 w-14 rounded-lg border border-slate-300 cursor-pointer"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#059669"
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Sub-text</label>
          <input
            type="text"
            value={siteSubtitle}
            onChange={(e) => setSiteSubtitle(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">
            &quot;Submit Booking&quot; Button Label
          </label>
          <input
            type="text"
            value={submitButtonLabel}
            onChange={(e) => setSubmitButtonLabel(e.target.value)}
            className="w-full sm:w-64 rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2 border-t border-slate-100">
          <div className="pt-4">
            <label className="block text-sm font-medium text-slate-600 mb-2">Logo</label>
            {currentLogo && (
              <img
                src={currentLogo}
                alt="Logo preview"
                className="h-16 w-auto object-contain mb-2 rounded border border-slate-200 bg-slate-50 p-2"
              />
            )}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoChange}
              className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-emerald-100"
            />
            {currentLogo && (
              <button
                type="button"
                onClick={() => {
                  setRemoveLogo(true);
                  setLogoFile(null);
                  setLogoPreview(null);
                  if (logoInputRef.current) logoInputRef.current.value = '';
                }}
                className="mt-2 text-xs text-red-600 hover:text-red-700 underline underline-offset-2"
              >
                Remove logo
              </button>
            )}
          </div>

          <div className="pt-4">
            <label className="block text-sm font-medium text-slate-600 mb-2">
              GCash QR Code
            </label>
            {currentQr && (
              <img
                src={currentQr}
                alt="QR code preview"
                className="h-16 w-16 object-contain mb-2 rounded border border-slate-200 bg-slate-50 p-2"
              />
            )}
            <input
              ref={qrInputRef}
              type="file"
              accept="image/*"
              onChange={handleQrChange}
              className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-emerald-100"
            />
            {currentQr && (
              <button
                type="button"
                onClick={() => {
                  setRemoveQr(true);
                  setQrFile(null);
                  setQrPreview(null);
                  if (qrInputRef.current) qrInputRef.current.value = '';
                }}
                className="mt-2 text-xs text-red-600 hover:text-red-700 underline underline-offset-2"
              >
                Remove QR code
              </button>
            )}
            {!currentQr && (
              <p className="mt-2 text-xs text-slate-400">
                Falls back to /public/gcash-qr.png until you upload one.
              </p>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-emerald-600">Saved.</p>}

        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-emerald-600 text-white font-medium px-6 py-2.5 text-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </section>
  );
}
