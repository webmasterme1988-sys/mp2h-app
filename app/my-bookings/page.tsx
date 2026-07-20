'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';

// ---------- Types ----------

type BookingStatus = 'pending' | 'confirmed' | 'cancelled';

interface Booking {
  id: number;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  receipt_url: string | null;
  courts: { name: string } | null;
}

// ---------- Helpers ----------

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
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

const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Payment pending review',
  confirmed: 'Payment confirmed',
  cancelled: 'Cancelled',
};

// ---------- Component ----------

export default function MyBookingsPage() {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [phone, setPhone] = useState('');
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [receiptModalUrl, setReceiptModalUrl] = useState<string | null>(null);

  useEffect(() => {
    fetchSiteSettings(supabase).then(setSettings);
  }, []);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) return;

    setLoading(true);
    setError(null);
    setSearched(true);

    const { data, error } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, status, receipt_url, courts(name)')
      .eq('player_phone', trimmedPhone)
      .order('start_time', { ascending: false });

    if (error) {
      console.error('Failed to load bookings:', error);
      setError('Could not load your bookings. Please try again.');
      setBookings([]);
      setLoading(false);
      return;
    }

    setBookings((data ?? []) as unknown as Booking[]);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header style={{ backgroundColor: settings.primary_color }} className="text-white">
        <div className="max-w-3xl mx-auto px-4 py-6 text-center relative">
          <a
            href="/"
            className="absolute left-4 top-6 text-sm text-white/80 hover:text-white underline underline-offset-2"
          >
            ← Back
          </a>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">My Bookings</h1>
          <p className="mt-1 text-white/80 text-sm sm:text-base">
            Enter the phone number you booked with to see your booking history.
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09XX XXX XXXX"
              required
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="submit"
              disabled={loading}
              style={{ backgroundColor: settings.primary_color }}
              className="rounded-xl text-white font-medium px-6 py-2.5 text-sm hover:brightness-90 disabled:opacity-60 disabled:cursor-not-allowed transition-[filter]"
            >
              {loading ? 'Searching…' : 'View My Bookings'}
            </button>
          </form>
        </section>

        {searched && (
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {error && <p className="text-sm text-red-600 px-4 sm:px-6 pt-4">{error}</p>}

            {!error && !loading && bookings.length === 0 && (
              <p className="text-sm text-slate-400 px-4 sm:px-6 py-6">
                No bookings found for that phone number.
              </p>
            )}

            {bookings.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {bookings.map((booking) => (
                  <li key={booking.id} className="px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-slate-800">
                        {booking.courts?.name ?? 'Court'}
                      </p>
                      <p className="text-sm text-slate-500">{formatDateTime(booking.start_time)}</p>
                      <span
                        className={`inline-block mt-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[booking.status]}`}
                      >
                        {STATUS_LABELS[booking.status]}
                      </span>
                    </div>
                    {booking.receipt_url ? (
                      <button
                        onClick={() => setReceiptModalUrl(booking.receipt_url)}
                        className="text-emerald-700 hover:text-emerald-800 text-sm font-medium underline underline-offset-2 shrink-0"
                      >
                        View Receipt
                      </button>
                    ) : (
                      <span className="text-slate-300 text-sm shrink-0">No receipt</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
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
    </div>
  );
}
