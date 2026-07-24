'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DateCalendar from '@/components/DateCalendar';
import { buildTimeSlots, todayISODate } from '@/lib/timeSlots';
import { type SiteSettings } from '@/lib/siteSettings';
import { type PriceTier, getSlotPrice, formatPrice } from '@/lib/priceTiers';
import { type Holiday, fetchHolidays } from '@/lib/holidays';
import { hasSlotConflict } from '@/lib/slotAvailability';

interface Court {
  id: string;
  name: string;
}

interface AdminBookingModalProps {
  settings: SiteSettings;
  priceTiers: PriceTier[];
  courts: Court[];
  onClose: () => void;
  onBooked: () => void;
}

// Admin-side counterpart to the public booking flow: no payment
// QR/receipt (the admin is entering a booking they've already arranged
// with the customer some other way — phone, walk-in, etc), a Remark field
// instead, and a status the admin sets directly rather than always
// starting "pending". Still runs the exact same anti-double-booking check
// (lib/slotAvailability) as the public flow before committing.
export default function AdminBookingModal({
  settings,
  priceTiers,
  courts,
  onClose,
  onBooked,
}: AdminBookingModalProps) {
  const [courtId, setCourtId] = useState<string | null>(courts[0]?.id ?? null);
  const [date, setDate] = useState(todayISODate());
  const [selectedHours, setSelectedHours] = useState<number[]>([]);
  const [bookedTimes, setBookedTimes] = useState<Set<number>>(new Set());
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [playerName, setPlayerName] = useState('');
  const [playerPhone, setPlayerPhone] = useState('');
  const [playerEmail, setPlayerEmail] = useState('');
  const [remark, setRemark] = useState('');
  const [status, setStatus] = useState<'confirmed' | 'pending'>('confirmed');

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    fetchHolidays(supabase).then(setHolidays);
  }, []);

  const approvalHoldMs = settings.pending_hold_minutes * 60 * 1000;
  const checkoutHoldMs = settings.checkout_hold_minutes * 60 * 1000;

  const fetchAvailability = useCallback(async () => {
    if (!courtId || isDateClosed(date)) {
      setBookedTimes(new Set());
      return;
    }
    setLoadingSlots(true);

    const dayStart = new Date(`${date}T00:00:00`).toISOString();
    const dayEnd = new Date(`${date}T23:59:59`).toISOString();

    const [bookingsResult, blockedResult, holdsResult] = await Promise.all([
      supabase
        .from('bookings')
        .select('start_time, status, created_at')
        .eq('court_id', courtId)
        .gte('start_time', dayStart)
        .lte('start_time', dayEnd)
        .in('status', ['pending', 'confirmed']),
      supabase
        .from('blocked_slots')
        .select('start_time')
        .eq('court_id', courtId)
        .gte('start_time', dayStart)
        .lte('start_time', dayEnd),
      supabase
        .from('slot_holds')
        .select('start_time, created_at')
        .eq('court_id', courtId)
        .gte('start_time', dayStart)
        .lte('start_time', dayEnd),
    ]);

    const nowTime = Date.now();
    const taken = new Set<number>(
      (
        (bookingsResult.data as { start_time: string; status: string; created_at: string }[]) ?? []
      )
        .filter((row) => {
          if (row.status !== 'pending') return true;
          return nowTime - new Date(row.created_at).getTime() < approvalHoldMs;
        })
        .map((row) => new Date(row.start_time).getTime())
    );
    ((blockedResult.data as { start_time: string }[]) ?? []).forEach((row) =>
      taken.add(new Date(row.start_time).getTime())
    );
    ((holdsResult.data as { start_time: string; created_at: string }[]) ?? [])
      .filter((row) => nowTime - new Date(row.created_at).getTime() < checkoutHoldMs)
      .forEach((row) => taken.add(new Date(row.start_time).getTime()));

    setBookedTimes(taken);
    setLoadingSlots(false);
  }, [courtId, date, isDateClosed, approvalHoldMs, checkoutHoldMs]);

  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability]);

  useEffect(() => {
    setSelectedHours([]);
  }, [courtId, date]);

  function isSlotTaken(hour: number) {
    const slot = timeSlots.find((s) => s.hour === hour);
    if (!slot) return false;
    return bookedTimes.has(new Date(slot.startISO(date)).getTime());
  }

  function toggleHour(hour: number) {
    if (isSlotTaken(hour)) return;
    setSelectedHours((prev) =>
      prev.includes(hour) ? prev.filter((h) => h !== hour) : [...prev, hour].sort((a, b) => a - b)
    );
  }

  const selectedSlots = useMemo(
    () => selectedHours.map((h) => timeSlots.find((s) => s.hour === h)).filter((s) => s !== undefined),
    [selectedHours, timeSlots]
  );
  const totalPrice = selectedSlots.reduce(
    (sum, s) => sum + getSlotPrice(s.hour, settings.pricing_mode, settings.flat_price, priceTiers),
    0
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!courtId || selectedSlots.length === 0) return;

    if (!playerName.trim()) {
      setError("Please enter the customer's name.");
      return;
    }
    if (!playerPhone.trim()) {
      setError("Please enter the customer's phone number.");
      return;
    }
    if (!remark.trim()) {
      setError('Please add a remark for this booking.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Final re-check right before committing — the grid can be stale by
      // the time the admin hits submit, same guarantee the public booking
      // flow relies on.
      const conflict = await hasSlotConflict(supabase, courtId, date, selectedSlots, approvalHoldMs, {
        includeActiveHolds: true,
        checkoutHoldMs,
      });
      if (conflict) {
        setError('One of the selected slots was just taken. Please pick another.');
        await fetchAvailability();
        setSubmitting(false);
        return;
      }

      const { data: transaction, error: transactionError } = await supabase
        .from('transactions')
        .insert({})
        .select('id')
        .single();
      if (transactionError) throw new Error(transactionError.message);

      const { data: insertedBookings, error: insertError } = await supabase
        .from('bookings')
        .insert(
          selectedSlots.map((slot) => ({
            court_id: courtId,
            transaction_id: transaction.id,
            player_name: playerName.trim(),
            player_phone: playerPhone.trim(),
            player_email: playerEmail.trim() || null,
            start_time: slot.startISO(date),
            end_time: slot.endISO(date),
            status,
            receipt_url: null,
            price: getSlotPrice(slot.hour, settings.pricing_mode, settings.flat_price, priceTiers),
            admin_remark: remark.trim(),
          }))
        )
        .select('id');

      if (insertError) throw new Error(insertError.message);

      // Best-effort — reuses the same route the public flow uses, which
      // already sends the admin alert always, and the customer's
      // confirmation email when status is 'confirmed' and that setting is on.
      if (insertedBookings && insertedBookings.length > 0) {
        fetch('/api/bookings/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingIds: insertedBookings.map((b) => b.id) }),
        }).catch((err) => console.error('Failed to trigger booking notification:', err));
      }

      onBooked();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create booking.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Book for Customer</h3>
          {!submitting && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Court</label>
            <select
              value={courtId ?? ''}
              onChange={(e) => setCourtId(e.target.value)}
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
            <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
            <DateCalendar
              selectedDate={date}
              minDate={todayISODate()}
              onSelect={setDate}
              accentColor="var(--admin-btn-bg)"
              isDateDisabled={isDateClosed}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-2">Time Slots</label>
            {isDateClosed(date) ? (
              <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                This date is closed.
              </p>
            ) : loadingSlots ? (
              <p className="text-sm text-slate-400">Checking availability…</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {timeSlots.map((slot) => {
                  const taken = isSlotTaken(slot.hour);
                  const selected = selectedHours.includes(slot.hour);
                  return (
                    <button
                      key={slot.hour}
                      type="button"
                      disabled={taken}
                      onClick={() => toggleHour(slot.hour)}
                      style={
                        selected
                          ? { backgroundColor: 'var(--admin-btn-bg)', borderColor: 'var(--admin-btn-bg)' }
                          : undefined
                      }
                      className={`rounded-xl border px-3 py-3 text-sm font-medium text-center transition-colors ${
                        taken
                          ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed line-through'
                          : selected
                          ? 'text-[var(--admin-btn-label)]'
                          : 'bg-white border-slate-300 text-slate-700 hover:border-emerald-400'
                      }`}
                    >
                      {slot.label}
                      {!taken && settings.show_price && (
                        <span className="block text-xs mt-0.5 opacity-80">
                          {formatPrice(
                            getSlotPrice(slot.hour, settings.pricing_mode, settings.flat_price, priceTiers)
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedSlots.length > 0 && settings.show_price && (
              <p className="text-xs text-slate-500 mt-2">
                {selectedSlots.length} slot{selectedSlots.length === 1 ? '' : 's'} — Total{' '}
                {formatPrice(totalPrice)}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Customer Name</label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              disabled={submitting}
              placeholder="Juan Dela Cruz"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Phone Number</label>
            <input
              type="tel"
              value={playerPhone}
              onChange={(e) => setPlayerPhone(e.target.value)}
              disabled={submitting}
              placeholder="09XX XXX XXXX"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Email <span className="text-slate-400 font-normal">(optional — needed to email the customer)</span>
            </label>
            <input
              type="email"
              value={playerEmail}
              onChange={(e) => setPlayerEmail(e.target.value)}
              disabled={submitting}
              placeholder="juan@example.com"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Status</label>
            <div className="flex gap-2">
              {(['confirmed', 'pending'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  disabled={submitting}
                  style={
                    status === s
                      ? { backgroundColor: 'var(--admin-btn-bg)', borderColor: 'var(--admin-btn-bg)' }
                      : undefined
                  }
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                    status === s
                      ? 'text-[var(--admin-btn-label)]'
                      : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Remark</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="e.g. Phone booking, paid cash on arrival"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50 resize-none"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !courtId || selectedSlots.length === 0}
            className="w-full rounded-xl bg-[var(--admin-btn-bg)] text-[var(--admin-btn-label)] font-medium py-2.5 text-sm hover:brightness-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Booking…' : 'Create Booking'}
          </button>
        </form>
      </div>
    </div>
  );
}
