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
  const [selectedHours, setSelectedHours] = useState<number[]>([]);
  const [blockReason, setBlockReason] = useState('');
  const [addingBlock, setAddingBlock] = useState(false);
  const [blockInfo, setBlockInfo] = useState<string | null>(null);
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

  // A fresh pick of court/date shouldn't carry over an hour selection that
  // was only meaningful for the previous one.
  useEffect(() => {
    setSelectedHours([]);
  }, [blockCourtId, blockDate]);

  // Which of this court's slots on this date are already blocked — greyed
  // out below rather than offered again, since re-blocking one is a no-op.
  const alreadyBlockedTimes = useMemo(() => {
    return new Set(
      blockedSlots
        .filter((b) => b.court_id === blockCourtId)
        .map((b) => new Date(b.start_time).getTime())
    );
  }, [blockedSlots, blockCourtId]);

  function isSlotAlreadyBlocked(hour: number) {
    const slot = timeSlots.find((s) => s.hour === hour);
    if (!slot) return false;
    return alreadyBlockedTimes.has(new Date(slot.startISO(blockDate)).getTime());
  }

  function toggleHour(hour: number) {
    if (isSlotAlreadyBlocked(hour)) return;
    setSelectedHours((prev) =>
      prev.includes(hour) ? prev.filter((h) => h !== hour) : [...prev, hour].sort((a, b) => a - b)
    );
  }

  async function handleAddBlock(e: React.FormEvent) {
    e.preventDefault();
    if (!blockCourtId || selectedHours.length === 0) return;

    setAddingBlock(true);
    setBlockedSlotsError(null);
    setBlockInfo(null);

    let blockedCount = 0;
    let alreadyBlockedCount = 0;
    let failedCount = 0;

    // One insert per slot rather than a single bulk insert, so a slot
    // that's already blocked (or any other single failure) doesn't stop
    // the rest of the selection from going through.
    for (const hour of selectedHours) {
      const slot = timeSlots.find((s) => s.hour === hour);
      if (!slot) continue;

      const { error } = await supabase.from('blocked_slots').insert({
        court_id: blockCourtId,
        start_time: slot.startISO(blockDate),
        end_time: slot.endISO(blockDate),
        reason: blockReason.trim() || null,
      });

      if (error) {
        if (error.code === '23505') {
          alreadyBlockedCount++;
        } else {
          console.error(`Failed to block ${slot.label} on ${blockDate}:`, error);
          failedCount++;
        }
      } else {
        blockedCount++;
      }
    }

    setAddingBlock(false);

    if (failedCount > 0) {
      setBlockedSlotsError(
        `Blocked ${blockedCount} slot${blockedCount === 1 ? '' : 's'}, but ${failedCount} failed. Please try again for the remaining slot(s).`
      );
    } else {
      setBlockInfo(
        alreadyBlockedCount > 0
          ? `Blocked ${blockedCount} new slot${blockedCount === 1 ? '' : 's'} (${alreadyBlockedCount} were already blocked).`
          : `Blocked ${blockedCount} slot${blockedCount === 1 ? '' : 's'}.`
      );
    }

    setBlockReason('');
    setSelectedHours([]);
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
        or private events). To close a whole day, use Hours &amp; Holidays instead.
      </p>

      {blockedSlotsError && <p className="text-sm text-red-600 mb-3">{blockedSlotsError}</p>}
      {blockInfo && <p className="text-sm text-emerald-600 mb-3">{blockInfo}</p>}

      <form onSubmit={handleAddBlock} className="space-y-4 mb-5">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Court</label>
          <select
            value={blockCourtId ?? ''}
            onChange={(e) => setBlockCourtId(e.target.value)}
            className="w-full sm:w-64 rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
          <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
          <DateCalendar
            selectedDate={blockDate}
            minDate={todayISODate()}
            onSelect={setBlockDate}
            accentColor="var(--admin-btn-bg)"
            isDateDisabled={isDateClosed}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-slate-600">
              Time Slots{' '}
              <span className="text-slate-400 font-normal">(click to select)</span>
            </label>
            {!isDateClosed(blockDate) && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedHours(
                      timeSlots.filter((s) => !isSlotAlreadyBlocked(s.hour)).map((s) => s.hour)
                    )
                  }
                  className="text-xs text-emerald-700 hover:text-emerald-800 underline underline-offset-2"
                >
                  Select All Day
                </button>
                {selectedHours.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedHours([])}
                    className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
          {isDateClosed(blockDate) ? (
            <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              This date is already closed — nothing to block.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {timeSlots.map((slot) => {
                const blocked = isSlotAlreadyBlocked(slot.hour);
                const selected = selectedHours.includes(slot.hour);
                return (
                  <button
                    key={slot.hour}
                    type="button"
                    disabled={blocked}
                    onClick={() => toggleHour(slot.hour)}
                    style={
                      selected
                        ? { backgroundColor: 'var(--admin-btn-bg)', borderColor: 'var(--admin-btn-bg)' }
                        : undefined
                    }
                    className={`rounded-xl border px-3 py-3 text-sm font-medium text-center transition-colors ${
                      blocked
                        ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed line-through'
                        : selected
                        ? 'text-[var(--admin-btn-label)]'
                        : 'bg-white border-slate-300 text-slate-700 hover:border-emerald-400'
                    }`}
                  >
                    {slot.label}
                    {blocked && <span className="block text-xs mt-0.5">Already blocked</span>}
                  </button>
                );
              })}
            </div>
          )}
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
          disabled={addingBlock || !blockCourtId || selectedHours.length === 0}
          className="rounded-lg bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] text-sm font-medium px-4 py-2.5 hover:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {addingBlock
            ? 'Blocking…'
            : selectedHours.length > 0 &&
              selectedHours.length ===
                timeSlots.filter((s) => !isSlotAlreadyBlocked(s.hour)).length
            ? `Block Entire Day (${selectedHours.length} slots)`
            : `Block ${selectedHours.length} Selected Slot${selectedHours.length === 1 ? '' : 's'}`}
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
