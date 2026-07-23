'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DateCalendar from '@/components/DateCalendar';
import { buildTimeSlots, todayISODate } from '@/lib/timeSlots';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';
import { fetchHolidays, type Holiday } from '@/lib/holidays';
import { fetchPriceTiers, getSlotPrice, formatPrice, type PriceTier } from '@/lib/priceTiers';
import { formatConfirmationNumber, formatReferenceNumber } from '@/lib/confirmationCode';
import CopyableCode from '@/components/CopyableCode';

type BookingStatus = 'pending' | 'confirmed' | 'cancelled';
type DateFilterMode = 'all' | 'today' | 'week' | 'month' | 'custom';
type StatusFilter = 'all' | BookingStatus;
type SortColumn = 'player' | 'phone' | 'transaction' | 'date' | 'court' | 'hours' | 'price' | 'status';

interface Booking {
  id: string;
  court_id: string;
  transaction_id: number | null;
  player_name: string;
  player_phone: string;
  player_email: string | null;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  receipt_url: string | null;
  created_at: string;
  price: number | null;
  checked_in: boolean;
  checked_in_at: string | null;
  courts: { name: string } | null;
}

interface Court {
  id: string;
  name: string;
}

interface TransactionGroup {
  key: string;
  transactionId: number | null;
  bookings: Booking[];
  playerName: string;
  playerPhone: string;
  playerEmail: string | null;
  courtName: string;
  createdAt: string;
  totalHours: number;
  totalPrice: number | null;
  status: BookingStatus | 'mixed';
  receiptUrl: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
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

// Confirmation # is stamped with the court date (Philippine time), not the
// date the booking was submitted — 'en-CA' formats as YYYY-MM-DD directly.
function playDateISO(startIso: string) {
  return new Date(startIso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

// "6:00 AM - 7:00 AM" for a single booked slot — pinned to Philippine time
// so it's correct regardless of what timezone the admin's browser is in.
function formatSlotTimeRange(startIso: string, endIso: string) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Manila',
    });
  return `${fmt(startIso)} - ${fmt(endIso)}`;
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

const PAGE_SIZE_OPTIONS = [10, 50, 100, 200, 500, 1000];

const STATUS_STYLES: Record<BookingStatus | 'mixed', string> = {
  pending: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  mixed: 'bg-slate-100 text-slate-600',
};

// Hoisted out of BookingsTab — defining a component inline in a parent's
// render body gives it a fresh identity every render, which makes React
// unmount/remount every header cell instead of just updating it.
function SortHeader({
  column,
  sortColumn,
  sortDirection,
  onSort,
  children,
}: {
  column: SortColumn;
  sortColumn: SortColumn | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
  children: React.ReactNode;
}) {
  const isActive = sortColumn === column;
  return (
    <th
      onClick={() => onSort(column)}
      className="px-4 sm:px-6 py-3 cursor-pointer select-none hover:text-slate-700 whitespace-nowrap"
    >
      {children} {isActive && (sortDirection === 'asc' ? '▲' : '▼')}
    </th>
  );
}

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
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [courts, setCourts] = useState<Court[]>([]);

  // ---------- Filters ----------
  // Defaults to "This month" rather than "All dates" — fetching and
  // rendering the entire history of the table on every mount (including
  // every time the admin switches back to this tab) is what caused the
  // dashboard to freeze once real booking volume built up.
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('month');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [courtFilter, setCourtFilter] = useState<string>('all');
  const [phoneSearch, setPhoneSearch] = useState('');
  const [confirmationSearch, setConfirmationSearch] = useState('');

  // ---------- Sorting ----------
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // ---------- Pagination ----------
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // ---------- Details modal ----------
  const [detailsKey, setDetailsKey] = useState<string | null>(null);

  // ---------- Bulk actions ----------
  const [bulkUpdatingKey, setBulkUpdatingKey] = useState<string | null>(null);
  const [bulkActionError, setBulkActionError] = useState<{ key: string; message: string } | null>(
    null
  );

  // ---------- Check-in ----------
  const [checkingInKey, setCheckingInKey] = useState<string | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);

  useEffect(() => {
    fetchSiteSettings(supabase).then(setSettings);
    fetchHolidays(supabase).then(setHolidays);
    fetchPriceTiers(supabase).then(setPriceTiers);
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

  // Date/status/court are now applied server-side in fetchBookings (see
  // below) so the fetch itself stays bounded — this only handles the
  // phone/confirmation# search, which stay client-side since they're
  // live-typing and shouldn't trigger a network round-trip per keystroke.
  const filteredBookings = useMemo(() => {
    const phoneQuery = phoneSearch.trim().toLowerCase();
    const confirmationQuery = confirmationSearch.trim();
    return bookings.filter((b) => {
      if (phoneQuery && !b.player_phone.toLowerCase().includes(phoneQuery)) return false;
      if (confirmationQuery && !String(b.transaction_id ?? '').includes(confirmationQuery)) {
        return false;
      }
      return true;
    });
  }, [bookings, phoneSearch, confirmationSearch]);

  function clearFilters() {
    setDateFilterMode('month');
    setCustomDateFrom('');
    setCustomDateTo('');
    setStatusFilter('all');
    setCourtFilter('all');
    setPhoneSearch('');
    setConfirmationSearch('');
    setCurrentPage(1);
  }

  const filtersActive =
    dateFilterMode !== 'month' ||
    statusFilter !== 'all' ||
    courtFilter !== 'all' ||
    phoneSearch.trim() !== '' ||
    confirmationSearch.trim() !== '';

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
    setError(null);

    const range =
      dateFilterMode === 'custom'
        ? { from: customDateFrom, to: customDateTo }
        : getPresetRange(dateFilterMode);

    // Custom range selected but not fully filled in yet — don't run an
    // unbounded query in the meantime.
    if (dateFilterMode === 'custom' && (!range.from || !range.to)) {
      setBookings([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    let query = supabase
      .from('bookings')
      .select(
        'id, court_id, transaction_id, player_name, player_phone, player_email, start_time, end_time, status, receipt_url, created_at, price, checked_in, checked_in_at, courts(name)'
      )
      .order('id', { ascending: false });

    // Bounding this server-side (rather than fetching every booking ever
    // made and filtering client-side) keeps the fetch — and the grouping/
    // sorting/rendering that follows — proportional to the selected range
    // instead of the whole table's history.
    if (range.from) query = query.gte('start_time', `${range.from}T00:00:00+08:00`);
    if (range.to) query = query.lte('start_time', `${range.to}T23:59:59+08:00`);
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (courtFilter !== 'all') query = query.eq('court_id', courtFilter);

    const { data, error } = await query;

    if (error) {
      console.error('Failed to load bookings:', error);
      setError('Could not load bookings. Please refresh.');
      setLoading(false);
      return;
    }

    setBookings((data ?? []) as unknown as Booking[]);
    setLoading(false);
  }, [dateFilterMode, customDateFrom, customDateTo, statusFilter, courtFilter]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  // New-booking notifications (toast + nav badge) live in the parent
  // AdminPage instead of here, since it stays mounted across tab switches
  // and this component doesn't. Refetch when the admin returns to this tab
  // after being away, so it stays in sync with whatever came in meanwhile.
  useEffect(() => {
    // A single multi-slot booking inserts one row per hour, each firing
    // its own INSERT event — debounce so a burst of N events triggers one
    // refetch instead of N full reloads landing back to back.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const channel = supabase
      .channel('bookings-tab-refetch')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bookings' },
        () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => fetchBookings(), 800);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [fetchBookings]);

  function isHoldExpired(booking: Booking) {
    if (booking.status !== 'pending') return false;
    return now - new Date(booking.created_at).getTime() > settings.pending_hold_minutes * 60 * 1000;
  }

  // ---------- Group bookings into transactions ----------

  const transactionGroups = useMemo<TransactionGroup[]>(() => {
    const map = new Map<string, Booking[]>();
    for (const b of filteredBookings) {
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
      // Checking in happens once, when the client physically arrives —
      // treated as a single transaction-level event rather than per slot,
      // so the group only counts as checked in once every slot in it does.
      const checkedIn = sorted.every((b) => b.checked_in);
      const checkedInAt = checkedIn
        ? sorted.reduce(
            (min, b) => (b.checked_in_at && b.checked_in_at < min ? b.checked_in_at : min),
            sorted[0].checked_in_at ?? ''
          )
        : null;

      groups.push({
        key,
        transactionId: first.transaction_id,
        bookings: sorted,
        playerName: first.player_name,
        playerPhone: first.player_phone,
        playerEmail: first.player_email,
        courtName: first.courts?.name ?? '—',
        createdAt,
        totalHours: sorted.length,
        totalPrice,
        status,
        receiptUrl: first.receipt_url,
        checkedIn,
        checkedInAt,
      });
    }
    return groups;
    // "Hold expired" is intentionally computed at render time (per row,
    // via isHoldExpired) rather than baked in here — this grouping/sorting
    // pass is the expensive part, and it shouldn't re-run every 30s just
    // because the live clock ticked. Only `now`-dependent display needs
    // to react to the tick, not the whole regroup.
  }, [filteredBookings]);

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  const sortedGroups = useMemo(() => {
    if (!sortColumn) return transactionGroups;
    const sorted = [...transactionGroups].sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'player':
          cmp = a.playerName.localeCompare(b.playerName);
          break;
        case 'phone':
          cmp = a.playerPhone.localeCompare(b.playerPhone);
          break;
        case 'transaction':
          cmp = (a.transactionId ?? 0) - (b.transactionId ?? 0);
          break;
        case 'date':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'court':
          cmp = a.courtName.localeCompare(b.courtName);
          break;
        case 'hours':
          cmp = a.totalHours - b.totalHours;
          break;
        case 'price':
          cmp = (a.totalPrice ?? 0) - (b.totalPrice ?? 0);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [transactionGroups, sortColumn, sortDirection]);

  // Clamped for display rather than written back to state — if a filter
  // change shrinks the result set out from under the current page, this
  // pulls the visible page back into range without an extra effect just
  // to keep `currentPage` itself in sync.
  const totalPages = Math.max(1, Math.ceil(sortedGroups.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedGroups = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedGroups.slice(start, start + pageSize);
  }, [sortedGroups, safePage, pageSize]);

  const detailsGroup = sortedGroups.find((g) => g.key === detailsKey) ?? null;

  async function updateStatus(bookingId: string, status: BookingStatus): Promise<boolean> {
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
          return false;
        }

        if (conflicts && conflicts.length > 0) {
          setActionError({
            bookingId,
            message:
              'This slot is already confirmed for another booking. Reject this one, or reschedule it instead.',
          });
          setUpdatingId(null);
          return false;
        }
      }
    }

    const { error } = await supabase.from('bookings').update({ status }).eq('id', bookingId);

    if (error) {
      console.error(`Failed to set booking ${bookingId} to ${status}:`, error);
      setActionError({ bookingId, message: `Could not update status: ${error.message}` });
      setUpdatingId(null);
      return false;
    }

    setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, status } : b)));
    setUpdatingId(null);

    // Best-effort customer email alert — the status change already
    // succeeded, so a notification failure shouldn't block or roll back
    // the approval itself.
    if (status === 'confirmed' && settings.notify_customer_on_approval) {
      fetch('/api/bookings/confirm-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      }).catch((err) => console.error('Failed to trigger confirmation email:', err));
    }

    return true;
  }

  async function handleBulkAction(group: TransactionGroup, targetStatus: BookingStatus) {
    setBulkUpdatingKey(group.key);
    setBulkActionError(null);

    const targets = group.bookings.filter((b) => b.status !== targetStatus);
    let failures = 0;

    for (const booking of targets) {
      const ok = await updateStatus(booking.id, targetStatus);
      if (!ok) failures++;
    }

    setBulkUpdatingKey(null);

    if (failures > 0) {
      setBulkActionError({
        key: group.key,
        message: `${failures} of ${targets.length} slot(s) couldn't be updated — open View Details to resolve individually.`,
      });
    }
  }

  async function handleCheckIn(group: TransactionGroup, checkedIn: boolean) {
    setCheckingInKey(group.key);
    setCheckInError(null);

    const { error } = await supabase
      .from('bookings')
      .update({ checked_in: checkedIn, checked_in_at: checkedIn ? new Date().toISOString() : null })
      .in(
        'id',
        group.bookings.map((b) => b.id)
      );

    if (error) {
      console.error(`Failed to update check-in for transaction ${group.key}:`, error);
      setCheckInError(`Could not update check-in status: ${error.message}`);
      setCheckingInKey(null);
      return;
    }

    setCheckingInKey(null);
    await fetchBookings();
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

    const updates: Record<string, string | number> = {
      start_time: slot.startISO(rescheduleDate),
      end_time: slot.endISO(rescheduleDate),
      // Recalculate in case the new slot falls in a different price tier
      // than the original one.
      price: getSlotPrice(slot.hour, settings.pricing_mode, settings.flat_price, priceTiers),
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

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Search confirmation #
            </label>
            <input
              type="text"
              value={confirmationSearch}
              onChange={(e) => setConfirmationSearch(e.target.value)}
              placeholder="e.g. 1042"
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
        ) : sortedGroups.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 sm:px-6 py-6">
            No bookings match your filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                  <SortHeader column="player" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort}>Player</SortHeader>
                  <SortHeader column="phone" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort}>Phone</SortHeader>
                  <SortHeader column="transaction" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort}>Confirmation #</SortHeader>
                  <SortHeader column="date" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort}>Date &amp; Time</SortHeader>
                  <SortHeader column="court" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort}>Court</SortHeader>
                  <SortHeader column="hours" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort}>Total Hours</SortHeader>
                  {settings.show_price && (
                    <SortHeader column="price" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort}>Price</SortHeader>
                  )}
                  <SortHeader column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort}>Status</SortHeader>
                  <th className="px-4 sm:px-6 py-3">Details</th>
                  <th className="px-4 sm:px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedGroups.map((group) => {
                  const isBulkUpdating = bulkUpdatingKey === group.key;
                  const hasHoldExpired = group.bookings.some(isHoldExpired);
                  return (
                    <tr
                      key={group.key}
                      onClick={() => setDetailsKey(group.key)}
                      className="border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 sm:px-6 py-3 font-medium text-slate-800 whitespace-nowrap">
                        {group.playerName}
                      </td>
                      <td className="px-4 sm:px-6 py-3 text-slate-600 whitespace-nowrap">
                        <div>{group.playerPhone}</div>
                        {group.playerEmail && (
                          <div className="text-xs text-slate-400">{group.playerEmail}</div>
                        )}
                      </td>
                      <td className="px-4 sm:px-6 py-3 text-slate-600 whitespace-nowrap font-mono text-xs">
                        {group.transactionId !== null
                          ? formatConfirmationNumber(
                              group.transactionId,
                              playDateISO(group.bookings[0].start_time)
                            )
                          : '—'}
                      </td>
                      <td className="px-4 sm:px-6 py-3 text-slate-600 whitespace-nowrap">
                        {formatDateTime(group.createdAt)}
                      </td>
                      <td className="px-4 sm:px-6 py-3 text-slate-600 whitespace-nowrap">
                        {group.courtName}
                      </td>
                      <td className="px-4 sm:px-6 py-3 text-slate-600 whitespace-nowrap">
                        {group.totalHours}
                      </td>
                      {settings.show_price && (
                        <td className="px-4 sm:px-6 py-3 text-slate-600 whitespace-nowrap">
                          {group.totalPrice !== null ? formatPrice(group.totalPrice) : '—'}
                        </td>
                      )}
                      <td className="px-4 sm:px-6 py-3 whitespace-nowrap">
                        <span
                          className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLES[group.status]}`}
                        >
                          {group.status}
                        </span>
                        {hasHoldExpired && (
                          <span
                            className="block text-[11px] text-amber-600 mt-1"
                            title="One or more slots may already be booked by someone else."
                          >
                            Hold expired
                          </span>
                        )}
                      </td>
                      <td
                        className="px-4 sm:px-6 py-3 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => setDetailsKey(group.key)}
                          className="rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium px-3 py-1.5 hover:bg-slate-200 transition-colors"
                        >
                          View Details
                        </button>
                      </td>
                      <td className="px-4 sm:px-6 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-2 whitespace-nowrap">
                          <button
                            onClick={() => handleBulkAction(group, 'confirmed')}
                            disabled={isBulkUpdating || group.status === 'confirmed'}
                            className="rounded-lg bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] text-xs font-medium px-3 py-1.5 hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleBulkAction(group, 'cancelled')}
                            disabled={isBulkUpdating || group.status === 'cancelled'}
                            className="rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-1.5 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                        {bulkActionError?.key === group.key && (
                          <p className="text-xs text-red-600 mt-1.5 max-w-xs whitespace-normal">
                            {bulkActionError.message}
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

        {sortedGroups.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-6 py-3 border-t border-slate-100 text-sm">
            <div className="flex items-center gap-2 text-slate-500">
              <span>Show</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <span>entries</span>
            </div>

            <p className="text-slate-500">
              Showing {(safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, sortedGroups.length)} of {sortedGroups.length}
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium px-3 py-1.5 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-slate-500 text-xs whitespace-nowrap">
                Page {safePage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium px-3 py-1.5 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
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

      {/* Transaction Details Modal */}
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
                <h3 className="font-semibold text-slate-800">Booking Details</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {detailsGroup.playerName} · {detailsGroup.courtName} ·{' '}
                  {formatDateTime(detailsGroup.createdAt)}
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
              {detailsGroup.transactionId !== null && (
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 space-y-2">
                  <CopyableCode
                    icon="ticket"
                    label="Confirmation #"
                    value={formatConfirmationNumber(
                      detailsGroup.transactionId,
                      playDateISO(detailsGroup.bookings[0].start_time)
                    )}
                  />
                  <CopyableCode
                    icon="hash"
                    label="Reference #"
                    value={formatReferenceNumber(detailsGroup.transactionId)}
                  />
                </div>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">
                  {detailsGroup.totalHours} hour{detailsGroup.totalHours !== 1 ? 's' : ''} booked
                </span>
                {settings.show_price && detailsGroup.totalPrice !== null && (
                  <span className="font-semibold text-slate-800">
                    Total: {formatPrice(detailsGroup.totalPrice)}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
                <div>
                  {detailsGroup.checkedIn ? (
                    <>
                      <span className="inline-block rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-1 text-xs font-medium">
                        ✓ Checked in
                      </span>
                      {detailsGroup.checkedInAt && (
                        <p className="text-xs text-slate-500 mt-1">
                          {formatDateTime(detailsGroup.checkedInAt)}
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-slate-500">Not checked in yet</span>
                  )}
                </div>
                <button
                  onClick={() => handleCheckIn(detailsGroup, !detailsGroup.checkedIn)}
                  disabled={checkingInKey === detailsGroup.key}
                  className={
                    detailsGroup.checkedIn
                      ? 'rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium px-3 py-1.5 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                      : 'rounded-lg bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] text-xs font-medium px-3 py-1.5 hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                  }
                >
                  {checkingInKey === detailsGroup.key
                    ? 'Saving…'
                    : detailsGroup.checkedIn
                      ? 'Undo Check-In'
                      : 'Check In'}
                </button>
              </div>
              {checkInError && <p className="text-xs text-red-600">{checkInError}</p>}

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

              <div className="space-y-2">
                {detailsGroup.bookings.map((booking) => {
                  const isUpdatingThis = updatingId === booking.id;
                  return (
                    <div key={booking.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-800">
                            {formatSlotTimeRange(booking.start_time, booking.end_time)}
                          </p>
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize mt-1 ${STATUS_STYLES[booking.status]}`}
                          >
                            {booking.status}
                          </span>
                          {isHoldExpired(booking) && (
                            <span className="block text-[11px] text-amber-600 mt-1">
                              Hold expired
                            </span>
                          )}
                        </div>
                        {settings.show_price && booking.price !== null && (
                          <span className="text-sm text-slate-600 shrink-0">
                            {formatPrice(booking.price)}
                          </span>
                        )}
                      </div>

                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => updateStatus(booking.id, 'confirmed')}
                          disabled={isUpdatingThis || booking.status === 'confirmed'}
                          className="rounded-lg bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] text-xs font-medium px-3 py-1.5 hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => updateStatus(booking.id, 'cancelled')}
                          disabled={isUpdatingThis || booking.status === 'cancelled'}
                          className="rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-1.5 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          Reject
                        </button>
                        {booking.status !== 'cancelled' && (
                          <button
                            onClick={() => openReschedule(booking)}
                            disabled={isUpdatingThis}
                            className="rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium px-3 py-1.5 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Reschedule
                          </button>
                        )}
                      </div>

                      {actionError?.bookingId === booking.id && (
                        <p className="text-xs text-red-600 mt-1.5">{actionError.message}</p>
                      )}
                    </div>
                  );
                })}
              </div>
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
                  accentColor="var(--admin-btn-bg)"
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
                className="w-full rounded-xl bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] font-medium py-2.5 text-sm hover:brightness-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
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
