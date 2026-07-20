'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DateCalendar from '@/components/DateCalendar';
import { buildTimeSlots, todayISODate } from '@/lib/timeSlots';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';
import { fetchHolidays, type Holiday } from '@/lib/holidays';

interface Court {
  id: string;
  name: string;
}

interface BlockedSlot {
  id: number;
  court_id: string;
  start_time: string;
  end_time: string;
  reason: string | null;
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

export default function BlockSlotsTab() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [holidays, setHolidays] = useState<Holiday[]>([]);

  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [blockedSlotsLoading, setBlockedSlotsLoading] = useState(true);
  const [blockedSlotsError, setBlockedSlotsError] = useState<string | null>(null);
  const [blockCourtId, setBlockCourtId] = useState<string | null>(null);
  const [blockDate, setBlockDate] = useState<string>(todayISODate());
  const [blockHour, setBlockHour] = useState<number | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [addingBlock, setAddingBlock] = useState(false);
  const [removingBlockId, setRemovingBlockId] = useState<number | null>(null);

  const timeSlots = useMemo(
    () => buildTimeSlots(settings.opening_hour, settings.closing_hour),
    [settings.opening_hour, settings.closing_hour]
  );

  const holidayDates = useMemo(() => new Set(holidays.map((h) => h.holiday_date)), [holidays]);

  const isDateClosed = useCallback(
    (iso: string) => {
      if (holidayDates.has(iso)) return true;
      const weekday = new Date(`${iso}T00:00:00`).getDay();
      return !settings.open_days.includes(weekday);
    },
    [holidayDates, settings.open_days]
  );

  useEffect(() => {
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
    fetchSiteSettings(supabase).then(setSettings);
    fetchHolidays(supabase).then(setHolidays);
  }, []);

  // Default the time-slot picker to the first slot once hours load (or
  // reset it if the configured hours change and shrink the slot list).
  useEffect(() => {
    if (timeSlots.length === 0) return;
    if (blockHour === null || !timeSlots.some((s) => s.hour === blockHour)) {
      setBlockHour(timeSlots[0].hour);
    }
  }, [timeSlots, blockHour]);

  const fetchBlockedSlots = useCallback(async () => {
    setBlockedSlotsLoading(true);
    setBlockedSlotsError(null);

    const { data, error } = await supabase
      .from('blocked_slots')
      .select('id, court_id, start_time, end_time, reason, courts(name)')
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Failed to load blocked slots:', error);
      setBlockedSlotsError('Could not load blocked slots. Please refresh.');
      setBlockedSlotsLoading(false);
      return;
    }

    setBlockedSlots((data ?? []) as unknown as BlockedSlot[]);
    setBlockedSlotsLoading(false);
  }, []);

  useEffect(() => {
    fetchBlockedSlots();
  }, [fetchBlockedSlots]);

  // Default the block-slot form to the first court once courts load.
  useEffect(() => {
    if (blockCourtId === null && courts.length > 0) {
      setBlockCourtId(courts[0].id);
    }
  }, [courts, blockCourtId]);

  async function handleAddBlock(e: React.FormEvent) {
    e.preventDefault();
    if (!blockCourtId) return;

    const slot = timeSlots.find((s) => s.hour === blockHour);
    if (!slot) return;

    setAddingBlock(true);
    setBlockedSlotsError(null);

    const { error } = await supabase.from('blocked_slots').insert({
      court_id: blockCourtId,
      start_time: slot.startISO(blockDate),
      end_time: slot.endISO(blockDate),
      reason: blockReason.trim() || null,
    });

    if (error) {
      console.error('Failed to block slot:', error);
      setBlockedSlotsError(
        error.code === '23505'
          ? 'That slot is already blocked.'
          : `Could not block slot: ${error.message}`
      );
      setAddingBlock(false);
      return;
    }

    setBlockReason('');
    setAddingBlock(false);
    await fetchBlockedSlots();
  }

  async function handleUnblock(blockId: number) {
    setRemovingBlockId(blockId);
    setBlockedSlotsError(null);

    const { error } = await supabase.from('blocked_slots').delete().eq('id', blockId);

    if (error) {
      console.error(`Failed to unblock slot ${blockId}:`, error);
      setBlockedSlotsError(`Could not unblock slot: ${error.message}`);
      setRemovingBlockId(null);
      return;
    }

    setRemovingBlockId(null);
    await fetchBlockedSlots();
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Block Time Slots</h2>
      <p className="text-sm text-slate-500 mb-4">
        Blocked slots stop showing as bookable on the public booking page (e.g. for maintenance
        or private events).
      </p>

      {blockedSlotsError && <p className="text-sm text-red-600 mb-3">{blockedSlotsError}</p>}

      <form onSubmit={handleAddBlock} className="space-y-3 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Court</label>
            <select
              value={blockCourtId ?? ''}
              onChange={(e) => setBlockCourtId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {courts.length === 0 && <option value="">No courts yet</option>}
              {courts.map((court) => (
                <option key={court.id} value={court.id}>
                  {court.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Time Slot</label>
            <select
              value={blockHour ?? ''}
              onChange={(e) => setBlockHour(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {timeSlots.map((slot) => (
                <option key={slot.hour} value={slot.hour}>
                  {slot.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
          <DateCalendar
            selectedDate={blockDate}
            minDate={todayISODate()}
            onSelect={setBlockDate}
            isDateDisabled={isDateClosed}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">
            Reason <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
            placeholder="e.g. Court maintenance"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <button
          type="submit"
          disabled={addingBlock || !blockCourtId}
          className="rounded-lg bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {addingBlock ? 'Blocking…' : 'Block Slot'}
        </button>
      </form>

      {blockedSlotsLoading ? (
        <p className="text-sm text-slate-400">Loading blocked slots…</p>
      ) : blockedSlots.length === 0 ? (
        <p className="text-sm text-slate-400">No slots are currently blocked.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {blockedSlots.map((block) => (
            <li key={block.id} className="py-2.5 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {block.courts?.name ?? 'Court'} · {formatDateTime(block.start_time)}
                </p>
                {block.reason && <p className="text-xs text-slate-500 mt-0.5">{block.reason}</p>}
              </div>
              <button
                onClick={() => handleUnblock(block.id)}
                disabled={removingBlockId === block.id}
                className="rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-1.5 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                {removingBlockId === block.id ? 'Removing…' : 'Unblock'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
