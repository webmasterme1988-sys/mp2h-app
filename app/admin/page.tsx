'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchSiteSettings, DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/siteSettings';
import BookingsTab from './_components/BookingsTab';
import CourtsTab from './_components/CourtsTab';
import BlockSlotsTab from './_components/BlockSlotsTab';
import HoursTab from './_components/HoursTab';
import PricingTab from './_components/PricingTab';
import AddonsTab from './_components/AddonsTab';
import BrandingTab from './_components/BrandingTab';
import LandingPageTab from './_components/LandingPageTab';
import BlacklistTab from './_components/BlacklistTab';
import ReportsTab from './_components/ReportsTab';
import AdminsTab from './_components/AdminsTab';
import DangerZoneTab from './_components/DangerZoneTab';
import ChangePasswordModal from './_components/ChangePasswordModal';

type TabId =
  | 'bookings'
  | 'courts'
  | 'blocks'
  | 'hours'
  | 'pricing'
  | 'addons'
  | 'branding'
  | 'landing'
  | 'blacklist'
  | 'reports'
  | 'admins'
  | 'danger';

const TABS: { id: TabId; label: string; superAdminOnly?: boolean }[] = [
  { id: 'bookings', label: 'Bookings' },
  { id: 'courts', label: 'Courts' },
  { id: 'blocks', label: 'Block Time Slots' },
  { id: 'hours', label: 'Hours & Holidays' },
  { id: 'pricing', label: 'Booking & Pricing' },
  { id: 'addons', label: 'Add-ons' },
  { id: 'branding', label: 'Branding & Settings' },
  { id: 'landing', label: 'Landing Page' },
  { id: 'blacklist', label: 'Blacklist' },
  { id: 'reports', label: 'Reports' },
  { id: 'admins', label: 'Admins', superAdminOnly: true },
  { id: 'danger', label: 'Danger Zone', superAdminOnly: true },
];

// Anchored to Philippine time regardless of the admin's own device
// timezone, matching the rest of the dashboard's time-of-day logic.
function getGreeting() {
  const hour = Number(
    new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' })
  );
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// Its own component (rather than a `now` state on AdminPage itself) so the
// tick only re-renders this small clock, not the whole dashboard tree —
// the admin freeze bug fixed earlier this session came from exactly that
// kind of top-level re-render on every tick.
function AdminClock() {
  // Seeded null (not new Date()) so the first render is identical on the
  // server and during client hydration — this is a server-rendered Client
  // Component, and `new Date()` evaluated at SSR time vs. at hydration
  // time are two different instants, which would render two different
  // formatted strings and trigger a hydration mismatch. The real value is
  // only ever set from inside the effect below, which runs client-side
  // after hydration completes.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  if (!now) return null;

  const formatted = now.toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return <p className="mt-0.5 text-white/70 text-xs sm:text-sm">{formatted}</p>;
}

// Synthesized rather than an audio file — a short two-note chime via the
// Web Audio API, so there's no asset to bundle or license.
//
// One shared, lazily-created context reused for every notification rather
// than a fresh `new AudioContext()` per call — a multi-slot booking fires
// several realtime events in a burst, and browsers cap how many contexts
// can exist concurrently (Chrome: ~6), so creating one per event could
// start throwing partway through a burst.
let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioContext) {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioContext = new AudioContextClass();
  }
  return sharedAudioContext;
}

function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const startTime = ctx.currentTime;

    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const noteStart = startTime + i * 0.12;

      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(0.3, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(noteStart);
      osc.stop(noteStart + 0.3);
    });
  } catch (err) {
    console.error('Could not play notification sound:', err);
  }
}

export default function AdminPage() {
  const router = useRouter();

  const [authChecking, setAuthChecking] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('bookings');
  const activeTabRef = useRef<TabId>('bookings');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [newBookingsCount, setNewBookingsCount] = useState(0);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);

  useEffect(() => {
    fetchSiteSettings(supabase).then(setSettings);
  }, []);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // ---------- Auth guard ----------
  // Belt-and-suspenders: proxy.ts already blocks unauthenticated requests to
  // this route, but a cached page or an expired session in an open tab
  // wouldn't be caught by proxy alone, so re-verify on the client too.

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active) return;
      if (!user) {
        router.replace('/admin/login');
        return;
      }
      setIsSuperAdmin(user.app_metadata?.role === 'super_admin');
      setAdminEmail(user.email ?? null);
      setAuthChecking(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace('/admin/login');
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/admin/login');
    router.refresh();
  }

  // ---------- New-booking notifications ----------
  // Lives here (not inside BookingsTab) so the badge and toast keep working
  // no matter which tab the admin currently has open.
  //
  // This used to badge the count of status='pending' bookings, but that's
  // always zero once "auto-confirm bookings" is turned on (new bookings go
  // straight to 'confirmed', skipping 'pending' entirely) — which made the
  // badge look broken even though bookings were coming in fine. It now
  // counts new bookings since the admin last had this tab open instead, so
  // it works the same regardless of that setting.

  const [toasts, setToasts] = useState<{ id: string; message: string }[]>([]);

  useEffect(() => {
    if (authChecking) return;

    // A single multi-slot booking inserts one row per hour, each firing
    // its own INSERT event — batch a burst into one toast/sound/badge
    // update instead of one of each per row.
    let pendingRows: { player_name?: string }[] = [];
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function flush() {
      const rows = pendingRows;
      pendingRows = [];
      debounceTimer = null;
      if (rows.length === 0) return;

      const uniqueNames = Array.from(
        new Set(rows.map((r) => r.player_name).filter((n): n is string => !!n))
      );
      const message =
        rows.length === 1
          ? `New booking from ${rows[0].player_name ?? 'a customer'}`
          : uniqueNames.length === 1
          ? `${rows.length} new bookings from ${uniqueNames[0]}`
          : `${rows.length} new bookings`;

      const toastId = `${Date.now()}-${Math.random()}`;
      // Stays until the admin dismisses it — no auto-hide timeout.
      setToasts((prev) => [...prev, { id: toastId, message }]);
      playNotificationSound();

      // Already looking at the Bookings tab (which live-refetches on
      // its own) — no need to also badge it as unseen.
      if (activeTabRef.current !== 'bookings') {
        setNewBookingsCount((c) => c + rows.length);
      }
    }

    const channel = supabase
      .channel('admin-new-bookings')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bookings' },
        (payload) => {
          pendingRows.push(payload.new as { player_name?: string });
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(flush, 800);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [authChecking]);

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-400">Checking session…</p>
      </div>
    );
  }

  const visibleTabs = TABS.filter((tab) => !tab.superAdminOnly || isSuperAdmin);

  // CSS variables rather than passing colors down as props — every admin
  // tab's "primary action" buttons (Save, Add, Approve, etc.) reference
  // these via Tailwind's arbitrary-value syntax (bg-[var(--admin-btn-bg)]),
  // so the whole dashboard picks up the setting without each component
  // needing to fetch site_settings itself.
  const adminThemeVars = {
    '--admin-btn-bg': settings.button_bg_color,
    '--admin-btn-label': settings.button_label_color,
  } as React.CSSProperties;

  return (
    <div className="min-h-screen bg-slate-50" style={adminThemeVars}>
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[60] space-y-2 w-72">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="rounded-xl bg-slate-800 text-white text-sm px-4 py-3 shadow-lg flex items-start justify-between gap-2"
            >
              <span>{toast.message}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="text-white/60 hover:text-white leading-none shrink-0"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <header style={{ backgroundColor: settings.primary_color }} className="text-white">
        <div className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">MP2H Admin</h1>
            <p className="mt-1 text-white/80 text-sm sm:text-base">
              {getGreeting()}
              {adminEmail ? `, ${adminEmail}` : ''}!
            </p>
            <AdminClock />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setChangePasswordOpen(true)}
              className="rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 transition-colors"
            >
              Change Password
            </button>
            <button
              onClick={handleSignOut}
              className="rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row gap-6 items-start">
          {/* Vertical, left-aligned tab nav */}
          <nav className="w-full sm:w-56 shrink-0 flex sm:flex-col gap-1 overflow-x-auto sm:overflow-visible">
            {visibleTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const isDanger = tab.id === 'danger';
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (tab.id === 'bookings') setNewBookingsCount(0);
                  }}
                  style={
                    isDanger
                      ? undefined
                      : isActive
                      ? { backgroundColor: settings.admin_tab_active_bg_color, color: '#ffffff' }
                      : { color: settings.admin_tab_font_color }
                  }
                  className={`text-left whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition-colors flex items-center gap-2 ${
                    isDanger
                      ? isActive
                        ? 'bg-red-600 text-white'
                        : 'text-red-700 hover:bg-red-50'
                      : isActive
                      ? ''
                      : 'hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                  {tab.id === 'bookings' && newBookingsCount > 0 && (
                    <span
                      className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full px-1.5 text-xs font-semibold ${
                        isActive ? 'bg-white/25 text-white' : 'bg-red-500 text-white'
                      }`}
                    >
                      {newBookingsCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Active tab content */}
          <div className="flex-1 min-w-0 w-full space-y-6">
            {activeTab === 'bookings' && <BookingsTab />}
            {activeTab === 'courts' && <CourtsTab />}
            {activeTab === 'blocks' && <BlockSlotsTab />}
            {activeTab === 'hours' && <HoursTab />}
            {activeTab === 'pricing' && <PricingTab />}
            {activeTab === 'addons' && <AddonsTab />}
            {activeTab === 'branding' && <BrandingTab />}
            {activeTab === 'landing' && <LandingPageTab />}
            {activeTab === 'blacklist' && <BlacklistTab />}
            {activeTab === 'reports' && <ReportsTab />}
            {activeTab === 'admins' && isSuperAdmin && <AdminsTab />}
            {activeTab === 'danger' && isSuperAdmin && <DangerZoneTab />}
          </div>
        </div>
      </main>

      {changePasswordOpen && (
        <ChangePasswordModal onClose={() => setChangePasswordOpen(false)} />
      )}
    </div>
  );
}
