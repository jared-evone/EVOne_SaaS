// Lightweight credential helpers using Web Crypto. Used only for the dev-stage
// customer portal — when this moves to production it should be swapped for
// Supabase Auth, with a one-time password reset for existing accounts.

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function hashPassword(salt: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(salt + password);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(buf));
}

export async function verifyPassword(salt: string, expectedHash: string, attempt: string): Promise<boolean> {
  const h = await hashPassword(salt, attempt);
  return h === expectedHash;
}

// 12-char alphanumeric, avoids visually confusing characters (0/O, 1/l/I)
export function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
