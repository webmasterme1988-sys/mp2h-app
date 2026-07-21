'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchBlacklist, type BlacklistEntry } from '@/lib/blacklist';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function BlacklistTab() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newReason, setNewReason] = useState('');
  const [adding, setAdding] = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    const list = await fetchBlacklist(supabase);
    setEntries(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const email = newEmail.trim();
    const phone = newPhone.trim();

    if (!email && !phone) {
      setError('Enter an email address, a phone number, or both.');
      return;
    }

    setAdding(true);
    setError(null);

    const { error: insertError } = await supabase.from('blacklist').insert({
      email: email || null,
      phone: phone || null,
      reason: newReason.trim() || null,
    });

    if (insertError) {
      console.error('Failed to add blacklist entry:', insertError);
      setError(
        insertError.code === '23505'
          ? 'That email or phone number is already blacklisted.'
          : `Could not add entry: ${insertError.message}`
      );
      setAdding(false);
      return;
    }

    setNewEmail('');
    setNewPhone('');
    setNewReason('');
    setAdding(false);
    await loadEntries();
  }

  async function handleRemove(id: number) {
    setRemovingId(id);
    setError(null);

    const { error: deleteError } = await supabase.from('blacklist').delete().eq('id', id);

    if (deleteError) {
      console.error(`Failed to remove blacklist entry ${id}:`, deleteError);
      setError(`Could not remove entry: ${deleteError.message}`);
      setRemovingId(null);
      return;
    }

    setRemovingId(null);
    await loadEntries();
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Blacklist</h2>
      <p className="text-sm text-slate-500 mb-6">
        Customers whose email or phone number matches an entry here are blocked from booking
        until it&apos;s removed.
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-400 mb-4">Loading…</p>
      ) : (
        <div className="space-y-2 mb-5">
          {entries.length === 0 && (
            <p className="text-sm text-slate-400">No one is blacklisted.</p>
          )}
          {entries.map((entry) => {
            const isRemoving = removingId === entry.id;
            return (
              <div
                key={entry.id}
                className="flex items-start gap-3 rounded-xl border border-slate-200 p-3"
              >
                <div className="flex-1 min-w-0">
                  {entry.email && (
                    <p className="text-sm font-medium text-slate-800 truncate">{entry.email}</p>
                  )}
                  {entry.phone && <p className="text-sm text-slate-600">{entry.phone}</p>}
                  {entry.reason && (
                    <p className="text-xs text-slate-500 mt-0.5">{entry.reason}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-0.5">
                    Added {formatDate(entry.created_at)}
                  </p>
                </div>
                <button
                  onClick={() => handleRemove(entry.id)}
                  disabled={isRemoving}
                  className="rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-1.5 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {isRemoving ? 'Removing…' : 'Remove'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={handleAdd} className="space-y-3 pt-4 border-t border-slate-200">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Email address
            </label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="juan@example.com"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Phone number
            </label>
            <input
              type="tel"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="09XX XXX XXXX"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Reason (optional)
          </label>
          <input
            type="text"
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            placeholder="e.g. No-showed twice"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <button
          type="submit"
          disabled={adding || (!newEmail.trim() && !newPhone.trim())}
          className="rounded-lg bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] text-sm font-medium px-4 py-2.5 hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {adding ? 'Adding…' : 'Add to Blacklist'}
        </button>
      </form>
    </section>
  );
}
