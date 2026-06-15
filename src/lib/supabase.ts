import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.',
  );
}

// ── Custom-token auth ─────────────────────────────────────────────
// Sign-in is via the `app_login` RPC, which returns a JWT signed (HS256) with the
// project's JWT secret and a `role: authenticated` claim. We attach that token to
// every request so the database can tell a logged-in user from the bare anon key.
// Until a token is set (or after it expires) requests fall back to the anon key.
const TOKEN_KEY = 'evone_app_token';

let appToken: string | null = (() => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
})();

function tokenValid(t: string | null): t is string {
  if (!t) return false;
  try {
    const part = t.split('.')[1];
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function setAppToken(t: string | null) {
  appToken = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

export function hasValidAppToken(): boolean {
  return tokenValid(appToken);
}

export const supabase = createClient(url, anonKey, {
  // Return the logged-in user's token; fall back to the anon key when not logged in
  // or when the token has expired.
  accessToken: async () => (tokenValid(appToken) ? (appToken as string) : anonKey),
});
