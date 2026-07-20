'use client';

import { useState } from 'react';

interface ResetSummary {
  bookingsDeleted: number;
  receiptsDeleted: number;
  usersDeleted: number;
  errors: string[];
}

export default function DangerZoneTab() {
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSummary, setResetSummary] = useState<ResetSummary | null>(null);

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

  return (
    <>
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
    </>
  );
}
