'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadBrandingImage, brandingPathFromPublicUrl } from '@/lib/brandingStorage';

interface Court {
  id: string;
  name: string;
  image_url: string | null;
}

export default function CourtsTab() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [courtsLoading, setCourtsLoading] = useState(true);
  const [courtsError, setCourtsError] = useState<string | null>(null);
  const [courtEdits, setCourtEdits] = useState<Record<string, string>>({});
  const [savingCourtId, setSavingCourtId] = useState<string | null>(null);
  const [uploadingImageId, setUploadingImageId] = useState<string | null>(null);
  const [newCourtName, setNewCourtName] = useState('');
  const [addingCourt, setAddingCourt] = useState(false);
  const imageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ---------- Delete-with-history confirmation ----------
  const [checkingCourtId, setCheckingCourtId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Court | null>(null);
  const [deleteBookingCount, setDeleteBookingCount] = useState(0);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchCourts = useCallback(async () => {
    setCourtsLoading(true);
    setCourtsError(null);

    const { data, error } = await supabase.from('courts').select('id, name, image_url').order('id');

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

  // Plain confirm() is enough when the court has no booking history. Once
  // it does, deleting it means permanently deleting that history too — the
  // heavier confirm-modal + password re-check below exists specifically
  // for that case, not as a blanket requirement for every court deletion.
  async function deleteCourtOutright(courtId: string) {
    setSavingCourtId(courtId);
    setCourtsError(null);

    const { error } = await supabase.from('courts').delete().eq('id', courtId);

    if (error) {
      console.error(`Failed to delete court ${courtId}:`, error);
      setCourtsError(`Could not delete court: ${error.message}`);
      setSavingCourtId(null);
      return;
    }

    setSavingCourtId(null);
    await fetchCourts();
  }

  async function handleDeleteCourt(court: Court) {
    setCheckingCourtId(court.id);
    setCourtsError(null);

    const { count, error } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('court_id', court.id);

    setCheckingCourtId(null);

    if (error) {
      console.error(`Failed to check bookings for court ${court.id}:`, error);
      setCourtsError(`Could not check this court's booking history: ${error.message}`);
      return;
    }

    if (!count) {
      if (!window.confirm('Delete this court? This cannot be undone.')) return;
      await deleteCourtOutright(court.id);
      return;
    }

    setDeleteTarget(court);
    setDeleteBookingCount(count);
    setDeletePassword('');
    setDeleteError(null);
  }

  async function handleConfirmDeleteWithHistory() {
    if (!deleteTarget) return;

    setDeleteSubmitting(true);
    setDeleteError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      setDeleteError('Could not verify your session. Please sign in again.');
      setDeleteSubmitting(false);
      return;
    }

    // Re-authenticating with the entered password is the actual check —
    // this doesn't change what the admin can do (they're already signed
    // in), it just confirms it's really them typing right now, in case
    // the dashboard was left open on a shared or unlocked computer.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: deletePassword,
    });

    if (signInError) {
      setDeleteError('Incorrect password.');
      setDeleteSubmitting(false);
      return;
    }

    const courtId = deleteTarget.id;

    // Court deletion cascades through everything that references it —
    // bookings and their add-on line items, blocked slots, and any active
    // checkout holds — since the court row itself can't be deleted while
    // any of those still point at it.
    const { data: courtBookings, error: bookingsFetchError } = await supabase
      .from('bookings')
      .select('transaction_id')
      .eq('court_id', courtId);

    if (bookingsFetchError) {
      setDeleteError(`Could not delete: ${bookingsFetchError.message}`);
      setDeleteSubmitting(false);
      return;
    }

    const transactionIds = Array.from(
      new Set(
        (courtBookings ?? [])
          .map((b) => b.transaction_id)
          .filter((id): id is number => id !== null)
      )
    );

    if (transactionIds.length > 0) {
      const { error: addonsDeleteError } = await supabase
        .from('booking_addons')
        .delete()
        .in('transaction_id', transactionIds);
      if (addonsDeleteError) {
        setDeleteError(`Could not delete: ${addonsDeleteError.message}`);
        setDeleteSubmitting(false);
        return;
      }
    }

    const { error: bookingsDeleteError } = await supabase
      .from('bookings')
      .delete()
      .eq('court_id', courtId);
    if (bookingsDeleteError) {
      setDeleteError(`Could not delete: ${bookingsDeleteError.message}`);
      setDeleteSubmitting(false);
      return;
    }

    const { error: blockedDeleteError } = await supabase
      .from('blocked_slots')
      .delete()
      .eq('court_id', courtId);
    if (blockedDeleteError) {
      setDeleteError(`Could not delete: ${blockedDeleteError.message}`);
      setDeleteSubmitting(false);
      return;
    }

    const { error: holdsDeleteError } = await supabase
      .from('slot_holds')
      .delete()
      .eq('court_id', courtId);
    if (holdsDeleteError) {
      setDeleteError(`Could not delete: ${holdsDeleteError.message}`);
      setDeleteSubmitting(false);
      return;
    }

    const { error: courtDeleteError } = await supabase.from('courts').delete().eq('id', courtId);
    if (courtDeleteError) {
      setDeleteError(`Could not delete court: ${courtDeleteError.message}`);
      setDeleteSubmitting(false);
      return;
    }

    setDeleteSubmitting(false);
    setDeleteTarget(null);
    await fetchCourts();
  }

  async function handleImageChange(court: Court, file: File | null) {
    if (!file) return;

    setUploadingImageId(court.id);
    setCourtsError(null);

    try {
      const imageUrl = await uploadBrandingImage(file, `court-${court.id}`);

      const { error } = await supabase
        .from('courts')
        .update({ image_url: imageUrl })
        .eq('id', court.id);

      if (error) throw new Error(error.message);

      await fetchCourts();
    } catch (err) {
      setCourtsError(err instanceof Error ? err.message : 'Could not upload court image.');
    } finally {
      setUploadingImageId(null);
      const input = imageInputRefs.current[court.id];
      if (input) input.value = '';
    }
  }

  async function handleRemoveImage(court: Court) {
    if (!court.image_url) return;

    setUploadingImageId(court.id);
    setCourtsError(null);

    const { error } = await supabase
      .from('courts')
      .update({ image_url: null })
      .eq('id', court.id);

    if (error) {
      setCourtsError(`Could not remove image: ${error.message}`);
      setUploadingImageId(null);
      return;
    }

    const path = brandingPathFromPublicUrl(court.image_url);
    if (path) {
      await supabase.storage.from('branding').remove([path]);
    }

    setUploadingImageId(null);
    await fetchCourts();
  }

  return (
    <>
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Manage Courts</h2>
      <p className="text-sm text-slate-500 mb-4">
        Court photos, if added, show on the public landing page.
      </p>

      {courtsError && <p className="text-sm text-red-600 mb-3">{courtsError}</p>}

      {courtsLoading ? (
        <p className="text-sm text-slate-400">Loading courts…</p>
      ) : (
        <div className="space-y-3 mb-4">
          {courts.length === 0 && (
            <p className="text-sm text-slate-400">No courts yet — add one below.</p>
          )}
          {courts.map((court) => {
            const draftName = courtEdits[court.id] ?? court.name;
            const isSaving = savingCourtId === court.id;
            const isChecking = checkingCourtId === court.id;
            const isUploadingImage = uploadingImageId === court.id;
            return (
              <div key={court.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2 mb-3">
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
                    onClick={() => handleDeleteCourt(court)}
                    disabled={isSaving || isChecking}
                    className="rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-2 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isChecking ? 'Checking…' : 'Delete'}
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  {court.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={court.image_url}
                      alt={court.name}
                      className="h-16 w-16 object-cover rounded-lg border border-slate-200 shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <input
                      ref={(el) => {
                        imageInputRefs.current[court.id] = el;
                      }}
                      type="file"
                      accept="image/*"
                      disabled={isUploadingImage}
                      onChange={(e) => handleImageChange(court, e.target.files?.[0] ?? null)}
                      className="w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-emerald-100 disabled:opacity-60"
                    />
                    {isUploadingImage && (
                      <p className="text-xs text-slate-400 mt-1">Uploading…</p>
                    )}
                  </div>
                  {court.image_url && (
                    <button
                      onClick={() => handleRemoveImage(court)}
                      disabled={isUploadingImage}
                      className="text-xs text-red-600 hover:text-red-700 underline underline-offset-2 shrink-0 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  )}
                </div>
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

    {/* Delete-with-history confirmation */}
    {deleteTarget && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        onClick={() => !deleteSubmitting && setDeleteTarget(null)}
      >
        <div className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
          <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
            <h3 className="font-semibold text-red-700">Delete &quot;{deleteTarget.name}&quot;?</h3>
            {!deleteSubmitting && (
              <button
                onClick={() => setDeleteTarget(null)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                aria-label="Close"
              >
                ×
              </button>
            )}
          </div>

          <div className="p-5 space-y-4">
            <p className="text-sm text-slate-600">
              This court has{' '}
              <span className="font-medium text-slate-800">
                {deleteBookingCount} booking{deleteBookingCount === 1 ? '' : 's'}
              </span>{' '}
              on record. Deleting it will permanently delete those bookings (and any add-ons,
              blocked dates, and holds tied to it) too. This cannot be undone.
            </p>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Enter your password to confirm
              </label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                disabled={deleteSubmitting}
                autoComplete="current-password"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-slate-50"
              />
            </div>

            {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}

            <button
              onClick={handleConfirmDeleteWithHistory}
              disabled={deleteSubmitting || !deletePassword}
              className="w-full rounded-xl bg-red-600 text-white font-medium py-2.5 text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {deleteSubmitting ? 'Deleting…' : 'Permanently Delete Court'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
