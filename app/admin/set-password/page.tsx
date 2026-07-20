'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type SessionState = 'checking' | 'ready' | 'invalid';

export default function SetPasswordPage() {
  const router = useRouter();

  const [sessionState, setSessionState] = useState<SessionState>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The invite link's tokens live in the URL fragment (#access_token=...).
  // @supabase/ssr's browser client hardcodes flowType: 'pkce' with no way to
  // opt out, but admin-issued invite links can never be PKCE (the browser
  // accepting the invite isn't the one that sent it, so there's no shared
  // code verifier) — Supabase's own docs say so. The client's automatic
  // detectSessionInUrl handling chokes on that mismatch and silently drops
  // the session. So we parse the hash ourselves and call setSession()
  // directly, which doesn't care about flow type.
  useEffect(() => {
    async function establishSession() {
      const hash = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (accessToken && refreshToken) {
        const { data } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        // Drop the tokens from the visible URL now that they're consumed.
        window.history.replaceState(null, '', window.location.pathname);
        setSessionState(data.session ? 'ready' : 'invalid');
        return;
      }

      // No tokens in the URL (e.g. a page refresh) — fall back to whatever
      // session cookie may already exist.
      const { data: { user } } = await supabase.auth.getUser();
      setSessionState(user ? 'ready' : 'invalid');
    }

    establishSession();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }

    router.push('/admin');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h1 className="text-xl font-bold text-slate-800 mb-1">Set your password</h1>

        {sessionState === 'checking' && (
          <p className="text-sm text-slate-400 mt-4">Verifying invite link…</p>
        )}

        {sessionState === 'invalid' && (
          <>
            <p className="text-sm text-slate-500 mt-4">
              This invite link is invalid or has expired. Ask an existing admin to send you a new
              one.
            </p>
            <a
              href="/admin/login"
              className="mt-4 inline-block text-sm text-emerald-700 hover:text-emerald-800 font-medium underline underline-offset-2"
            >
              Back to login
            </a>
          </>
        )}

        {sessionState === 'ready' && (
          <>
            <p className="text-sm text-slate-500 mb-6">Choose a password to finish setting up your admin account.</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-xl bg-emerald-600 text-white font-medium py-2.5 text-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Saving…' : 'Set Password & Continue'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
