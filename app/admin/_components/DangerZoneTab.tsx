'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS } from '@/lib/siteSettings';
import { formatHourLabel } from '@/lib/timeSlots';

interface ResetSummary {
  bookingsDeleted: number;
  receiptsDeleted: number;
  usersDeleted: number;
  errors: string[];
}

interface BookingsResetSummary {
  bookingsDeleted: number;
  receiptsDeleted: number;
  errors: string[];
}

interface RestoreSummary {
  restored: Record<string, number>;
  skipped: string[];
  errors: string[];
}

interface CleanupRunSummary {
  bookingsDeleted: number;
  transactionsDeleted: number;
  receiptsDeleted: number;
  errors: string[];
}

const CLEANUP_HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);

export default function DangerZoneTab() {
  const [backupDownloading, setBackupDownloading] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreSubmitting, setRestoreSubmitting] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSummary, setRestoreSummary] = useState<RestoreSummary | null>(null);

  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSummary, setResetSummary] = useState<ResetSummary | null>(null);

  const [bookingsResetModalOpen, setBookingsResetModalOpen] = useState(false);
  const [bookingsResetConfirmText, setBookingsResetConfirmText] = useState('');
  const [bookingsResetSubmitting, setBookingsResetSubmitting] = useState(false);
  const [bookingsResetError, setBookingsResetError] = useState<string | null>(null);
  const [bookingsResetSummary, setBookingsResetSummary] = useState<BookingsResetSummary | null>(
    null
  );

  const [cleanupLoading, setCleanupLoading] = useState(true);
  const [cleanupEnabled, setCleanupEnabled] = useState(
    DEFAULT_SITE_SETTINGS.booking_cleanup_enabled
  );
  const [cleanupRetentionDays, setCleanupRetentionDays] = useState(
    DEFAULT_SITE_SETTINGS.booking_cleanup_retention_days
  );
  const [cleanupHour, setCleanupHour] = useState(DEFAULT_SITE_SETTINGS.booking_cleanup_hour);
  const [cleanupLastRunDate, setCleanupLastRunDate] = useState<string | null>(
    DEFAULT_SITE_SETTINGS.booking_cleanup_last_run_date
  );
  const [cleanupSaving, setCleanupSaving] = useState(false);
  const [cleanupSaveError, setCleanupSaveError] = useState<string | null>(null);
  const [cleanupSaveSuccess, setCleanupSaveSuccess] = useState(false);
  const [cleanupRunNowSubmitting, setCleanupRunNowSubmitting] = useState(false);
  const [cleanupRunNowError, setCleanupRunNowError] = useState<string | null>(null);
  const [cleanupRunNowSummary, setCleanupRunNowSummary] = useState<CleanupRunSummary | null>(null);

  useEffect(() => {
    fetchSiteSettings(supabase).then((settings) => {
      setCleanupEnabled(settings.booking_cleanup_enabled);
      setCleanupRetentionDays(settings.booking_cleanup_retention_days);
      setCleanupHour(settings.booking_cleanup_hour);
      setCleanupLastRunDate(settings.booking_cleanup_last_run_date);
      setCleanupLoading(false);
    });
  }, []);

  async function handleSaveCleanupSettings() {
    setCleanupSaveError(null);
    setCleanupSaveSuccess(false);

    if (cleanupEnabled && (!Number.isInteger(cleanupRetentionDays) || cleanupRetentionDays < 1)) {
      setCleanupSaveError('Retention must be a whole number of days, at least 1.');
      return;
    }

    setCleanupSaving(true);
    const { error } = await supabase
      .from('site_settings')
      .update({
        booking_cleanup_enabled: cleanupEnabled,
        booking_cleanup_retention_days: cleanupRetentionDays,
        booking_cleanup_hour: cleanupHour,
      })
      .eq('id', 1);
    setCleanupSaving(false);

    if (error) {
      setCleanupSaveError(`Could not save: ${error.message}`);
      return;
    }
    setCleanupSaveSuccess(true);
  }

  async function handleRunCleanupNow() {
    if (
      !window.confirm(
        `This permanently deletes every booking whose date is more than ${cleanupRetentionDays} day(s) in the past (any status), along with its add-ons and receipt. This cannot be undone. Continue?`
      )
    ) {
      return;
    }

    setCleanupRunNowError(null);
    setCleanupRunNowSummary(null);
    setCleanupRunNowSubmitting(true);

    try {
      const res = await fetch('/api/admin/cleanup-bookings', { method: 'POST' });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error || 'Cleanup failed.');
      }

      setCleanupRunNowSummary(body);
      const settings = await fetchSiteSettings(supabase);
      setCleanupLastRunDate(settings.booking_cleanup_last_run_date);
    } catch (err) {
      setCleanupRunNowError(err instanceof Error ? err.message : 'Cleanup failed.');
    } finally {
      setCleanupRunNowSubmitting(false);
    }
  }

  async function handleBackup() {
    setBackupError(null);
    setBackupDownloading(true);

    try {
      const res = await fetch('/api/admin/backup', { method: 'POST' });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Backup failed.');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mp2h-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : 'Backup failed.');
    } finally {
      setBackupDownloading(false);
    }
  }

  async function handleRestore() {
    if (!restoreFile) return;

    if (
      !window.confirm(
        'This overwrites current settings/courts/pricing/etc. with whatever is in the file, wherever they overlap. It does not touch bookings, transactions, or delete anything not in the file. Continue?'
      )
    ) {
      return;
    }

    setRestoreError(null);
    setRestoreSummary(null);
    setRestoreSubmitting(true);

    try {
      const text = await restoreFile.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('That file is not valid JSON.');
      }

      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const responseBody = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(responseBody.error || 'Restore failed.');
      }

      setRestoreSummary(responseBody);
      setRestoreFile(null);
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setRestoreSubmitting(false);
    }
  }

  function openResetModal() {
    setResetConfirmText('');
    setResetError(null);
    setResetSummary(null);
    setResetModalOpen(true);
  }

  async function handleReset() {
    setResetError(null);
    setResetSubmitting(true);

    try {
      const res = await fetch('/api/admin/reset', { method: 'POST' });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error || 'Reset failed.');
      }

      setResetSummary(body);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setResetSubmitting(false);
    }
  }

  function openBookingsResetModal() {
    setBookingsResetConfirmText('');
    setBookingsResetError(null);
    setBookingsResetSummary(null);
    setBookingsResetModalOpen(true);
  }

  async function handleBookingsReset() {
    setBookingsResetError(null);
    setBookingsResetSubmitting(true);

    try {
      const res = await fetch('/api/admin/reset-bookings', { method: 'POST' });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error || 'Reset failed.');
      }

      setBookingsResetSummary(body);
    } catch (err) {
      setBookingsResetError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setBookingsResetSubmitting(false);
    }
  }

  return (
    <>
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Backup Database</h2>
        <p className="text-sm text-slate-500 mb-4">
          Downloads a JSON snapshot of every table — bookings, transactions, courts, settings,
          pricing, holidays, blocked slots, add-ons, and more. Gmail App Password and Cron Secret
          are left out of the file (only whether each is set), same as they&apos;re withheld
          everywhere else in the dashboard. Uploaded images and receipts are files in storage, not
          included in this download.
        </p>
        <button
          onClick={handleBackup}
          disabled={backupDownloading}
          className="rounded-xl bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] px-4 py-2 text-sm font-medium hover:brightness-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {backupDownloading ? 'Preparing…' : 'Download Backup'}
        </button>
        {backupError && <p className="text-sm text-red-600 mt-3">{backupError}</p>}
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-amber-200 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Restore from Backup</h2>
        <p className="text-sm text-slate-500 mb-4">
          Upload a backup file to restore <span className="font-medium">site settings, email
          settings, courts, pricing, add-ons, holidays, blocked slots, payment QR codes, landing
          photos, and the blacklist</span>. Existing rows are overwritten where the file has a
          matching one; anything not in the file is left alone. Bookings, transactions, and
          booking add-ons are never touched by this — restore those manually if needed.
        </p>

        <input
          type="file"
          accept="application/json"
          onChange={(e) => {
            setRestoreFile(e.target.files?.[0] ?? null);
            setRestoreError(null);
            setRestoreSummary(null);
          }}
          disabled={restoreSubmitting}
          className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-50 file:text-amber-700 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-amber-100 disabled:opacity-60 mb-3"
        />

        <button
          onClick={handleRestore}
          disabled={!restoreFile || restoreSubmitting}
          className="rounded-xl bg-amber-600 text-white px-4 py-2 text-sm font-medium hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {restoreSubmitting ? 'Restoring…' : 'Restore from File'}
        </button>

        {restoreError && <p className="text-sm text-red-600 mt-3">{restoreError}</p>}

        {restoreSummary && (
          <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm">
            <p className="font-medium text-emerald-800 mb-1">Restore complete.</p>
            <ul className="text-emerald-700 space-y-0.5">
              {Object.entries(restoreSummary.restored).map(([table, count]) => (
                <li key={table}>
                  {table}: {count} row{count === 1 ? '' : 's'}
                </li>
              ))}
              {Object.keys(restoreSummary.restored).length === 0 && (
                <li>No matching tables found in the file.</li>
              )}
            </ul>
            {restoreSummary.skipped.length > 0 && (
              <p className="text-xs text-emerald-700 mt-2">
                Skipped (not restorable here): {restoreSummary.skipped.join(', ')}
              </p>
            )}
            {restoreSummary.errors.length > 0 && (
              <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2">
                <p className="text-xs font-medium text-amber-800 mb-1">Some tables failed:</p>
                <ul className="text-xs text-amber-700 space-y-0.5">
                  {restoreSummary.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-red-200 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-red-700 mb-1">Danger Zone</h2>
        <p className="text-sm text-slate-500 mb-4">
          Permanently deletes every booking, every uploaded receipt image, and every other admin
          account (your own account is kept so you don&apos;t get locked out). This cannot be
          undone.
        </p>
        <button
          onClick={openResetModal}
          className="rounded-xl border border-red-300 bg-red-50 text-red-700 px-4 py-2 text-sm font-medium hover:bg-red-100 transition-colors"
        >
          Reset All Data
        </button>
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-red-200 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-red-700 mb-1">Reset All Bookings</h2>
        <p className="text-sm text-slate-500 mb-4">
          Permanently deletes every booking — along with its confirmation #, reference #,
          reschedule reasons, remarks, and uploaded receipts — and restarts the confirmation/
          reference numbering from the beginning. Site settings, courts, pricing, holidays,
          blocked slots, and admin accounts are left untouched. This cannot be undone.
        </p>
        <button
          onClick={openBookingsResetModal}
          className="rounded-xl border border-red-300 bg-red-50 text-red-700 px-4 py-2 text-sm font-medium hover:bg-red-100 transition-colors"
        >
          Reset All Bookings
        </button>
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Automatic Booking Cleanup</h2>
        <p className="text-sm text-slate-500 mb-4">
          Permanently deletes bookings once their date is far enough in the past, on a daily
          schedule — any status, along with that booking&apos;s add-ons and receipt. This cannot
          be undone. Requires an hourly job set up in Supabase to trigger the check — see the
          setup SQL provided separately.
        </p>

        {cleanupLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={cleanupEnabled}
                onChange={(e) => {
                  setCleanupEnabled(e.target.checked);
                  setCleanupSaveSuccess(false);
                }}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm text-slate-700">Enable automatic cleanup</span>
            </label>

            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <span>Delete bookings older than</span>
              <input
                type="number"
                min={1}
                step={1}
                value={cleanupRetentionDays}
                disabled={!cleanupEnabled}
                onChange={(e) => {
                  setCleanupRetentionDays(Number(e.target.value));
                  setCleanupSaveSuccess(false);
                }}
                className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              />
              <span>day(s), checking daily at</span>
              <select
                value={cleanupHour}
                disabled={!cleanupEnabled}
                onChange={(e) => {
                  setCleanupHour(Number(e.target.value));
                  setCleanupSaveSuccess(false);
                }}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              >
                {CLEANUP_HOUR_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {formatHourLabel(h)}
                  </option>
                ))}
              </select>
              <span>(Philippine time)</span>
            </div>

            <p className="text-xs text-slate-400">
              {cleanupLastRunDate ? `Last ran: ${cleanupLastRunDate}` : 'Never run yet.'}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleSaveCleanupSettings}
                disabled={cleanupSaving}
                className="rounded-xl bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] px-4 py-2 text-sm font-medium hover:brightness-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {cleanupSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={handleRunCleanupNow}
                disabled={cleanupRunNowSubmitting}
                className="rounded-xl border border-red-300 bg-red-50 text-red-700 px-4 py-2 text-sm font-medium hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {cleanupRunNowSubmitting ? 'Running…' : 'Run Cleanup Now'}
              </button>
              {cleanupSaveSuccess && (
                <span className="text-sm text-emerald-700">Saved.</span>
              )}
            </div>

            {cleanupSaveError && <p className="text-sm text-red-600">{cleanupSaveError}</p>}
            {cleanupRunNowError && <p className="text-sm text-red-600">{cleanupRunNowError}</p>}

            {cleanupRunNowSummary && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm">
                <p className="font-medium text-emerald-800 mb-1">Cleanup complete.</p>
                <ul className="text-emerald-700 space-y-0.5">
                  <li>{cleanupRunNowSummary.bookingsDeleted} booking(s) deleted</li>
                  <li>{cleanupRunNowSummary.transactionsDeleted} transaction(s) deleted</li>
                  <li>{cleanupRunNowSummary.receiptsDeleted} receipt file(s) deleted</li>
                </ul>
                {cleanupRunNowSummary.errors.length > 0 && (
                  <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2">
                    <p className="text-xs font-medium text-amber-800 mb-1">Some items failed:</p>
                    <ul className="text-xs text-amber-700 space-y-0.5">
                      {cleanupRunNowSummary.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {resetModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !resetSubmitting && setResetModalOpen(false)}
        >
          <div className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <h3 className="font-semibold text-red-700">Reset All Data</h3>
              {!resetSubmitting && (
                <button
                  onClick={() => setResetModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                  aria-label="Close"
                >
                  ×
                </button>
              )}
            </div>

            <div className="p-5">
              {resetSummary ? (
                <div className="text-center py-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3 text-xl">
                    ✓
                  </div>
                  <p className="text-sm text-slate-700 font-medium">Reset complete.</p>
                  <ul className="text-sm text-slate-600 mt-2 space-y-0.5">
                    <li>{resetSummary.bookingsDeleted} booking(s) deleted</li>
                    <li>{resetSummary.receiptsDeleted} receipt file(s) deleted</li>
                    <li>{resetSummary.usersDeleted} other admin account(s) deleted</li>
                  </ul>
                  {resetSummary.errors.length > 0 && (
                    <div className="mt-3 text-left rounded-lg bg-amber-50 border border-amber-200 p-3">
                      <p className="text-xs font-medium text-amber-800 mb-1">
                        Some items could not be deleted:
                      </p>
                      <ul className="text-xs text-amber-700 space-y-0.5">
                        {resetSummary.errors.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <button
                    onClick={() => setResetModalOpen(false)}
                    className="mt-4 w-full rounded-xl bg-slate-100 text-slate-700 font-medium py-2.5 text-sm hover:bg-slate-200 transition-colors"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-600">
                    This permanently deletes <span className="font-medium">every booking</span>,{' '}
                    <span className="font-medium">every uploaded receipt</span>, and{' '}
                    <span className="font-medium">every other admin account</span>. Your own
                    account stays intact. This cannot be undone.
                  </p>
                  <p className="text-sm text-slate-600 mt-3 mb-1">
                    Type <span className="font-mono font-semibold">RESET</span> to confirm:
                  </p>
                  <input
                    type="text"
                    value={resetConfirmText}
                    onChange={(e) => setResetConfirmText(e.target.value)}
                    disabled={resetSubmitting}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />

                  {resetError && <p className="text-sm text-red-600 mt-3">{resetError}</p>}

                  <button
                    onClick={handleReset}
                    disabled={resetConfirmText !== 'RESET' || resetSubmitting}
                    className="w-full mt-4 rounded-xl bg-red-600 text-white font-medium py-2.5 text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {resetSubmitting ? 'Resetting…' : 'Permanently Reset All Data'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {bookingsResetModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !bookingsResetSubmitting && setBookingsResetModalOpen(false)}
        >
          <div className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <h3 className="font-semibold text-red-700">Reset All Bookings</h3>
              {!bookingsResetSubmitting && (
                <button
                  onClick={() => setBookingsResetModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                  aria-label="Close"
                >
                  ×
                </button>
              )}
            </div>

            <div className="p-5">
              {bookingsResetSummary ? (
                <div className="text-center py-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3 text-xl">
                    ✓
                  </div>
                  <p className="text-sm text-slate-700 font-medium">Reset complete.</p>
                  <ul className="text-sm text-slate-600 mt-2 space-y-0.5">
                    <li>{bookingsResetSummary.bookingsDeleted} booking(s) deleted</li>
                    <li>{bookingsResetSummary.receiptsDeleted} receipt file(s) deleted</li>
                    <li>Confirmation #/Reference # numbering restarted</li>
                  </ul>
                  {bookingsResetSummary.errors.length > 0 && (
                    <div className="mt-3 text-left rounded-lg bg-amber-50 border border-amber-200 p-3">
                      <p className="text-xs font-medium text-amber-800 mb-1">
                        Some items could not be deleted:
                      </p>
                      <ul className="text-xs text-amber-700 space-y-0.5">
                        {bookingsResetSummary.errors.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <button
                    onClick={() => setBookingsResetModalOpen(false)}
                    className="mt-4 w-full rounded-xl bg-slate-100 text-slate-700 font-medium py-2.5 text-sm hover:bg-slate-200 transition-colors"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-600">
                    This permanently deletes <span className="font-medium">every booking</span>{' '}
                    and its confirmation #, reference #, reschedule reasons, remarks, and uploaded
                    receipts, and restarts the confirmation/reference numbering from the
                    beginning. Settings, courts, pricing, holidays, blocked slots, and admin
                    accounts are not affected. This cannot be undone.
                  </p>
                  <p className="text-sm text-slate-600 mt-3 mb-1">
                    Type <span className="font-mono font-semibold">RESET BOOKINGS</span> to
                    confirm:
                  </p>
                  <input
                    type="text"
                    value={bookingsResetConfirmText}
                    onChange={(e) => setBookingsResetConfirmText(e.target.value)}
                    disabled={bookingsResetSubmitting}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />

                  {bookingsResetError && (
                    <p className="text-sm text-red-600 mt-3">{bookingsResetError}</p>
                  )}

                  <button
                    onClick={handleBookingsReset}
                    disabled={bookingsResetConfirmText !== 'RESET BOOKINGS' || bookingsResetSubmitting}
                    className="w-full mt-4 rounded-xl bg-red-600 text-white font-medium py-2.5 text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {bookingsResetSubmitting ? 'Resetting…' : 'Permanently Reset All Bookings'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
