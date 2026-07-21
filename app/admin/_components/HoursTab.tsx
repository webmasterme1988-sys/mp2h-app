'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';
import { fetchHolidays, type Holiday } from '@/lib/holidays';
import { formatHourLabel } from '@/lib/timeSlots';

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
// Closing time goes one hour further than opening time (24 = 12:00 AM,
// i.e. midnight) so the last bookable slot can run up to 11pm-12am.
const CLOSING_HOUR_OPTIONS = Array.from({ length: 25 }, (_, i) => i);
const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

function todayISODate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().split('T')[0];
}

function formatHolidayDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function HoursTab() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);

  const [openingHour, setOpeningHour] = useState(DEFAULT_SITE_SETTINGS.opening_hour);
  const [closingHour, setClosingHour] = useState(DEFAULT_SITE_SETTINGS.closing_hour);
  const [openDays, setOpenDays] = useState<number[]>(DEFAULT_SITE_SETTINGS.open_days);
  const [pendingHoldMinutes, setPendingHoldMinutes] = useState(
    DEFAULT_SITE_SETTINGS.pending_hold_minutes
  );
  const [autoConfirmBookings, setAutoConfirmBookings] = useState(
    DEFAULT_SITE_SETTINGS.auto_confirm_bookings
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidaysLoading, setHolidaysLoading] = useState(true);
  const [holidaysError, setHolidaysError] = useState<string | null>(null);
  const [newHolidayDate, setNewHolidayDate] = useState(todayISODate());
  const [newHolidayName, setNewHolidayName] = useState('');
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [removingHolidayId, setRemovingHolidayId] = useState<number | null>(null);

  useEffect(() => {
    fetchSiteSettings(supabase).then((loaded) => {
      setSettings(loaded);
      setOpeningHour(loaded.opening_hour);
      setClosingHour(loaded.closing_hour);
      setOpenDays(loaded.open_days);
      setPendingHoldMinutes(loaded.pending_hold_minutes);
      setAutoConfirmBookings(loaded.auto_confirm_bookings);
      setLoading(false);
    });
  }, []);

  const fetchHolidaysList = useCallback(async () => {
    setHolidaysLoading(true);
    setHolidaysError(null);
    const list = await fetchHolidays(supabase);
    setHolidays(list);
    setHolidaysLoading(false);
  }, []);

  useEffect(() => {
    fetchHolidaysList();
  }, [fetchHolidaysList]);

  function toggleDay(day: number) {
    setOpenDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  }

  async function handleSaveHours(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (closingHour <= openingHour) {
      setError('Closing time must be after opening time.');
      return;
    }
    if (openDays.length === 0) {
      setError('At least one day must be open.');
      return;
    }
    if (!autoConfirmBookings && pendingHoldMinutes <= 0) {
      setError('Booking hold time must be at least 1 minute.');
      return;
    }

    setSaving(true);

    const { error: upsertError } = await supabase.from('site_settings').upsert({
      id: 1,
      site_title: settings.site_title,
      site_subtitle: settings.site_subtitle,
      primary_color: settings.primary_color,
      submit_button_label: settings.submit_button_label,
      payment_note: settings.payment_note,
      opening_hour: openingHour,
      closing_hour: closingHour,
      open_days: openDays,
      pending_hold_minutes: pendingHoldMinutes,
      auto_confirm_bookings: autoConfirmBookings,
    });

    if (upsertError) {
      setError(upsertError.message);
      setSaving(false);
      return;
    }

    const refreshed = await fetchSiteSettings(supabase);
    setSettings(refreshed);
    setSaving(false);
    setSuccess(true);
  }

  async function handleAddHoliday(e: React.FormEvent) {
    e.preventDefault();
    if (!newHolidayDate) return;

    setAddingHoliday(true);
    setHolidaysError(null);

    const { error } = await supabase.from('holidays').insert({
      holiday_date: newHolidayDate,
      name: newHolidayName.trim() || null,
    });

    if (error) {
      setHolidaysError(
        error.code === '23505'
          ? 'That date is already marked as a holiday.'
          : `Could not add holiday: ${error.message}`
      );
      setAddingHoliday(false);
      return;
    }

    setNewHolidayName('');
    setAddingHoliday(false);
    await fetchHolidaysList();
  }

  async function handleRemoveHoliday(id: number) {
    setRemovingHolidayId(id);
    setHolidaysError(null);

    const { error } = await supabase.from('holidays').delete().eq('id', id);

    if (error) {
      setHolidaysError(`Could not remove holiday: ${error.message}`);
      setRemovingHolidayId(null);
      return;
    }

    setRemovingHolidayId(null);
    await fetchHolidaysList();
  }

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-2xl">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Opening Hours &amp; Days</h2>
        <p className="text-sm text-slate-500 mb-6">
          Controls which time slots and dates customers can book on the public page.
        </p>

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <form onSubmit={handleSaveHours} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Opening Time
                </label>
                <select
                  value={openingHour}
                  onChange={(e) => setOpeningHour(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {HOUR_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {formatHourLabel(h)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Closing Time
                </label>
                <select
                  value={closingHour}
                  onChange={(e) => setClosingHour(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {CLOSING_HOUR_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {formatHourLabel(h)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-2">Days Open</label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => {
                  const isOpen = openDays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                        isOpen
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-white border-slate-300 text-slate-500 hover:border-slate-400'
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoConfirmBookings}
                  onChange={(e) => setAutoConfirmBookings(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-700">
                    Auto-confirm bookings
                  </span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    New bookings are confirmed immediately instead of waiting for admin
                    approval. Since nothing stays &quot;pending&quot;, the hold time below no
                    longer applies.
                  </span>
                </span>
              </label>
            </div>

            <div className={autoConfirmBookings ? 'opacity-50' : undefined}>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Booking Hold Time (minutes)
              </label>
              <p className="text-xs text-slate-500 mb-2">
                A new booking holds its time slot as &quot;pending&quot; for this many minutes.
                If it isn&apos;t approved before then, the slot opens back up for other
                customers.
              </p>
              <input
                type="number"
                min={1}
                value={pendingHoldMinutes}
                onChange={(e) => setPendingHoldMinutes(Number(e.target.value))}
                disabled={autoConfirmBookings}
                className="w-32 rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-50"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-emerald-600">Saved.</p>}

            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-emerald-600 text-white font-medium px-6 py-2.5 text-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </form>
        )}
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 max-w-2xl">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Holidays</h2>
        <p className="text-sm text-slate-500 mb-4">
          Specific dates the facility is closed, regardless of the weekly schedule above.
        </p>

        {holidaysError && <p className="text-sm text-red-600 mb-3">{holidaysError}</p>}

        {holidaysLoading ? (
          <p className="text-sm text-slate-400 mb-4">Loading holidays…</p>
        ) : (
          <div className="space-y-2 mb-5">
            {holidays.length === 0 && (
              <p className="text-sm text-slate-400">No holidays added yet.</p>
            )}
            {holidays.map((holiday) => (
              <div
                key={holiday.id}
                className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {formatHolidayDate(holiday.holiday_date)}
                  </p>
                  {holiday.name && <p className="text-xs text-slate-500">{holiday.name}</p>}
                </div>
                <button
                  onClick={() => handleRemoveHoliday(holiday.id)}
                  disabled={removingHolidayId === holiday.id}
                  className="rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-1.5 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {removingHolidayId === holiday.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAddHoliday} className="flex flex-col sm:flex-row gap-2">
          <input
            type="date"
            value={newHolidayDate}
            onChange={(e) => setNewHolidayDate(e.target.value)}
            required
            className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <input
            type="text"
            value={newHolidayName}
            onChange={(e) => setNewHolidayName(e.target.value)}
            placeholder="Name (optional, e.g. Christmas Day)"
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            disabled={addingHoliday || !newHolidayDate}
            className="rounded-lg bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {addingHoliday ? 'Adding…' : 'Add Holiday'}
          </button>
        </form>
      </section>
    </div>
  );
}
