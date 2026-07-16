import { supabase } from './supabase';
import { compressImage } from './compressImage';

// Permanent Storage for technician form photos + non-templated report PDFs.
// Values in a work order's form data now hold a public Storage URL instead of an
// inline base64 blob — so the jsonb stays tiny and the media is never lost when a
// row is re-saved. Legacy work orders still carry base64 data URLs; every reader
// accepts both.
const BUCKET = 'tsd-form-photos';

function publicUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(body ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const rid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9).toString(16)}`;

// Compress a phone photo, upload it to permanent Storage, return its public URL.
export async function uploadFormPhoto(file: File): Promise<string> {
  const dataUrl = await compressImage(file);
  const blob = dataUrlToBlob(dataUrl);
  const path = `photos/${rid()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return publicUrl(path);
}

// Upload a non-templated report PDF to permanent Storage, return its public URL.
export async function uploadFormPdf(file: File): Promise<string> {
  const path = `reports/${rid()}.pdf`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
  if (error) throw error;
  return publicUrl(path);
}

// A stored (http) image URL — as opposed to a legacy inline data: URL.
export function isStoredImageUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\/\S+\.(jpe?g|png|webp)(\?|$)/i.test(v);
}

// Fetch a stored image URL and return it as a data URL, so canvas/PDF code that
// expects base64 (and would taint the canvas on a cross-origin <img>) keeps working.
export async function fetchToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
