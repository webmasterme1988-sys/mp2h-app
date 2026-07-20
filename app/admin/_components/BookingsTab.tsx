'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DateCalendar from '@/components/DateCalendar';
import { buildTimeSlots, todayISODate } from '@/lib/timeSlots';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';
import { fetchHolidays, type Holiday } from '@/lib/holidays';

type BookingStatus = 'pending' | 'confirmed' | 'cancelled';

interface Booking {
  id: string;
  court_id: string;
  player_name: string;
  player_phone: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  receipt_url: string | null;
  created_at: string;
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
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [receiptModalUrl, setReceiptModalUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    fetchSiteSettings(supabase).then(setSettings);
    fetchHolidays(supabase).then(setHolidays);
  }, []);

  // Keeps the "hold expired" indicator live without needing a manual refresh.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const timeSlots = buildTimeSlots(settings.opening_hour, settings.closing_hour);
  const holidayDates = new Set(holidays.map((h) => h.holiday_date));

  function isDateClosed(iso: string) {
    if (holidayDates.has(iso)) return true;
    const weekday = new Date(`${iso}T00:00:00`).getDay();
    return !settings.open_days.includes(weekday);
  }

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from('bookings')
      .select(
        'id, court_id, player_name, player_phone, start_time, end_time, status, receipt_url, created_at, courts(name)'
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

  function isHoldExpired(booking: Booking) {
    if (booking.status !== 'pending') return false;
    return now - new Date(booking.created_at).getTime() > settings.pending_hold_minutes * 60 * 1000;
  }

  async function updateStatus(bookingId: string, status: BookingStatus) {
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

  // ---------- Reschedule ----------

  const [rescheduleBooking, setRescheduleBooking] = useState<Booking | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleHour, setRescheduleHour] = useState<number | null>(null);
  const [rescheduleConflicts, setRescheduleConflicts] = useState<Set<number>>(new Set());
  const [rescheduleLoadingConflicts, setRescheduleLoadingConflicts] = useState(false);
  const [rescheduleSaving, setRescheduleSaving] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  function openReschedule(booking: Booking) {
    setRescheduleBooking(booking);
    setRescheduleDate(booking.start_time.split('T')[0]);
    setRescheduleHour(new Date(booking.start_time).getHours());
    setRescheduleError(null);
  }

  function closeReschedule() {
    if (rescheduleSaving) return;
    setRescheduleBooking(null);
  }

  const fetchRescheduleConflicts = useCallback(async () => {
    if (!rescheduleBooking || !rescheduleDate) return;

    setRescheduleLoadingConflicts(true);

    const dayStart = new Date(`${rescheduleDate}T00:00:00`).toISOString();
    const dayEnd = new Date(`${rescheduleDate}T23:59:59`).toISOString();

    const [bookingsResult, blockedResult] = await Promise.all([
      supabase
        .from('bookings')
        .select('start_time, status, created_at')
        .eq('court_id', rescheduleBooking.court_id)
        .neq('id', rescheduleBooking.id)
        .gte('start_time', dayStart)
        .lte('start_time', dayEnd)
        .in('status', ['pending', 'confirmed']),
      supabase
        .from('blocked_slots')
        .select('start_time')
        .eq('court_id', rescheduleBooking.court_id)
        .gte('start_time', dayStart)
        .lte('start_time', dayEnd),
    ]);

    const holdMs = settings.pending_hold_minutes * 60 * 1000;
    const nowTime = Date.now();
    const conflicts = new Set<number>(
      (bookingsResult.data ?? [])
        .filter((row: { status: string; created_at: string }) => {
          if (row.status !== 'pending') return true;
          return nowTime - new Date(row.created_at).getTime() < holdMs;
        })
        .map((row: { start_time: string }) => new Date(row.start_time).getTime())
    );
    (blockedResult.data ?? []).forEach((row: { start_time: string }) =>
      conflicts.add(new Date(row.start_time).getTime())
    );

    setRescheduleConflicts(conflicts);
    setRescheduleLoadingConflicts(false);
  }, [rescheduleBooking, rescheduleDate, settings.pending_hold_minutes]);

  useEffect(() => {
    fetchRescheduleConflicts();
  }, [fetchRescheduleConflicts]);

  async function handleConfirmReschedule() {
    if (!rescheduleBooking || rescheduleHour === null) return;

    const slot = timeSlots.find((s) => s.hour === rescheduleHour);
    if (!slot) return;

    const newStart = new Date(slot.startISO(rescheduleDate)).getTime();
    if (rescheduleConflicts.has(newStart)) {
      setRescheduleError('That slot is no longer available. Pick another.');
      return;
    }

    setRescheduleSaving(true);
    setRescheduleError(null);

    const updates: Record<string, string> = {
      start_time: slot.startISO(rescheduleDate),
      end_time: slot.endISO(rescheduleDate),
    };
    // Give it a fresh hold window rather than having it show as
    // immediately hold-expired right after being rescheduled.
    if (rescheduleBooking.status === 'pending') {
      updates.created_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('bookings')
      .update(updates)
      .eq('id', rescheduleBooking.id);

    if (error) {
      setRescheduleError(`Could not reschedule: ${error.message}`);
      setRescheduleSaving(false);
      return;
    }

    setRescheduleSaving(false);
    setRescheduleBooking(null);
    await fetchBookings();
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
                        {isHoldExpired(booking) && (
                          <span
                            className="block text-[11px] text-amber-600 mt-1"
                            title="This slot may already be booked by someone else."
                          >
                            Hold expired
                          </span>
                        )}
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
                          {booking.status !== 'cancelled' && (
                            <button
                              onClick={() => openReschedule(booking)}
                              disabled={isUpdating}
                              className="rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium px-3 py-1.5 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              Reschedule
                            </button>
                          )}
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

      {/* Reschedule Modal */}
      {rescheduleBooking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeReschedule}
        >
          <div className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800">Reschedule Booking</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {rescheduleBooking.player_name} · {rescheduleBooking.courts?.name ?? 'Court'}
                </p>
              </div>
              {!rescheduleSaving && (
                <button
                  onClick={closeReschedule}
                  className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                  aria-label="Close"
                >
                  ×
                </button>
              )}
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
                <DateCalendar
                  selectedDate={rescheduleDate}
                  minDate={todayISODate()}
                  onSelect={setRescheduleDate}
                  isDateDisabled={isDateClosed}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Time Slot</label>
                {rescheduleLoadingConflicts ? (
                  <p className="text-sm text-slate-400">Checking availability…</p>
                ) : (
                  <select
                    value={rescheduleHour ?? ''}
                    onChange={(e) => setRescheduleHour(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {timeSlots.map((slot) => {
                      const isTaken = rescheduleConflicts.has(
                        new Date(slot.startISO(rescheduleDate)).getTime()
                      );
                      return (
                        <option key={slot.hour} value={slot.hour} disabled={isTaken}>
                          {slot.label}
                          {isTaken ? ' (unavailable)' : ''}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>

              {rescheduleError && <p className="text-sm text-red-600">{rescheduleError}</p>}

              <button
                onClick={handleConfirmReschedule}
                disabled={rescheduleSaving || rescheduleLoadingConflicts || rescheduleHour === null}
                className="w-full rounded-xl bg-emerald-600 text-white font-medium py-2.5 text-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {rescheduleSaving ? 'Saving…' : 'Confirm Reschedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
