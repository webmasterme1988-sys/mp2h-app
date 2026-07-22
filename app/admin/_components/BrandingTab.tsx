'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';
import { fetchPaymentQrCodes, MAX_PAYMENT_QR_CODES, type PaymentQrCode } from '@/lib/paymentQrCodes';
import { fetchEmailSettings, DEFAULT_EMAIL_SETTINGS, type EmailSettings } from '@/lib/emailSettings';
import { uploadBrandingImage, brandingPathFromPublicUrl } from '@/lib/brandingStorage';

export default function BrandingTab() {
  // ---------- Site settings (title, subtitle, color, button label, logo, note) ----------

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);

  const [siteTitle, setSiteTitle] = useState('');
  const [siteSubtitle, setSiteSubtitle] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#059669');
  const [selectionColor, setSelectionColor] = useState('#059669');
  const [buttonBgColor, setButtonBgColor] = useState('#059669');
  const [buttonLabelColor, setButtonLabelColor] = useState('#ffffff');
  const [adminTabFontColor, setAdminTabFontColor] = useState('#475569');
  const [adminTabActiveBgColor, setAdminTabActiveBgColor] = useState('#059669');
  const [submitButtonLabel, setSubmitButtonLabel] = useState('');
  const [paymentNote, setPaymentNote] = useState('');

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoHeight, setLogoHeight] = useState(DEFAULT_SITE_SETTINGS.logo_height);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSiteSettings(supabase).then((loaded) => {
      setSettings(loaded);
      setSiteTitle(loaded.site_title);
      setSiteSubtitle(loaded.site_subtitle);
      setPrimaryColor(loaded.primary_color);
      setSelectionColor(loaded.selection_color);
      setButtonBgColor(loaded.button_bg_color);
      setButtonLabelColor(loaded.button_label_color);
      setAdminTabFontColor(loaded.admin_tab_font_color);
      setAdminTabActiveBgColor(loaded.admin_tab_active_bg_color);
      setSubmitButtonLabel(loaded.submit_button_label);
      setPaymentNote(loaded.payment_note ?? '');
      setLogoHeight(loaded.logo_height);
      setLoading(false);
    });
  }, []);

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setLogoFile(file);
    setRemoveLogo(false);
    setLogoPreview(file ? URL.createObjectURL(file) : null);
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

      const { error: upsertError } = await supabase.from('site_settings').upsert({
        id: 1,
        site_title: siteTitle.trim() || DEFAULT_SITE_SETTINGS.site_title,
        site_subtitle: siteSubtitle.trim(),
        primary_color: primaryColor,
        selection_color: selectionColor,
        button_bg_color: buttonBgColor,
        button_label_color: buttonLabelColor,
        admin_tab_font_color: adminTabFontColor,
        admin_tab_active_bg_color: adminTabActiveBgColor,
        submit_button_label: submitButtonLabel.trim() || DEFAULT_SITE_SETTINGS.submit_button_label,
        logo_url: logoUrl,
        logo_height: logoHeight,
        payment_note: paymentNote.trim() || null,
      });

      if (upsertError) throw new Error(upsertError.message);

      const refreshed = await fetchSiteSettings(supabase);
      setSettings(refreshed);
      setLogoFile(null);
      setLogoPreview(null);
      setRemoveLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save branding settings.');
    } finally {
      setSaving(false);
    }
  }

  const currentLogo = logoPreview ?? (removeLogo ? null : settings.logo_url);

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-2xl">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Branding &amp; Settings</h2>
        <p className="text-sm text-slate-500 mb-6">
          Customize how the public booking page looks to customers.
        </p>

        {loading ? (
          <p className="text-sm text-slate-400">Loading branding settings…</p>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Header Title
                </label>
                <input
                  type="text"
                  value={siteTitle}
                  onChange={(e) => setSiteTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Primary Color
                </label>
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

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Selected Court / Date Color
                </label>
                <p className="text-xs text-slate-400 mb-1.5">
                  The highlight color for the currently selected court, date, or time slot.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectionColor}
                    onChange={(e) => setSelectionColor(e.target.value)}
                    className="h-10 w-14 rounded-lg border border-slate-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={selectionColor}
                    onChange={(e) => setSelectionColor(e.target.value)}
                    placeholder="#059669"
                    className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Button Background Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={buttonBgColor}
                    onChange={(e) => setButtonBgColor(e.target.value)}
                    className="h-10 w-14 rounded-lg border border-slate-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={buttonBgColor}
                    onChange={(e) => setButtonBgColor(e.target.value)}
                    placeholder="#059669"
                    className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Button Label Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={buttonLabelColor}
                    onChange={(e) => setButtonLabelColor(e.target.value)}
                    className="h-10 w-14 rounded-lg border border-slate-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={buttonLabelColor}
                    onChange={(e) => setButtonLabelColor(e.target.value)}
                    placeholder="#ffffff"
                    className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700 mb-1">Admin Dashboard Appearance</h3>
              <p className="text-xs text-slate-500 mb-3">
                Applies to this admin dashboard only — customers never see these.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Tab Font Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={adminTabFontColor}
                      onChange={(e) => setAdminTabFontColor(e.target.value)}
                      className="h-10 w-14 rounded-lg border border-slate-300 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={adminTabFontColor}
                      onChange={(e) => setAdminTabFontColor(e.target.value)}
                      placeholder="#475569"
                      className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Active Tab Background Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={adminTabActiveBgColor}
                      onChange={(e) => setAdminTabActiveBgColor(e.target.value)}
                      className="h-10 w-14 rounded-lg border border-slate-300 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={adminTabActiveBgColor}
                      onChange={(e) => setAdminTabActiveBgColor(e.target.value)}
                      placeholder="#059669"
                      className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
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

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Payment Note{' '}
                <span className="text-slate-400 font-normal">
                  (shown below the QR code — e.g. a mobile number to contact if it won&apos;t scan)
                </span>
              </label>
              <input
                type="text"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                placeholder="QR not working? Text 0917-123-4567"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="pt-4 border-t border-slate-100">
              <label className="block text-sm font-medium text-slate-600 mb-2">Logo</label>
              {currentLogo && (
                <img
                  src={currentLogo}
                  alt="Logo preview"
                  style={{ height: logoHeight }}
                  className="w-auto object-contain mb-2 rounded border border-slate-200 bg-slate-50 p-2"
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

              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Logo Size <span className="text-slate-400 font-normal">({logoHeight}px tall)</span>
                </label>
                <p className="text-xs text-slate-400 mb-1.5">
                  Controls the logo&apos;s height wherever it appears — the landing page header and the
                  booking page header. Width scales automatically to match.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={20}
                    max={160}
                    step={2}
                    value={logoHeight}
                    onChange={(e) => setLogoHeight(Number(e.target.value))}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min={20}
                    max={160}
                    value={logoHeight}
                    onChange={(e) => setLogoHeight(Number(e.target.value))}
                    className="w-20 rounded-xl border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
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

      <PaymentQrCodesSection />
      <EmailNotificationsSection />
    </div>
  );
}

// ---------- Email Notifications (Gmail sender used for admin alerts and
// customer confirmations) ----------
//
// Configured here instead of environment variables so it's the same in
// local dev and production without touching either separately. The App
// Password is write-only: the database itself withholds the stored value
// from this (authenticated-admin) role, so the field always starts blank —
// leaving it blank on save keeps whatever's already configured.

function EmailNotificationsSection() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<EmailSettings>(DEFAULT_EMAIL_SETTINGS);

  const [gmailUser, setGmailUser] = useState('');
  const [adminNotificationEmail, setAdminNotificationEmail] = useState('');
  const [appPassword, setAppPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    const loaded = await fetchEmailSettings(supabase);
    setSettings(loaded);
    setGmailUser(loaded.gmailUser);
    setAdminNotificationEmail(loaded.adminNotificationEmail);
    setAppPassword('');
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    // nodemailer's `to` field natively accepts a comma-separated address
    // list, so multiple recipients "just work" without any backend
    // changes — validate each one here so a typo shows up immediately
    // instead of silently failing to deliver to that address later.
    const notificationEmails = adminNotificationEmail
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean);
    const invalidEmail = notificationEmails.find((email) => !/\S+@\S+\.\S+/.test(email));
    if (invalidEmail) {
      setError(`"${invalidEmail}" doesn't look like a valid email address.`);
      return;
    }

    setSaving(true);

    const update: Record<string, string | boolean | null> = {
      gmail_user: gmailUser.trim() || null,
      admin_notification_email: notificationEmails.length > 0 ? notificationEmails.join(', ') : null,
    };
    // Only touch the password if the admin actually typed a new one —
    // an empty field means "leave it as-is", not "clear it".
    if (appPassword.trim()) {
      update.gmail_app_password = appPassword.trim();
      update.app_password_set = true;
    }

    const { error: updateError } = await supabase
      .from('email_settings')
      .update(update)
      .eq('id', 1);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setSuccess(true);
    await loadSettings();
  }

  async function handleClearPassword() {
    if (!window.confirm('Clear the saved App Password? Email notifications will stop working until a new one is set.')) {
      return;
    }

    setClearing(true);
    setError(null);

    const { error: updateError } = await supabase
      .from('email_settings')
      .update({ gmail_app_password: null, app_password_set: false })
      .eq('id', 1);

    if (updateError) {
      setError(updateError.message);
      setClearing(false);
      return;
    }

    setClearing(false);
    await loadSettings();
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Email Notifications</h2>
      <p className="text-sm text-slate-500 mb-6">
        The Gmail account used to send the admin &quot;new booking&quot; alert and the customer
        confirmation email. Requires an{' '}
        <a
          href="https://myaccount.google.com/apppasswords"
          target="_blank"
          rel="noreferrer"
          className="text-emerald-700 hover:text-emerald-800 underline underline-offset-2"
        >
          App Password
        </a>{' '}
        (not your regular Gmail password) — 2-Step Verification must be enabled on the account
        first.
      </p>

      {loading ? (
        <p className="text-sm text-slate-400">Loading email settings…</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Gmail Address</label>
            <input
              type="email"
              value={gmailUser}
              onChange={(e) => setGmailUser(e.target.value)}
              placeholder="yourclub@gmail.com"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              App Password{' '}
              <span className="text-slate-400 font-normal">
                ({settings.appPasswordSet ? 'currently set — leave blank to keep it' : 'not set yet'})
              </span>
            </label>
            <input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder={settings.appPasswordSet ? '••••••••••••••••' : '16-character App Password'}
              autoComplete="off"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {settings.appPasswordSet && (
              <button
                type="button"
                onClick={handleClearPassword}
                disabled={clearing}
                className="mt-1.5 text-xs text-red-600 hover:text-red-700 underline underline-offset-2 disabled:opacity-50"
              >
                {clearing ? 'Clearing…' : 'Clear saved App Password'}
              </button>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Admin Notification Email{' '}
              <span className="text-slate-400 font-normal">
                (optional, comma-separated for multiple — defaults to the Gmail address above)
              </span>
            </label>
            <input
              type="email"
              multiple
              value={adminNotificationEmail}
              onChange={(e) => setAdminNotificationEmail(e.target.value)}
              placeholder="alerts@example.com, manager@example.com"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
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
  );
}

// ---------- Payment QR Codes (GCash / Maya / bank, up to MAX_PAYMENT_QR_CODES) ----------

function PaymentQrCodesSection() {
  const [qrCodes, setQrCodes] = useState<PaymentQrCode[]>([]);
  const [qrLoading, setQrLoading] = useState(true);
  const [qrError, setQrError] = useState<string | null>(null);

  const [newQrLabel, setNewQrLabel] = useState('');
  const [newQrFile, setNewQrFile] = useState<File | null>(null);
  const [addingQr, setAddingQr] = useState(false);
  const [removingQrId, setRemovingQrId] = useState<number | null>(null);

  const newQrFileInputRef = useRef<HTMLInputElement>(null);

  const fetchQrCodes = useCallback(async () => {
    setQrLoading(true);
    setQrError(null);
    const list = await fetchPaymentQrCodes(supabase);
    setQrCodes(list);
    setQrLoading(false);
  }, []);

  useEffect(() => {
    fetchQrCodes();
  }, [fetchQrCodes]);

  async function handleAddQrCode(e: React.FormEvent) {
    e.preventDefault();
    const label = newQrLabel.trim();
    if (!label || !newQrFile) return;

    setAddingQr(true);
    setQrError(null);

    try {
      const imageUrl = await uploadBrandingImage(newQrFile, 'qr');

      const { error } = await supabase.from('payment_qr_codes').insert({
        label,
        image_url: imageUrl,
        sort_order: qrCodes.length,
      });

      if (error) throw new Error(error.message);

      setNewQrLabel('');
      setNewQrFile(null);
      if (newQrFileInputRef.current) newQrFileInputRef.current.value = '';
      await fetchQrCodes();
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'Could not add QR code.');
    } finally {
      setAddingQr(false);
    }
  }

  async function handleRemoveQrCode(qr: PaymentQrCode) {
    if (!window.confirm(`Remove the "${qr.label}" QR code?`)) return;

    setRemovingQrId(qr.id);
    setQrError(null);

    const { error } = await supabase.from('payment_qr_codes').delete().eq('id', qr.id);

    if (error) {
      setQrError(`Could not remove QR code: ${error.message}`);
      setRemovingQrId(null);
      return;
    }

    const path = brandingPathFromPublicUrl(qr.image_url);
    if (path) {
      await supabase.storage.from('branding').remove([path]);
    }

    setRemovingQrId(null);
    await fetchQrCodes();
  }

  const atMax = qrCodes.length >= MAX_PAYMENT_QR_CODES;

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Payment QR Codes</h2>
      <p className="text-sm text-slate-500 mb-4">
        Add up to {MAX_PAYMENT_QR_CODES} QR codes (GCash, Maya, bank transfer, etc). With just one
        configured, customers see it directly; with more than one, they can choose which to pay
        with.
      </p>

      {qrError && <p className="text-sm text-red-600 mb-3">{qrError}</p>}

      {qrLoading ? (
        <p className="text-sm text-slate-400">Loading QR codes…</p>
      ) : (
        <div className="space-y-2 mb-5">
          {qrCodes.length === 0 && (
            <p className="text-sm text-slate-400">
              No QR codes configured yet — the page falls back to /public/gcash-qr.png until you
              add one.
            </p>
          )}
          {qrCodes.map((qr) => (
            <div
              key={qr.id}
              className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"
            >
              <img
                src={qr.image_url}
                alt={qr.label}
                className="h-12 w-12 object-contain rounded border border-slate-200 bg-slate-50 shrink-0"
              />
              <p className="flex-1 text-sm font-medium text-slate-800">{qr.label}</p>
              <button
                onClick={() => handleRemoveQrCode(qr)}
                disabled={removingQrId === qr.id}
                className="rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-1.5 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                {removingQrId === qr.id ? 'Removing…' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}

      {atMax ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Maximum of {MAX_PAYMENT_QR_CODES} QR codes reached. Remove one to add another.
        </p>
      ) : (
        <form onSubmit={handleAddQrCode} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Label <span className="text-slate-400 font-normal">(e.g. GCash, Maya, BDO)</span>
              </label>
              <input
                type="text"
                value={newQrLabel}
                onChange={(e) => setNewQrLabel(e.target.value)}
                placeholder="GCash"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">QR Image</label>
              <input
                ref={newQrFileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => setNewQrFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-emerald-100"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={addingQr || !newQrLabel.trim() || !newQrFile}
            className="rounded-lg bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] text-sm font-medium px-4 py-2.5 hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {addingQr ? 'Adding…' : 'Add QR Code'}
          </button>
        </form>
      )}
    </section>
  );
}
