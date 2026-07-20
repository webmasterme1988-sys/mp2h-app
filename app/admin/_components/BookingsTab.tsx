'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DateCalendar from '@/components/DateCalendar';
import { buildTimeSlots, todayISODate } from '@/lib/timeSlots';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';
import { fetchHolidays, type Holiday } from '@/lib/holidays';

type BookingStatus = 'pending' | 'confirmed' | 'cancelled';
type DateFilterMode = 'all' | 'today' | 'week' | 'month' | 'custom';
type StatusFilter = 'all' | BookingStatus;

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

interface Court {
  id: string;
  name: string;
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

// The slot's calendar date as experienced in the Philippines, not whatever
// date the raw UTC timestamp happens to fall on (a 6am PHT slot is still
// the previous day in UTC) — same class of bug fixed for the email
// notification's displayed time.
function bookingDatePH(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function toISODateLocal(date: Date) {
  return date.toLocaleDateString('en-CA');
}

function todayPH() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

// "Today"/"This Week"/"This Month" are anchored to the Philippines' current
// date regardless of what timezone the admin's own browser happens to be
// in (e.g. checking the dashboard while traveling), then computed with
// plain local-timezone calendar math from that anchor.
function getPresetRange(mode: DateFilterMode): { from: string; to: string } {
  const todayStr = todayPH();
  if (mode === 'today') return { from: todayStr, to: todayStr };

  const [y, m, d] = todayStr.split('-').map(Number);
  const anchor = new Date(y, m - 1, d);

  if (mode === 'week') {
    const sunday = new Date(anchor);
    sunday.setDate(anchor.getDate() - anchor.getDay());
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    return { from: toISODateLocal(sunday), to: toISODateLocal(saturday) };
  }

  if (mode === 'month') {
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    return { from: toISODateLocal(first), to: toISODateLocal(last) };
  }

  return { from: '', to: '' };
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
  const [actionError, setActionError] = useState<{ bookingId: string; message: string } | null>(
    null
  );
  const [receiptModalUrl, setReceiptModalUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [courts, setCourts] = useState<Court[]>([]);

  // ---------- Filters ----------
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('all');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [courtFilter, setCourtFilter] = useState<string>('all');
  const [phoneSearch, setPhoneSearch] = useState('');

  useEffect(() => {
    fetchSiteSettings(supabase).then(setSettings);
    fetchHolidays(supabase).then(setHolidays);
    supabase
      .from('courts')
      .select('id, name')
      .order('id')
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to load courts:', error);
          return;
        }
        setCourts((data ?? []) as Court[]);
      });
  }, []);

  const filteredBookings = useMemo(() => {
    const range =
      dateFilterMode === 'custom'
        ? { from: customDateFrom, to: customDateTo }
        : getPresetRange(dateFilterMode);
    const phoneQuery = phoneSearch.trim().toLowerCase();

    return bookings.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (courtFilter !== 'all' && b.court_id !== courtFilter) return false;
      if (phoneQuery && !b.player_phone.toLowerCase().includes(phoneQuery)) return false;

      if (range.from || range.to) {
        const bookingDate = bookingDatePH(b.start_time);
        if (range.from && bookingDate < range.from) return false;
        if (range.to && bookingDate > range.to) return false;
      }

      return true;
    });
  }, [bookings, dateFilterMode, customDateFrom, customDateTo, statusFilter, courtFilter, phoneSearch]);

  function clearFilters() {
    setDateFilterMode('all');
    setCustomDateFrom('');
    setCustomDateTo('');
    setStatusFilter('all');
    setCourtFilter('all');
    setPhoneSearch('');
  }

  const filtersActive =
    dateFilterMode !== 'all' || statusFilter !== 'all' || courtFilter !== 'all' || phoneSearch.trim() !== '';

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
    setActionError(null);

    // Approving a booking (whether it's pending or a previously-rejected
    // one being un-cancelled) can double-book a slot that's since been
    // confirmed for someone else — e.g. its hold expired and another
    // customer got approved first, or it was rejected and the slot was
    // re-booked. Check right before committing rather than trusting the
    // stale list already in memory.
    if (status === 'confirmed') {
      const booking = bookings.find((b) => b.id === bookingId);
      if (booking) {
        const { data: conflicts, error: conflictCheckError } = await supabase
          .from('bookings')
          .select('id')
          .eq('court_id', booking.court_id)
          .eq('start_time', booking.start_time)
          .eq('status', 'confirmed')
          .neq('id', bookingId);

        if (conflictCheckError) {
          console.error('Failed to check for slot conflicts:', conflictCheckError);
          setActionError({
            bookingId,
            message: 'Could not verify slot availability. Please try again.',
          });
          setUpdatingId(null);
          return;
        }

        if (conflicts && conflicts.length > 0) {
          setActionError({
            bookingId,
            message:
              'This slot is already confirmed for another booking. Reject this one, or reschedule it instead.',
          });
          setUpdatingId(null);
          return;
        }
      }
    }

    const { error } = await supabase.from('bookings').update({ status }).eq('id', bookingId);

    if (error) {
      console.error(`Failed to set booking ${bookingId} to ${status}:`, error);
      setActionError({ bookingId, message: `Could not update status: ${error.message}` });
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
    <div className="space-y-6">
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-800">Filters</h2>
          {filtersActive && (
            <button
              onClick={clearFilters}
              className="text-xs text-emerald-700 hover:text-emerald-800 underline underline-offset-2"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
            <select
              value={dateFilterMode}
              onChange={(e) => setDateFilterMode(e.target.value as DateFilterMode)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">All dates</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="custom">Custom range…</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Court</label>
            <select
              value={courtFilter}
              onChange={(e) => setCourtFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">All courts</option>
              {courts.map((court) => (
                <option key={court.id} value={court.id}>
                  {court.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Search phone number
            </label>
            <input
              type="text"
              value={phoneSearch}
              onChange={(e) => setPhoneSearch(e.target.value)}
              placeholder="e.g. 0917"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {dateFilterMode === 'custom' && (
          <div className="grid grid-cols-2 gap-3 mt-3 max-w-sm">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
              <input
                type="date"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
              <input
                type="date"
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {error && <p className="text-sm text-red-600 px-4 sm:px-6 pt-4">{error}</p>}

        {loading ? (
          <p className="text-sm text-slate-400 px-4 sm:px-6 py-6">Loading bookings…</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 sm:px-6 py-6">No bookings yet.</p>
        ) : filteredBookings.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 sm:px-6 py-6">
            No bookings match your filters.
          </p>
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
                {filteredBookings.map((booking) => {
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
                      <td className="px-4 sm:px-6 py-3">
                        <div className="flex gap-2 whitespace-nowrap">
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
                        {actionError?.bookingId === booking.id && (
                          <p className="text-xs text-red-600 mt-1.5 max-w-xs whitespace-normal">
                            {actionError.message}
                          </p>
                        )}
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
    </div>
  );
}
