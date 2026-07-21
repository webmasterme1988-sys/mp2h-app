'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DateCalendar from '@/components/DateCalendar';
import { buildTimeSlots, todayISODate, type TimeSlot } from '@/lib/timeSlots';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';
import { fetchHolidays, type Holiday } from '@/lib/holidays';
import { fetchPriceTiers, getSlotPrice, formatPrice, type PriceTier } from '@/lib/priceTiers';
import { downloadCsv } from '@/lib/csvExport';

interface Court {
  id: string;
  name: string;
}

function todayPH() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

// This mirrors the public booking page's court/date/slot-grid section as
// closely as possible — same components, same availability logic — just
// read-only, and only ever showing slots that are still open.
export default function ReportAvailableSlots() {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [selectedCourtId, setSelectedCourtId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayISODate());

  const [bookedStartTimes, setBookedStartTimes] = useState<Set<number>>(new Set());
  const [blockedStartTimes, setBlockedStartTimes] = useState<Set<number>>(new Set());
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [now, setNow] = useState<number>(() => Date.now());
  const [exporting, setExporting] = useState(false);

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
        if (data && data.length > 0) {
          setCourts(data as Court[]);
          setSelectedCourtId((data[0] as Court).id);
        }
      });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const timeSlots = buildTimeSlots(settings.opening_hour, settings.closing_hour);

  function isDateClosed(iso: string) {
    const holidayDates = new Set(holidays.map((h) => h.holiday_date));
    if (holidayDates.has(iso)) return true;
    const weekday = new Date(`${iso}T00:00:00`).getDay();
    return !settings.open_days.includes(weekday);
  }

  const getPrice = useCallback(
    (hour: number) => getSlotPrice(hour, settings.pricing_mode, settings.flat_price, priceTiers),
    [settings.pricing_mode, settings.flat_price, priceTiers]
  );

  // Identical to the booking page's own fetch: a 'pending' booking only
  // holds the slot until its hold expires, 'confirmed' always holds it.
  const fetchAvailability = useCallback(async () => {
    if (!selectedCourtId || !selectedDate || isDateClosed(selectedDate)) {
      setBookedStartTimes(new Set());
      setBlockedStartTimes(new Set());
      return;
    }

    setLoadingSlots(true);
    setSlotsError(null);

    const dayStart = new Date(`${selectedDate}T00:00:00`).toISOString();
    const dayEnd = new Date(`${selectedDate}T23:59:59`).toISOString();

    const [bookingsResult, blockedResult] = await Promise.all([
      supabase
        .from('bookings')
        .select('start_time, status, created_at')
        .eq('court_id', selectedCourtId)
        .gte('start_time', dayStart)
        .lte('start_time', dayEnd)
        .in('status', ['pending', 'confirmed']),
      supabase
        .from('blocked_slots')
        .select('start_time')
        .eq('court_id', selectedCourtId)
        .gte('start_time', dayStart)
        .lte('start_time', dayEnd),
    ]);

    if (bookingsResult.error) {
      console.error('Failed to load bookings:', bookingsResult.error);
      setSlotsError('Could not load availability. Please refresh.');
      setLoadingSlots(false);
      return;
    }
    if (blockedResult.error) {
      console.error('Failed to load blocked slots:', blockedResult.error);
    }

    const holdMs = settings.pending_hold_minutes * 60 * 1000;
    const nowTime = Date.now();
    const bookedSet = new Set<number>(
      (
        bookingsResult.data as { start_time: string; status: string; created_at: string }[] | null
      )
        ?.filter((row) => {
          if (row.status !== 'pending') return true;
          return nowTime - new Date(row.created_at).getTime() < holdMs;
        })
        .map((row) => new Date(row.start_time).getTime()) ?? []
    );
    const blockedSet = new Set<number>(
      (blockedResult.data ?? []).map((row: { start_time: string }) =>
        new Date(row.start_time).getTime()
      )
    );
    setBookedStartTimes(bookedSet);
    setBlockedStartTimes(blockedSet);
    setLoadingSlots(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourtId, selectedDate, settings.pending_hold_minutes, settings.open_days, holidays]);

  useEffect(() => {
    fetchAvailability();
    // Re-runs on every `now` tick too, so a slot whose pending hold just
    // expired (or that just slipped into the past) drops off live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAvailability, now]);

  function isSlotAvailable(slot: TimeSlot) {
    const t = new Date(slot.startISO(selectedDate)).getTime();
    if (bookedStartTimes.has(t) || blockedStartTimes.has(t)) return false;
    return t > now;
  }

  const availableSlots = timeSlots.filter(isSlotAvailable);
  const selectedCourt = courts.find((c) => c.id === selectedCourtId);

  function handleExport() {
    if (availableSlots.length === 0) return;
    setExporting(true);

    downloadCsv(
      `available-slots-${selectedDate}-${todayPH()}.csv`,
      availableSlots.map((slot) => ({
        Date: selectedDate,
        Court: selectedCourt?.name ?? '',
        Time: slot.label,
        ...(settings.show_price ? { Price: getPrice(slot.hour) } : {}),
      }))
    );

    setExporting(false);
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Available Booking Slots</h2>
      <p className="text-sm text-slate-500 mb-4">
        Same court &amp; date picker as the public booking page — only slots that are still open
        are shown.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Court</label>
          <div className="flex gap-2">
            {courts.length === 0 && (
              <span className="text-sm text-slate-400">Loading courts…</span>
            )}
            {courts.map((court) => {
              const isSelected = selectedCourtId === court.id;
              return (
                <button
                  key={court.id}
                  onClick={() => setSelectedCourtId(court.id)}
                  className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                    isSelected
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:border-emerald-400'
                  }`}
                >
                  {court.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
          <DateCalendar
            selectedDate={selectedDate}
            minDate={todayISODate()}
            onSelect={setSelectedDate}
            isDateDisabled={isDateClosed}
          />
        </div>
      </div>

      {slotsError && <p className="text-sm text-red-600 mb-3">{slotsError}</p>}

      {isDateClosed(selectedDate) ? (
        <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          Closed on this day.
        </p>
      ) : loadingSlots ? (
        <p className="text-sm text-slate-400">Checking availability…</p>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-800">{availableSlots.length}</span> of{' '}
              {timeSlots.length} slots available
            </p>
            <button
              onClick={handleExport}
              disabled={exporting || availableSlots.length === 0}
              className="rounded-xl bg-slate-100 text-slate-700 border border-slate-200 text-sm font-medium px-4 py-2 hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {exporting ? 'Preparing…' : 'Export to Excel'}
            </button>
          </div>

          {availableSlots.length === 0 ? (
            <p className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              No available slots for this court on this date.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {availableSlots.map((slot) => (
                <div
                  key={slot.hour}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-medium text-center text-slate-700"
                >
                  {slot.label}
                  {settings.show_price && (
                    <span className="block text-xs mt-0.5 text-slate-400">
                      {formatPrice(getPrice(slot.hour))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
