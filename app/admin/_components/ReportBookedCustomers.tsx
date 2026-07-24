'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';
import { formatPrice } from '@/lib/priceTiers';
import { downloadCsv } from '@/lib/csvExport';
import { formatConfirmationNumber } from '@/lib/confirmationCode';

type BookingStatus = 'pending' | 'confirmed' | 'cancelled';
type DateFilterMode = 'all' | 'today' | 'week' | 'month' | 'custom';
type StatusFilter = 'all' | BookingStatus;

interface ReportRow {
  id: string;
  dailySequence: number | null;
  dateISO: string;
  transactionDateTime: string;
  playerName: string;
  playerPhone: string;
  playerEmail: string | null;
  courtName: string;
  date: string;
  time: string;
  status: BookingStatus;
  price: number | null;
  remark: string | null;
  rescheduleReason: string | null;
}

interface Court {
  id: string;
  name: string;
}

function todayPH() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function toISODateLocal(date: Date) {
  return date.toLocaleDateString('en-CA');
}

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

function bookingDatePH(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function formatDatePH(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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

// When the booking transaction was actually made — distinct from Date/Time
// above, which is the court slot the customer booked.
function formatTransactionDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
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

export default function ReportBookedCustomers() {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [courts, setCourts] = useState<Court[]>([]);

  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('month');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [courtFilter, setCourtFilter] = useState<string>('all');

  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchSiteSettings(supabase).then(setSettings);
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

  async function runReport(): Promise<ReportRow[] | null> {
    const range =
      dateFilterMode === 'custom'
        ? { from: customDateFrom, to: customDateTo }
        : getPresetRange(dateFilterMode);

    if (dateFilterMode === 'custom' && (!customDateFrom || !customDateTo)) {
      setError('Pick both a "from" and "to" date for a custom range.');
      return null;
    }

    setError(null);

    let query = supabase
      .from('bookings')
      .select(
        'id, transaction_id, daily_sequence, admin_remark, reschedule_reason, player_name, player_phone, player_email, start_time, end_time, status, price, created_at, courts(name)'
      )
      .order('start_time', { ascending: false });

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (courtFilter !== 'all') query = query.eq('court_id', courtFilter);

    const { data, error: queryError } = await query;

    if (queryError) {
      console.error('Failed to run booked customers report:', queryError);
      setError('Could not load the report. Please try again.');
      return null;
    }

    type Raw = {
      id: string;
      transaction_id: number | null;
      daily_sequence: number | null;
      admin_remark: string | null;
      reschedule_reason: string | null;
      player_name: string;
      player_phone: string;
      player_email: string | null;
      start_time: string;
      end_time: string;
      status: BookingStatus;
      price: number | null;
      created_at: string;
      courts: { name: string } | null;
    };

    const result: ReportRow[] = ((data ?? []) as unknown as Raw[])
      .filter((b) => {
        if (!range.from && !range.to) return true;
        const bookingDate = bookingDatePH(b.start_time);
        if (range.from && bookingDate < range.from) return false;
        if (range.to && bookingDate > range.to) return false;
        return true;
      })
      .map((b) => ({
        id: b.id,
        dailySequence: b.daily_sequence,
        dateISO: bookingDatePH(b.start_time),
        transactionDateTime: formatTransactionDateTime(b.created_at),
        playerName: b.player_name,
        playerPhone: b.player_phone,
        playerEmail: b.player_email,
        courtName: b.courts?.name ?? '—',
        date: formatDatePH(b.start_time),
        time: formatSlotTimeRange(b.start_time, b.end_time),
        status: b.status,
        price: b.price,
        remark: b.admin_remark,
        rescheduleReason: b.reschedule_reason,
      }));

    return result;
  }

  async function handlePreview() {
    setLoading(true);
    const result = await runReport();
    setRows(result);
    setLoading(false);
  }

  async function handleExport() {
    setExporting(true);
    const result = await runReport();
    setExporting(false);

    if (!result) return;
    if (result.length === 0) {
      setError('No rows to export for the current filters.');
      return;
    }

    downloadCsv(
      `booked-customers-${todayPH()}.csv`,
      result.map((r) => ({
        'Confirmation #':
          r.dailySequence !== null ? formatConfirmationNumber(r.dailySequence, r.dateISO) : '',
        'Transaction Date/Time': r.transactionDateTime,
        Player: r.playerName,
        Phone: r.playerPhone,
        Email: r.playerEmail ?? '',
        Court: r.courtName,
        Date: r.date,
        Time: r.time,
        Status: r.status,
        ...(settings.show_price ? { Price: r.price !== null ? r.price : '' } : {}),
        Remark: r.remark ?? '',
        'Reschedule Reason': r.rescheduleReason ?? '',
      }))
    );
  }

  const totalBookings = rows?.length ?? 0;
  const totalAmountPaid =
    rows?.filter((r) => r.status === 'confirmed').reduce((sum, r) => sum + (r.price ?? 0), 0) ?? 0;

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Booked Customers</h2>
      <p className="text-sm text-slate-500 mb-4">
        Every booking within a date range, with a summary of totals.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
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
      </div>

      {dateFilterMode === 'custom' && (
        <div className="grid grid-cols-2 gap-3 mb-3 max-w-sm">
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

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={handlePreview}
          disabled={loading}
          className="rounded-xl bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] text-sm font-medium px-4 py-2.5 hover:brightness-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Loading…' : 'Preview'}
        </button>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="rounded-xl bg-slate-100 text-slate-700 border border-slate-200 text-sm font-medium px-4 py-2.5 hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {exporting ? 'Preparing…' : 'Export to Excel'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {rows !== null && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 mb-4 max-w-md">
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Total Bookings</p>
              <p className="text-lg font-semibold text-slate-800">{totalBookings}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Total Amount Paid</p>
              <p className="text-lg font-semibold text-slate-800">
                {settings.show_price ? formatPrice(totalAmountPaid) : '—'}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">Confirmed bookings only</p>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-slate-400">No bookings match these filters.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase tracking-wide bg-slate-50">
                    <th className="px-4 py-2.5">Player</th>
                    <th className="px-4 py-2.5">Phone</th>
                    <th className="px-4 py-2.5">Email</th>
                    <th className="px-4 py-2.5">Confirmation #</th>
                    <th className="px-4 py-2.5">Transaction Date/Time</th>
                    <th className="px-4 py-2.5">Court</th>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Time</th>
                    <th className="px-4 py-2.5">Status</th>
                    {settings.show_price && <th className="px-4 py-2.5">Price</th>}
                    <th className="px-4 py-2.5">Remark</th>
                    <th className="px-4 py-2.5">Reschedule Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                        {row.playerName}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                        {row.playerPhone}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                        {row.playerEmail ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap font-mono text-xs">
                        {row.dailySequence !== null
                          ? formatConfirmationNumber(row.dailySequence, row.dateISO)
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                        {row.transactionDateTime}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                        {row.courtName}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{row.date}</td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{row.time}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span
                          className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLES[row.status]}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      {settings.show_price && (
                        <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                          {row.price !== null ? formatPrice(row.price) : '—'}
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-slate-600 max-w-[16rem] truncate" title={row.remark ?? ''}>
                        {row.remark ?? '—'}
                      </td>
                      <td
                        className="px-4 py-2.5 text-slate-600 max-w-[16rem] truncate"
                        title={row.rescheduleReason ?? ''}
                      >
                        {row.rescheduleReason ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
