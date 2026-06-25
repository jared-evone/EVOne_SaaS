/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Build identity injected by Vite's `define` (commit SHA on Vercel, 'dev' locally).
declare const __APP_VERSION__: string;
