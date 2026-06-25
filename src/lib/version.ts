// Auto-update watcher.
//
// Each deploy bakes a build id (the git commit SHA) into the bundle as
// `__APP_VERSION__` AND publishes the same id at /version.json. A client that has
// been left open polls /version.json; when the published id no longer matches the
// id it was built with, it knows a newer version has been deployed and triggers
// the `onStale` callback (which forces a re-login + reload — see App.tsx).
//
// Locally (`__APP_VERSION__ === 'dev'`) the watcher is a no-op.

export const APP_VERSION: string = __APP_VERSION__;

const POLL_MS = 60_000;
let started = false;

export function startVersionWatch(onStale: () => void): void {
  if (started || APP_VERSION === 'dev') return;
  started = true;
  let fired = false;

  const check = async () => {
    if (fired) return;
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: string };
      if (data.version && data.version !== APP_VERSION) {
        fired = true;
        onStale();
      }
    } catch {
      // Offline, or version.json not deployed — ignore and try again later.
    }
  };

  void check();
  window.setInterval(() => void check(), POLL_MS);
  // Also re-check the moment the user returns to the tab.
  window.addEventListener('focus', () => void check());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
}
