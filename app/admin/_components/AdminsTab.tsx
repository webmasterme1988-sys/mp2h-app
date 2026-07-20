'use client';

import { useState } from 'react';

export default function AdminsTab() {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);
    setInviteSubmitting(true);

    const email = inviteEmail.trim();

    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error || 'Could not send invite.');
      }

      setInviteSuccess(email);
      setInviteEmail('');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Could not send invite.');
    } finally {
      setInviteSubmitting(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-md">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Invite Admin</h2>
      <p className="text-sm text-slate-500 mb-4">
        They&apos;ll get an email with a link to set their own password.
      </p>

      {inviteSuccess && (
        <div className="mb-4 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
          Invite sent to <span className="font-medium">{inviteSuccess}</span>.
        </div>
      )}

      <form onSubmit={handleInvite} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Email address</label>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            placeholder="newadmin@example.com"
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {inviteError && <p className="text-sm text-red-600">{inviteError}</p>}

        <button
          type="submit"
          disabled={inviteSubmitting}
          className="w-full rounded-xl bg-emerald-600 text-white font-medium py-2.5 text-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {inviteSubmitting ? 'Sending…' : 'Send Invite'}
        </button>
      </form>
    </section>
  );
}
