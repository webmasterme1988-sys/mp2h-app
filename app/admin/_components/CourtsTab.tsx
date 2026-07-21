'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Court {
  id: string;
  name: string;
}

export default function CourtsTab() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [courtsLoading, setCourtsLoading] = useState(true);
  const [courtsError, setCourtsError] = useState<string | null>(null);
  const [courtEdits, setCourtEdits] = useState<Record<string, string>>({});
  const [savingCourtId, setSavingCourtId] = useState<string | null>(null);
  const [newCourtName, setNewCourtName] = useState('');
  const [addingCourt, setAddingCourt] = useState(false);

  const fetchCourts = useCallback(async () => {
    setCourtsLoading(true);
    setCourtsError(null);

    const { data, error } = await supabase.from('courts').select('id, name').order('id');

    if (error) {
      console.error('Failed to load courts:', error);
      setCourtsError('Could not load courts. Please refresh.');
      setCourtsLoading(false);
      return;
    }

    setCourts((data ?? []) as Court[]);
    setCourtEdits({});
    setCourtsLoading(false);
  }, []);

  useEffect(() => {
    fetchCourts();
  }, [fetchCourts]);

  async function handleAddCourt(e: React.FormEvent) {
    e.preventDefault();
    const name = newCourtName.trim();
    if (!name) return;

    setAddingCourt(true);
    setCourtsError(null);

    const { error } = await supabase.from('courts').insert({ name });

    if (error) {
      console.error('Failed to add court:', error);
      setCourtsError(`Could not add court: ${error.message}`);
      setAddingCourt(false);
      return;
    }

    setNewCourtName('');
    setAddingCourt(false);
    await fetchCourts();
  }

  async function handleRenameCourt(courtId: string) {
    const name = (courtEdits[courtId] ?? '').trim();
    if (!name) return;

    setSavingCourtId(courtId);
    setCourtsError(null);

    const { error } = await supabase.from('courts').update({ name }).eq('id', courtId);

    if (error) {
      console.error(`Failed to rename court ${courtId}:`, error);
      setCourtsError(`Could not rename court: ${error.message}`);
      setSavingCourtId(null);
      return;
    }

    setSavingCourtId(null);
    await fetchCourts();
  }

  async function handleDeleteCourt(courtId: string) {
    if (!window.confirm('Delete this court? This cannot be undone.')) return;

    setSavingCourtId(courtId);
    setCourtsError(null);

    const { error } = await supabase.from('courts').delete().eq('id', courtId);

    if (error) {
      console.error(`Failed to delete court ${courtId}:`, error);
      setCourtsError(
        error.code === '23503'
          ? 'Cannot delete: this court has existing bookings.'
          : `Could not delete court: ${error.message}`
      );
      setSavingCourtId(null);
      return;
    }

    setSavingCourtId(null);
    await fetchCourts();
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Manage Courts</h2>

      {courtsError && <p className="text-sm text-red-600 mb-3">{courtsError}</p>}

      {courtsLoading ? (
        <p className="text-sm text-slate-400">Loading courts…</p>
      ) : (
        <div className="space-y-2 mb-4">
          {courts.length === 0 && (
            <p className="text-sm text-slate-400">No courts yet — add one below.</p>
          )}
          {courts.map((court) => {
            const draftName = courtEdits[court.id] ?? court.name;
            const isSaving = savingCourtId === court.id;
            return (
              <div key={court.id} className="flex items-center gap-2">
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) =>
                    setCourtEdits((prev) => ({ ...prev, [court.id]: e.target.value }))
                  }
                  disabled={isSaving}
                  className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  onClick={() => handleRenameCourt(court.id)}
                  disabled={isSaving || !draftName.trim() || draftName === court.name}
                  className="rounded-lg bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] text-xs font-medium px-3 py-2 hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => handleDeleteCourt(court.id)}
                  disabled={isSaving}
                  className="rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-2 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={handleAddCourt} className="flex items-center gap-2">
        <input
          type="text"
          value={newCourtName}
          onChange={(e) => setNewCourtName(e.target.value)}
          placeholder="e.g. Court 3"
          className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          type="submit"
          disabled={addingCourt || !newCourtName.trim()}
          className="rounded-lg bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] text-xs font-medium px-4 py-2 hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {addingCourt ? 'Adding…' : 'Add Court'}
        </button>
      </form>
    </section>
  );
}
