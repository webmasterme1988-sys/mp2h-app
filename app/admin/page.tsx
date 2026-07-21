'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import BookingsTab from './_components/BookingsTab';
import CourtsTab from './_components/CourtsTab';
import BlockSlotsTab from './_components/BlockSlotsTab';
import HoursTab from './_components/HoursTab';
import PricingTab from './_components/PricingTab';
import BrandingTab from './_components/BrandingTab';
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
  | 'branding'
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
  { id: 'branding', label: 'Branding & Settings' },
  { id: 'blacklist', label: 'Blacklist' },
  { id: 'reports', label: 'Reports' },
  { id: 'admins', label: 'Admins', superAdminOnly: true },
  { id: 'danger', label: 'Danger Zone', superAdminOnly: true },
];

// Synthesized rather than an audio file — a short two-note chime via the
// Web Audio API, so there's no asset to bundle or license.
function playNotificationSound() {
  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass();
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

    setTimeout(() => ctx.close(), 1000);
  } catch (err) {
    console.error('Could not play notification sound:', err);
  }
}

export default function AdminPage() {
  const router = useRouter();

  const [authChecking, setAuthChecking] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('bookings');
  const activeTabRef = useRef<TabId>('bookings');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [newBookingsCount, setNewBookingsCount] = useState(0);

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

    const channel = supabase
      .channel('admin-new-bookings')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bookings' },
        (payload) => {
          const row = payload.new as { player_name?: string };
          const toastId = `${Date.now()}-${Math.random()}`;
          // Stays until the admin dismisses it — no auto-hide timeout.
          setToasts((prev) => [
            ...prev,
            { id: toastId, message: `New booking from ${row.player_name ?? 'a customer'}` },
          ]);
          playNotificationSound();

          // Already looking at the Bookings tab (which live-refetches on
          // its own) — no need to also badge it as unseen.
          if (activeTabRef.current !== 'bookings') {
            setNewBookingsCount((c) => c + 1);
          }
        }
      )
      .subscribe();

    return () => {
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

  return (
    <div className="min-h-screen bg-slate-50">
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

      <header className="bg-emerald-700 text-white">
        <div className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">MP2H Admin</h1>
            <p className="mt-1 text-emerald-100 text-sm sm:text-base">Manage court bookings.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setChangePasswordOpen(true)}
              className="rounded-xl border border-emerald-500 bg-emerald-800/40 px-4 py-2 text-sm font-medium hover:bg-emerald-800/70 transition-colors"
            >
              Change Password
            </button>
            <button
              onClick={handleSignOut}
              className="rounded-xl border border-emerald-500 bg-emerald-800/40 px-4 py-2 text-sm font-medium hover:bg-emerald-800/70 transition-colors"
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
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (tab.id === 'bookings') setNewBookingsCount(0);
                  }}
                  className={`text-left whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition-colors flex items-center gap-2 ${
                    isActive
                      ? tab.id === 'danger'
                        ? 'bg-red-600 text-white'
                        : 'bg-emerald-600 text-white'
                      : tab.id === 'danger'
                      ? 'text-red-700 hover:bg-red-50'
                      : 'text-slate-600 hover:bg-slate-100'
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
            {activeTab === 'branding' && <BrandingTab />}
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
