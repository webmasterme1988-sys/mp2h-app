'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

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

export default function BookingsTab() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [receiptModalUrl, setReceiptModalUrl] = useState<string | null>(null);

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
    fetchBookings();
  }, [fetchBookings]);

  async function updateStatus(bookingId: number, status: BookingStatus) {
    setUpdatingId(bookingId);

    const { error } = await supabase.from('bookings').update({ status }).eq('id', bookingId);

    if (error) {
      console.error(`Failed to set booking ${bookingId} to ${status}:`, error);
      setUpdatingId(null);
      return;
    }

    setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, status } : b)));
    setUpdatingId(null);
  }

  return (
    <>
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
    </>
  );
}
