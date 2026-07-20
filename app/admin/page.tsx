'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import BookingsTab from './_components/BookingsTab';
import CourtsTab from './_components/CourtsTab';
import BlockSlotsTab from './_components/BlockSlotsTab';
import HoursTab from './_components/HoursTab';
import BrandingTab from './_components/BrandingTab';
import AdminsTab from './_components/AdminsTab';
import DangerZoneTab from './_components/DangerZoneTab';
import ChangePasswordModal from './_components/ChangePasswordModal';

type TabId = 'bookings' | 'courts' | 'blocks' | 'hours' | 'branding' | 'admins' | 'danger';

const TABS: { id: TabId; label: string; superAdminOnly?: boolean }[] = [
  { id: 'bookings', label: 'Bookings' },
  { id: 'courts', label: 'Courts' },
  { id: 'blocks', label: 'Block Time Slots' },
  { id: 'hours', label: 'Hours & Holidays' },
  { id: 'branding', label: 'Branding & Settings' },
  { id: 'admins', label: 'Admins', superAdminOnly: true },
  { id: 'danger', label: 'Danger Zone', superAdminOnly: true },
];

export default function AdminPage() {
  const router = useRouter();

  const [authChecking, setAuthChecking] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('bookings');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

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
                  onClick={() => setActiveTab(tab.id)}
                  className={`text-left whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
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
            {activeTab === 'branding' && <BrandingTab />}
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
