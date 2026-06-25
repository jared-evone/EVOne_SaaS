import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Minimal typing for the build-time env (no @types/node dependency needed).
declare const process: { env: Record<string, string | undefined> };

// A build identity baked into the bundle. On Vercel this is the git commit SHA of
// the deploy; locally it stays 'dev' (which disables the auto-update watcher).
const APP_VERSION =
  process.env.VITE_APP_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || 'dev';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    port: 5174,
    host: true,
  },
});
