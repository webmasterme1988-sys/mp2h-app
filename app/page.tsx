'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import DateCalendar from '@/components/DateCalendar';
import { TIME_SLOTS, todayISODate, type TimeSlot } from '@/lib/timeSlots';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';

// ---------- Types ----------

interface Court {
  id: string;
  name: string;
}

type SubmitState = 'idle' | 'uploading' | 'saving' | 'success' | 'error';

// ---------- Component ----------

export default function Home() {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
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

  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ---------- Load site branding ----------

  useEffect(() => {
    fetchSiteSettings(supabase).then(setSettings);
  }, []);

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
    if (!selectedCourtId || !selectedDate) return;

    setLoadingSlots(true);
    setSlotsError(null);

    const dayStart = new Date(`${selectedDate}T00:00:00`).toISOString();
    const dayEnd = new Date(`${selectedDate}T23:59:59`).toISOString();

    const [bookingsResult, blockedResult] = await Promise.all([
      supabase
        .from('bookings')
        .select('start_time')
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

    const bookedSet = new Set<number>(
      (bookingsResult.data ?? []).map((row: { start_time: string }) =>
        new Date(row.start_time).getTime()
      )
    );
    const blockedSet = new Set<number>(
      (blockedResult.data ?? []).map((row: { start_time: string }) =>
        new Date(row.start_time).getTime()
      )
    );
    setBookedStartTimes(bookedSet);
    setBlockedStartTimes(blockedSet);
    setLoadingSlots(false);
  }, [selectedCourtId, selectedDate]);

  useEffect(() => {
    fetchBookedSlots();
  }, [fetchBookedSlots]);

  // ---------- Slot click ----------

  function isSlotBooked(slot: TimeSlot) {
    const t = new Date(slot.startISO(selectedDate)).getTime();
    return bookedStartTimes.has(t);
  }

  function isSlotBlocked(slot: TimeSlot) {
    const t = new Date(slot.startISO(selectedDate)).getTime();
    return blockedStartTimes.has(t);
  }

  function handleSlotClick(slot: TimeSlot) {
    if (isSlotBooked(slot) || isSlotBlocked(slot)) return;
    setSelectedSlot(slot);
    setPlayerName('');
    setPlayerPhone('');
    setReceiptFile(null);
    setReceiptPreview(null);
    setSubmitState('idle');
    setSubmitError(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (submitState === 'uploading' || submitState === 'saving') return;
    setModalOpen(false);
    setSelectedSlot(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setReceiptFile(file);
    if (file) {
      setReceiptPreview(URL.createObjectURL(file));
    } else {
      setReceiptPreview(null);
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

      const { error: insertError } = await supabase.from('bookings').insert({
        court_id: selectedCourtId,
        player_name: playerName.trim(),
        player_phone: playerPhone.trim(),
        start_time: selectedSlot.startISO(selectedDate),
        end_time: selectedSlot.endISO(selectedDate),
        status: 'pending',
        receipt_url: receiptUrl,
      });

      if (insertError) {
        throw new Error(`Booking could not be saved: ${insertError.message}`);
      }

      setSubmitState('success');
      await fetchBookedSlots();

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

          {loadingSlots ? (
            <p className="text-sm text-slate-400">Checking availability…</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {TIME_SLOTS.map((slot) => {
                const booked = isSlotBooked(slot);
                const blocked = isSlotBlocked(slot);
                return (
                  <button
                    key={slot.hour}
                    disabled={booked || blocked}
                    onClick={() => handleSlotClick(slot)}
                    className={`rounded-xl border px-3 py-3 text-sm font-medium text-center transition-colors ${
                      booked
                        ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed line-through'
                        : blocked
                        ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-emerald-50 hover:border-emerald-400 active:scale-[0.98]'
                    }`}
                  >
                    {blocked ? 'Unavailable' : slot.label}
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

                  {/* GCash QR */}
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-center">
                    <p className="text-sm font-medium text-slate-700 mb-2">Pay via GCash</p>
                    <img
                      src={settings.gcash_qr_url ?? '/gcash-qr.png'}
                      alt="GCash QR Code"
                      className="mx-auto w-40 h-40 object-contain rounded-lg border border-slate-200 bg-white"
                    />
                    <p className="text-xs text-slate-500 mt-2">
                      Scan to pay, then upload your receipt screenshot below.
                    </p>
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
                      className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-emerald-100"
                    />
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
                    disabled={submitState === 'uploading' || submitState === 'saving'}
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
