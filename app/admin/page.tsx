'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ---------- Types ----------

type BookingStatus = 'pending' | 'confirmed' | 'cancelled';

interface Booking {
  id: number;
  player_name: string;
  player_phone: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  receipt_url: string | null;
  courts: { name: string } | null;
}

interface Court {
  id: number;
  name: string;
}

// ---------- Helpers ----------

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATUS_STYLES: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

// ---------- Component ----------

export default function AdminPage() {
  const router = useRouter();

  const [authChecking, setAuthChecking] = useState(true);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [receiptModalUrl, setReceiptModalUrl] = useState<string | null>(null);

  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const [courts, setCourts] = useState<Court[]>([]);
  const [courtsLoading, setCourtsLoading] = useState(true);
  const [courtsError, setCourtsError] = useState<string | null>(null);
  const [courtEdits, setCourtEdits] = useState<Record<number, string>>({});
  const [savingCourtId, setSavingCourtId] = useState<number | null>(null);
  const [newCourtName, setNewCourtName] = useState('');
  const [addingCourt, setAddingCourt] = useState(false);

  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSummary, setResetSummary] = useState<{
    bookingsDeleted: number;
    receiptsDeleted: number;
    usersDeleted: number;
    errors: string[];
  } | null>(null);

  // ---------- Auth guard ----------
  // Belt-and-suspenders: proxy.ts already blocks unauthenticated requests to
  // this route, but a cached page or an expired session in an open tab
  // wouldn't be caught by proxy alone, so re-verify on the client too.

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active) return;
      if (!user) {
        router.replace('/admin/login');
        return;
      }
      setIsSuperAdmin(user.app_metadata?.role === 'super_admin');
      setAuthChecking(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace('/admin/login');
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  // ---------- Load bookings ----------

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from('bookings')
      .select(
        'id, player_name, player_phone, start_time, end_time, status, receipt_url, courts(name)'
      )
      .order('id', { ascending: false });

    if (error) {
      console.error('Failed to load bookings:', error);
      setError('Could not load bookings. Please refresh.');
      setLoading(false);
      return;
    }

    setBookings((data ?? []) as unknown as Booking[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authChecking) return;
    fetchBookings();
  }, [authChecking, fetchBookings]);

  // ---------- Manage courts ----------

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
    if (authChecking) return;
    fetchCourts();
  }, [authChecking, fetchCourts]);

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

  async function handleRenameCourt(courtId: number) {
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

  async function handleDeleteCourt(courtId: number) {
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

  // ---------- Update status ----------

  async function updateStatus(bookingId: number, status: BookingStatus) {
    setUpdatingId(bookingId);

    const { error } = await supabase.from('bookings').update({ status }).eq('id', bookingId);

    if (error) {
      console.error(`Failed to set booking ${bookingId} to ${status}:`, error);
      setUpdatingId(null);
      return;
    }

    setBookings((prev) =>
      prev.map((b) => (b.id === bookingId ? { ...b, status } : b))
    );
    setUpdatingId(null);
  }

  // ---------- Invite admin ----------

  function openInviteModal() {
    setInviteEmail('');
    setInviteError(null);
    setInviteSuccess(false);
    setInviteModalOpen(true);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSubmitting(true);

    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error || 'Could not send invite.');
      }

      setInviteSuccess(true);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Could not send invite.');
    } finally {
      setInviteSubmitting(false);
    }
  }

  // ---------- Reset all data (super admin only) ----------

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
      await fetchBookings();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setResetSubmitting(false);
    }
  }

  // ---------- Sign out ----------

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/admin/login');
    router.refresh();
  }

  // ---------- Render ----------

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-400">Checking session…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-emerald-700 text-white">
        <div className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">MP2H Admin</h1>
            <p className="mt-1 text-emerald-100 text-sm sm:text-base">Manage court bookings.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={openInviteModal}
              className="rounded-xl border border-emerald-500 bg-emerald-800/40 px-4 py-2 text-sm font-medium hover:bg-emerald-800/70 transition-colors"
            >
              Invite Admin
            </button>
            <button
              onClick={handleSignOut}
              className="rounded-xl border border-emerald-500 bg-emerald-800/40 px-4 py-2 text-sm font-medium hover:bg-emerald-800/70 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Manage Courts */}
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
                      className="rounded-lg bg-emerald-600 text-white text-xs font-medium px-3 py-2 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
              className="rounded-lg bg-emerald-600 text-white text-xs font-medium px-4 py-2 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {addingCourt ? 'Adding…' : 'Add Court'}
            </button>
          </form>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {error && <p className="text-sm text-red-600 px-4 sm:px-6 pt-4">{error}</p>}

          {loading ? (
            <p className="text-sm text-slate-400 px-4 sm:px-6 py-6">Loading bookings…</p>
          ) : bookings.length === 0 ? (
            <p className="text-sm text-slate-400 px-4 sm:px-6 py-6">No bookings yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                    <th className="px-4 sm:px-6 py-3">Player</th>
                    <th className="px-4 sm:px-6 py-3">Phone</th>
                    <th className="px-4 sm:px-6 py-3">Date &amp; Time</th>
                    <th className="px-4 sm:px-6 py-3">Court</th>
                    <th className="px-4 sm:px-6 py-3">Status</th>
                    <th className="px-4 sm:px-6 py-3">Receipt</th>
                    <th className="px-4 sm:px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((booking) => {
                    const isUpdating = updatingId === booking.id;
                    return (
                      <tr key={booking.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 sm:px-6 py-3 font-medium text-slate-800 whitespace-nowrap">
                          {booking.player_name}
                        </td>
                        <td className="px-4 sm:px-6 py-3 text-slate-600 whitespace-nowrap">
                          {booking.player_phone}
                        </td>
                        <td className="px-4 sm:px-6 py-3 text-slate-600 whitespace-nowrap">
                          {formatDateTime(booking.start_time)}
                        </td>
                        <td className="px-4 sm:px-6 py-3 text-slate-600 whitespace-nowrap">
                          {booking.courts?.name ?? '—'}
                        </td>
                        <td className="px-4 sm:px-6 py-3 whitespace-nowrap">
                          <span
                            className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLES[booking.status]}`}
                          >
                            {booking.status}
                          </span>
                        </td>
                        <td className="px-4 sm:px-6 py-3 whitespace-nowrap">
                          {booking.receipt_url ? (
                            <button
                              onClick={() => setReceiptModalUrl(booking.receipt_url)}
                              className="text-emerald-700 hover:text-emerald-800 font-medium underline underline-offset-2"
                            >
                              View
                            </button>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 sm:px-6 py-3 whitespace-nowrap">
                          <div className="flex gap-2">
                            <button
                              onClick={() => updateStatus(booking.id, 'confirmed')}
                              disabled={isUpdating || booking.status === 'confirmed'}
                              className="rounded-lg bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => updateStatus(booking.id, 'cancelled')}
                              disabled={isUpdating || booking.status === 'cancelled'}
                              className="rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-1.5 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {isSuperAdmin && (
          <section className="bg-white rounded-2xl shadow-sm border border-red-200 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-red-700 mb-1">Danger Zone</h2>
            <p className="text-sm text-slate-500 mb-4">
              Permanently deletes every booking, every uploaded receipt image, and every other
              admin account (your own account is kept so you don&apos;t get locked out). This
              cannot be undone.
            </p>
            <button
              onClick={openResetModal}
              className="rounded-xl border border-red-300 bg-red-50 text-red-700 px-4 py-2 text-sm font-medium hover:bg-red-100 transition-colors"
            >
              Reset All Data
            </button>
          </section>
        )}
      </main>

      {/* Receipt Modal */}
      {receiptModalUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setReceiptModalUrl(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Payment Receipt</h3>
              <button
                onClick={() => setReceiptModalUrl(null)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="p-5">
              <img
                src={receiptModalUrl}
                alt="GCash payment receipt"
                className="w-full h-auto rounded-lg border border-slate-200"
              />
            </div>
          </div>
        </div>
      )}

      {/* Invite Admin Modal */}
      {inviteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setInviteModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Invite Admin</h3>
              <button
                onClick={() => setInviteModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="p-5">
              {inviteSuccess ? (
                <div className="text-center py-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3 text-xl">
                    ✓
                  </div>
                  <p className="text-sm text-slate-700">
                    Invite sent to <span className="font-medium">{inviteEmail.trim()}</span>.
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    They&apos;ll get an email with a link to set their password.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleInvite} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">
                      Email address
                    </label>
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
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reset All Data Modal */}
      {resetModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !resetSubmitting && setResetModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
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
    </div>
  );
}
