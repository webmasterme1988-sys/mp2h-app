'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import DateCalendar from '@/components/DateCalendar';
import { buildTimeSlots, todayISODate, type TimeSlot } from '@/lib/timeSlots';
import { type SiteSettings } from '@/lib/siteSettings';
import { type PaymentQrCode } from '@/lib/paymentQrCodes';
import { type Holiday } from '@/lib/holidays';
import { compressImage } from '@/lib/compressImage';

// ---------- Types ----------

interface Court {
  id: string;
  name: string;
}

type SubmitState = 'idle' | 'uploading' | 'saving' | 'success' | 'error';

interface BookingPageClientProps {
  initialSettings: SiteSettings;
  initialQrCodes: PaymentQrCode[];
  initialHolidays: Holiday[];
}

// ---------- Component ----------

export default function BookingPageClient({
  initialSettings,
  initialQrCodes,
  initialHolidays,
}: BookingPageClientProps) {
  // Seeded from the server-rendered HTML, so the real branding (color, logo,
  // title) is correct from the very first paint — no default-then-real flash.
  const [settings] = useState<SiteSettings>(initialSettings);
  const [qrCodes] = useState<PaymentQrCode[]>(initialQrCodes);
  const [selectedQrIndex, setSelectedQrIndex] = useState(0);
  const [downloadingQr, setDownloadingQr] = useState(false);
  const [holidays] = useState<Holiday[]>(initialHolidays);
  const [courts, setCourts] = useState<Court[]>([]);
  const [selectedCourtId, setSelectedCourtId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayISODate());
  const [bookedStartTimes, setBookedStartTimes] = useState<Set<number>>(new Set());
  const [blockedStartTimes, setBlockedStartTimes] = useState<Set<number>>(new Set());
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const [playerName, setPlayerName] = useState('');
  const [playerPhone, setPlayerPhone] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [compressingReceipt, setCompressingReceipt] = useState(false);

  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Ticks forward every 30s so today's already-passed slots gray out live,
  // without needing the user to touch the date/court pickers to re-render.
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

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

  // If the default date (today) turns out to be closed, jump to the next
  // open day instead of showing an empty/closed page on first load.
  useEffect(() => {
    if (!isDateClosed(selectedDate)) return;
    let candidate = new Date(`${selectedDate}T00:00:00`);
    for (let i = 0; i < 365; i++) {
      candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
      const iso = candidate.toISOString().split('T')[0];
      if (!isDateClosed(iso)) {
        setSelectedDate(iso);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDateClosed]);

  // ---------- Load courts ----------

  useEffect(() => {
    async function loadCourts() {
      const { data, error } = await supabase.from('courts').select('id, name').order('id');
      if (error) {
        console.error('Failed to load courts:', error);
        return;
      }
      if (data && data.length > 0) {
        setCourts(data as Court[]);
        setSelectedCourtId((data[0] as Court).id);
      }
    }
    loadCourts();
  }, []);

  // ---------- Load booked slots for selected court/date ----------

  const fetchBookedSlots = useCallback(async () => {
    if (!selectedCourtId || !selectedDate || isDateClosed(selectedDate)) return;

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

    // Blocked slots are a secondary concern — if that table isn't set up
    // yet (or the query fails for any reason), fall back to "nothing
    // blocked" instead of breaking the whole booking page.
    if (blockedResult.error) {
      console.error('Failed to load blocked slots:', blockedResult.error);
    }

    // A 'pending' booking only holds the slot for pending_hold_minutes from
    // when it was submitted — past that, if the admin hasn't approved it,
    // the slot opens back up. 'confirmed' bookings always hold the slot.
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
  }, [selectedCourtId, selectedDate, isDateClosed, settings.pending_hold_minutes]);

  useEffect(() => {
    fetchBookedSlots();
    // Re-runs on every `now` tick too (every 30s) so a slot whose pending
    // hold just expired frees up live, without the customer having to
    // touch the court/date pickers to trigger a re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchBookedSlots, now]);

  // ---------- Slot click ----------

  function isSlotBooked(slot: TimeSlot) {
    const t = new Date(slot.startISO(selectedDate)).getTime();
    return bookedStartTimes.has(t);
  }

  function isSlotBlocked(slot: TimeSlot) {
    const t = new Date(slot.startISO(selectedDate)).getTime();
    return blockedStartTimes.has(t);
  }

  function isSlotPast(slot: TimeSlot) {
    return new Date(slot.startISO(selectedDate)).getTime() <= now;
  }

  function handleSlotClick(slot: TimeSlot) {
    if (isSlotBooked(slot) || isSlotBlocked(slot) || isSlotPast(slot)) return;
    setSelectedSlot(slot);
    setPlayerName('');
    setPlayerPhone('');
    setReceiptFile(null);
    setReceiptPreview(null);
    setSubmitState('idle');
    setSubmitError(null);
    setSelectedQrIndex(0);
    setModalOpen(true);
  }

  function closeModal() {
    if (submitState === 'uploading' || submitState === 'saving') return;
    setModalOpen(false);
    setSelectedSlot(null);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;

    if (!file) {
      setReceiptFile(null);
      setReceiptPreview(null);
      return;
    }

    setCompressingReceipt(true);
    const compressed = await compressImage(file);
    setCompressingReceipt(false);

    setReceiptFile(compressed);
    setReceiptPreview(URL.createObjectURL(compressed));
  }

  // ---------- Download QR ----------
  // Lets someone paying from the same phone save the QR to their photo
  // gallery, so their e-wallet app's "scan from gallery" option can read it
  // — scanning a QR with the camera while it's displayed on that same
  // phone's screen usually isn't possible.

  async function handleDownloadQr(url: string, label: string) {
    setDownloadingQr(true);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const ext = blob.type.split('/')[1] || 'png';

      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-qr.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      // Cross-origin fetch can fail (CORS, offline, etc) — fall back to
      // just opening the image so the user can long-press-save it manually.
      console.error('QR download failed, opening image instead:', err);
      window.open(url, '_blank');
    } finally {
      setDownloadingQr(false);
    }
  }

  // ---------- Submit booking ----------

  async function handleSubmitBooking() {
    if (!selectedSlot || !selectedCourtId) return;

    if (!playerName.trim()) {
      setSubmitError('Please enter your name.');
      return;
    }
    if (!playerPhone.trim()) {
      setSubmitError('Please enter your phone number.');
      return;
    }
    if (!receiptFile) {
      setSubmitError('Please upload your GCash payment receipt.');
      return;
    }

    setSubmitError(null);

    try {
      // 1. Upload receipt to Supabase Storage
      setSubmitState('uploading');

      const fileExt = receiptFile.name.split('.').pop() || 'jpg';
      const safeName = playerName.trim().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      const filePath = `${selectedDate}/court-${selectedCourtId}-${selectedSlot.hour}h-${safeName}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(filePath, receiptFile, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Receipt upload failed: ${uploadError.message}`);
      }

      const { data: publicUrlData } = supabase.storage.from('receipts').getPublicUrl(filePath);
      const receiptUrl = publicUrlData.publicUrl;

      // 2. Insert booking row
      setSubmitState('saving');

      const { data: insertedBooking, error: insertError } = await supabase
        .from('bookings')
        .insert({
          court_id: selectedCourtId,
          player_name: playerName.trim(),
          player_phone: playerPhone.trim(),
          start_time: selectedSlot.startISO(selectedDate),
          end_time: selectedSlot.endISO(selectedDate),
          status: 'pending',
          receipt_url: receiptUrl,
        })
        .select('id')
        .single();

      if (insertError) {
        throw new Error(`Booking could not be saved: ${insertError.message}`);
      }

      setSubmitState('success');
      await fetchBookedSlots();

      // Best-effort admin email alert — the booking itself already
      // succeeded, so a notification failure shouldn't surface as an error
      // to the customer.
      if (insertedBooking) {
        fetch('/api/bookings/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: insertedBooking.id }),
        }).catch((err) => console.error('Failed to trigger booking notification:', err));
      }

      // Auto-close after a short confirmation pause
      setTimeout(() => {
        setModalOpen(false);
        setSelectedSlot(null);
        setSubmitState('idle');
      }, 1800);
    } catch (err) {
      console.error(err);
      setSubmitState('error');
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  }

  // ---------- Render ----------

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header style={{ backgroundColor: settings.primary_color }} className="text-white">
        <div className="max-w-3xl mx-auto px-4 py-6 text-center relative">
          <a
            href="/my-bookings"
            className="absolute right-4 top-6 text-sm text-white/80 hover:text-white underline underline-offset-2"
          >
            My Bookings
          </a>
          {settings.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.logo_url}
              alt={settings.site_title}
              className="h-12 w-auto mx-auto mb-2 object-contain"
            />
          )}
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{settings.site_title}</h1>
          <p className="mt-1 text-white/80 text-sm sm:text-base">{settings.site_subtitle}</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Court + Date selectors */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">1. Choose court &amp; date</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                      style={
                        isSelected
                          ? { backgroundColor: settings.primary_color, borderColor: settings.primary_color }
                          : undefined
                      }
                      className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                        isSelected
                          ? 'text-white'
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
                accentColor={settings.primary_color}
                isDateDisabled={isDateClosed}
              />
            </div>
          </div>
        </section>

        {/* Time slots */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">2. Pick an available time</h2>

          {slotsError && (
            <p className="text-sm text-red-600 mb-3">{slotsError}</p>
          )}

          {isDateClosed(selectedDate) ? (
            <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              We&apos;re closed on this day. Please pick another date.
            </p>
          ) : loadingSlots ? (
            <p className="text-sm text-slate-400">Checking availability…</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {timeSlots.map((slot) => {
                const booked = isSlotBooked(slot);
                const blocked = isSlotBlocked(slot);
                const past = !booked && !blocked && isSlotPast(slot);
                return (
                  <button
                    key={slot.hour}
                    disabled={booked || blocked || past}
                    onClick={() => handleSlotClick(slot)}
                    className={`rounded-xl border px-3 py-3 text-sm font-medium text-center transition-colors ${
                      booked
                        ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed line-through'
                        : blocked || past
                        ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-emerald-50 hover:border-emerald-400 active:scale-[0.98]'
                    }`}
                  >
                    {blocked ? 'Unavailable' : past ? 'Past' : slot.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-white border border-slate-300 inline-block" />
              Available
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-slate-100 border border-slate-200 inline-block" />
              Booked
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-slate-50 border border-slate-200 inline-block" />
              Unavailable
            </span>
          </div>
        </section>
      </main>

      {/* Booking Modal */}
      {modalOpen && selectedSlot && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800">Confirm your booking</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {courts.find((c) => c.id === selectedCourtId)?.name} · {selectedDate} · {selectedSlot.label}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {submitState === 'success' ? (
                <div className="text-center py-8">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3 text-2xl">
                    ✓
                  </div>
                  <p className="font-medium text-slate-800">Booking submitted!</p>
                  <p className="text-sm text-slate-500 mt-1">
                    Your slot is pending confirmation. We&apos;ll verify your payment shortly.
                  </p>
                </div>
              ) : (
                <>
                  {/* Name / Phone */}
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Full Name</label>
                    <input
                      type="text"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      placeholder="Juan Dela Cruz"
                      className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Phone Number</label>
                    <input
                      type="tel"
                      value={playerPhone}
                      onChange={(e) => setPlayerPhone(e.target.value)}
                      placeholder="09XX XXX XXXX"
                      className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  {/* Payment QR */}
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-center">
                    <p className="text-sm font-medium text-slate-700 mb-2">
                      {qrCodes.length > 0 ? `Pay via ${qrCodes[selectedQrIndex]?.label}` : 'Pay via GCash'}
                    </p>

                    {qrCodes.length > 1 && (
                      <div className="flex flex-wrap justify-center gap-2 mb-3">
                        {qrCodes.map((qr, i) => {
                          const isSelected = i === selectedQrIndex;
                          return (
                            <button
                              key={qr.id}
                              type="button"
                              onClick={() => setSelectedQrIndex(i)}
                              style={
                                isSelected
                                  ? { backgroundColor: settings.primary_color, borderColor: settings.primary_color }
                                  : undefined
                              }
                              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                isSelected
                                  ? 'text-white'
                                  : 'bg-white border-slate-300 text-slate-600 hover:border-emerald-400'
                              }`}
                            >
                              {qr.label}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <img
                      src={qrCodes[selectedQrIndex]?.image_url ?? '/gcash-qr.png'}
                      alt={qrCodes[selectedQrIndex]?.label ?? 'Payment QR Code'}
                      className="mx-auto w-40 h-40 object-contain rounded-lg border border-slate-200 bg-white"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadQr(
                          qrCodes[selectedQrIndex]?.image_url ?? '/gcash-qr.png',
                          qrCodes[selectedQrIndex]?.label ?? 'payment'
                        )
                      }
                      disabled={downloadingQr}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-800 font-medium underline underline-offset-2 disabled:opacity-60"
                    >
                      {downloadingQr ? 'Downloading…' : 'Download QR'}
                    </button>

                    <p className="text-xs text-slate-500 mt-2">
                      Scan to pay, then upload your receipt screenshot below.
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Paying from this phone? Download the QR, then use your e-wallet app&apos;s
                      &quot;scan from gallery&quot; option — or press and hold the image above to
                      save it directly.
                    </p>

                    {settings.payment_note && (
                      <p className="text-xs text-slate-600 mt-2 font-medium">
                        {settings.payment_note}
                      </p>
                    )}
                  </div>

                  {/* Receipt upload */}
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">
                      Upload Payment Receipt
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      disabled={compressingReceipt}
                      className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-emerald-100 disabled:opacity-60"
                    />
                    {compressingReceipt && (
                      <p className="text-xs text-slate-400 mt-1">Optimizing image…</p>
                    )}
                    {receiptPreview && (
                      <img
                        src={receiptPreview}
                        alt="Receipt preview"
                        className="mt-3 max-h-48 rounded-lg border border-slate-200 mx-auto"
                      />
                    )}
                  </div>

                  {submitError && <p className="text-sm text-red-600">{submitError}</p>}

                  <button
                    onClick={handleSubmitBooking}
                    disabled={submitState === 'uploading' || submitState === 'saving' || compressingReceipt}
                    style={{ backgroundColor: settings.primary_color }}
                    className="w-full rounded-xl text-white font-medium py-3 text-sm hover:brightness-90 disabled:opacity-60 disabled:cursor-not-allowed transition-[filter]"
                  >
                    {submitState === 'uploading'
                      ? 'Uploading receipt…'
                      : submitState === 'saving'
                      ? 'Saving booking…'
                      : settings.submit_button_label}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
