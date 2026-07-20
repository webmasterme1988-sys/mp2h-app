'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Mode = 'login' | 'forgot';

export default function AdminLoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [resetSent, setResetSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError('Invalid email or password.');
      setLoading(false);
      return;
    }

    router.push('/admin');
    router.refresh();
  }

  function openForgotPassword() {
    setMode('forgot');
    setError(null);
    setResetSent(false);
  }

  function backToLogin() {
    setMode('login');
    setError(null);
    setPassword('');
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/admin/set-password`,
    });

    setLoading(false);

    // Supabase intentionally doesn't reveal whether the email is actually
    // registered (prevents attackers from probing for valid admin
    // accounts), so we always show the same message regardless of `error`.
    if (error) {
      console.error('resetPasswordForEmail error:', error);
    }
    setResetSent(true);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h1 className="text-xl font-bold text-slate-800 mb-1">MP2H Admin</h1>

        {mode === 'login' ? (
          <>
            <p className="text-sm text-slate-500 mb-6">Sign in to manage bookings.</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-slate-600">Password</label>
                  <button
                    type="button"
                    onClick={openForgotPassword}
                    className="text-xs text-emerald-700 hover:text-emerald-800 underline underline-offset-2"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-emerald-600 text-white font-medium py-2.5 text-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-500 mb-6">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>

            {resetSent ? (
              <div className="text-center py-2">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3 text-xl">
                  ✓
                </div>
                <p className="text-sm text-slate-700 font-medium">Check your email.</p>
                <p className="text-xs text-slate-500 mt-1">
                  If an account exists for {email}, a reset link is on its way.
                </p>
                <button
                  onClick={backToLogin}
                  className="mt-4 w-full rounded-xl bg-slate-100 text-slate-700 font-medium py-2.5 text-sm hover:bg-slate-200 transition-colors"
                >
                  Back to login
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-emerald-600 text-white font-medium py-2.5 text-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Sending…' : 'Send Reset Link'}
                </button>

                <button
                  type="button"
                  onClick={backToLogin}
                  className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
                >
                  Back to login
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
