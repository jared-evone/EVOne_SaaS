// Writes dist/version.json after the build. Must use the SAME id Vite baked into
// the bundle (see vite.config.ts) so an up-to-date client matches and an outdated
// one (left open from a previous deploy) detects the change.
import { writeFileSync, mkdirSync } from 'node:fs';

const version =
  process.env.VITE_APP_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || 'dev';

mkdirSync('dist', { recursive: true });
writeFileSync('dist/version.json', JSON.stringify({ version }));
console.log(`[gen-version] dist/version.json -> ${version}`);
