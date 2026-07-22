'use client';

import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { type SiteSettings } from '@/lib/siteSettings';
import { formatPrice } from '@/lib/priceTiers';

// ---------- Types ----------

type BookingStatus = 'pending' | 'confirmed' | 'cancelled';

interface Booking {
  id: string;
  transaction_id: number | null;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  receipt_url: string | null;
  price: number | null;
  created_at: string;
  courts: { name: string } | null;
}

interface TransactionGroup {
  key: string;
  transactionId: number | null;
  bookings: Booking[];
  courtName: string;
  createdAt: string;
  totalHours: number;
  totalPrice: number | null;
  status: BookingStatus | 'mixed';
  receiptUrl: string | null;
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

function formatSlotTimeRange(startIso: string, endIso: string) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Manila',
    });
  return `${fmt(startIso)} - ${fmt(endIso)}`;
}

const STATUS_STYLES: Record<BookingStatus | 'mixed', string> = {
  pending: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  mixed: 'bg-slate-100 text-slate-600',
};

const STATUS_LABELS: Record<BookingStatus | 'mixed', string> = {
  pending: 'Payment pending review',
  confirmed: 'Payment confirmed',
  cancelled: 'Cancelled',
  mixed: 'Mixed status',
};

function groupByTransaction(bookings: Booking[]): TransactionGroup[] {
  const map = new Map<string, Booking[]>();
  for (const b of bookings) {
    // Bookings from before the transaction_id column existed each get
    // their own singleton group, keyed by their own id.
    const key = b.transaction_id !== null ? `t-${b.transaction_id}` : `legacy-${b.id}`;
    const existing = map.get(key);
    if (existing) {
      existing.push(b);
    } else {
      map.set(key, [b]);
    }
  }

  const groups: TransactionGroup[] = [];
  for (const [key, groupBookings] of map) {
    const sorted = [...groupBookings].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );
    const first = sorted[0];
    const statuses = new Set(sorted.map((b) => b.status));
    const status: BookingStatus | 'mixed' = statuses.size === 1 ? sorted[0].status : 'mixed';
    const anyPriceMissing = sorted.some((b) => b.price === null);
    const totalPrice = anyPriceMissing ? null : sorted.reduce((sum, b) => sum + (b.price ?? 0), 0);
    const createdAt = sorted.reduce(
      (min, b) => (b.created_at < min ? b.created_at : min),
      sorted[0].created_at
    );

    groups.push({
      key,
      transactionId: first.transaction_id,
      bookings: sorted,
      courtName: first.courts?.name ?? 'Court',
      createdAt,
      totalHours: sorted.length,
      totalPrice,
      status,
      receiptUrl: first.receipt_url,
    });
  }

  return groups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ---------- Component ----------

export default function MyBookingsClient({ initialSettings }: { initialSettings: SiteSettings }) {
  // Seeded from the server-rendered HTML so the header color is correct
  // from the very first paint — no default-then-real flash.
  const [settings] = useState<SiteSettings>(initialSettings);
  const [phone, setPhone] = useState('');
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [receiptModalUrl, setReceiptModalUrl] = useState<string | null>(null);
  const [detailsKey, setDetailsKey] = useState<string | null>(null);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) return;

    setLoading(true);
    setError(null);
    setSearched(true);

    const { data, error } = await supabase
      .from('bookings')
      .select('id, transaction_id, start_time, end_time, status, receipt_url, price, created_at, courts(name)')
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

  const transactionGroups = groupByTransaction(bookings);
  const detailsGroup = transactionGroups.find((g) => g.key === detailsKey) ?? null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header style={{ backgroundColor: settings.primary_color }} className="text-white">
        <div className="max-w-3xl mx-auto px-4 py-6 text-center relative">
          <a
            href="/booking"
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
              style={{ backgroundColor: settings.button_bg_color, color: settings.button_label_color }}
              className="rounded-xl font-medium px-6 py-2.5 text-sm hover:brightness-90 disabled:opacity-60 disabled:cursor-not-allowed transition-[filter]"
            >
              {loading ? 'Searching…' : 'View My Bookings'}
            </button>
          </form>
        </section>

        {searched && (
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {error && <p className="text-sm text-red-600 px-4 sm:px-6 pt-4">{error}</p>}

            {!error && !loading && transactionGroups.length === 0 && (
              <p className="text-sm text-slate-400 px-4 sm:px-6 py-6">
                No bookings found for that phone number.
              </p>
            )}

            {transactionGroups.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {transactionGroups.map((group) => (
                  <li
                    key={group.key}
                    onClick={() => setDetailsKey(group.key)}
                    className="px-4 sm:px-6 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-slate-800">
                        {group.courtName}
                        {group.transactionId !== null && (
                          <span className="text-slate-400 font-normal"> · Transaction #{group.transactionId}</span>
                        )}
                      </p>
                      <p className="text-sm text-slate-500">{formatDateTime(group.createdAt)}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {group.totalHours} hour{group.totalHours !== 1 ? 's' : ''} booked
                      </p>
                      <span
                        className={`inline-block mt-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLES[group.status]}`}
                      >
                        {STATUS_LABELS[group.status]}
                      </span>
                    </div>
                    <button
                      onClick={() => setDetailsKey(group.key)}
                      className="rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-sm font-medium px-3 py-1.5 hover:bg-slate-200 transition-colors shrink-0"
                    >
                      View Details
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      {/* View Details Modal */}
      {detailsGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDetailsKey(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800">
                  {detailsGroup.transactionId !== null
                    ? `Confirmation #${detailsGroup.transactionId}`
                    : 'Booking Details'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {detailsGroup.courtName} · {formatDateTime(detailsGroup.createdAt)}
                </p>
              </div>
              <button
                onClick={() => setDetailsKey(null)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                {detailsGroup.bookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="flex items-center justify-between text-sm rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <span className="text-slate-700">
                      {formatSlotTimeRange(booking.start_time, booking.end_time)}
                    </span>
                    {settings.show_price && booking.price !== null && (
                      <span className="text-slate-500">{formatPrice(booking.price)}</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-100">
                <span className="text-slate-600">Total Hours</span>
                <span className="font-medium text-slate-800">{detailsGroup.totalHours}</span>
              </div>

              {settings.show_price && detailsGroup.totalPrice !== null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Total Amount</span>
                  <span className="font-semibold text-slate-800">
                    {formatPrice(detailsGroup.totalPrice)}
                  </span>
                </div>
              )}

              {detailsGroup.transactionId !== null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Confirmation Number</span>
                  <span className="font-medium text-slate-800">#{detailsGroup.transactionId}</span>
                </div>
              )}

              {detailsGroup.receiptUrl ? (
                <button
                  onClick={() => {
                    const url = detailsGroup.receiptUrl;
                    setDetailsKey(null);
                    setReceiptModalUrl(url);
                  }}
                  className="text-emerald-700 hover:text-emerald-800 text-sm font-medium underline underline-offset-2"
                >
                  View Receipt
                </button>
              ) : (
                <p className="text-sm text-slate-400">No receipt uploaded.</p>
              )}
            </div>
          </div>
        </div>
      )}

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
