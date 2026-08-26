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

// ── Overlay template page backgrounds ────────────────────────────
// Overlay templates used to embed their scanned page backgrounds as base64 in
// the template jsonb — ~4.7MB downloaded by every session on mount. Pages now
// live in Storage under template-pages/{templateId}/ and the template stores
// public URLs. Every reader already accepts both forms.

export async function externalizeTemplatePages<T extends {
  id: string;
  imageSrc?: string;
  pages?: { imageSrc?: string; imageWidth?: number; imageHeight?: number }[];
}>(tpl: T): Promise<T> {
  const ownPrefix = `/tsd-form-photos/template-pages/${tpl.id}/`;
  const place = async (src: string | undefined, idx: number): Promise<string | undefined> => {
    if (!src) return src;
    let dataUrl: string | null = null;
    if (/^data:image\//i.test(src)) {
      dataUrl = src;
    } else if (/^https?:\/\//i.test(src) && !src.includes(ownPrefix)) {
      // Page borrowed from another template's folder (e.g. a duplicated
      // template) — re-home it so deleting the original can't break this one.
      dataUrl = await fetchToDataUrl(src);
      if (!dataUrl) return src; // unreadable: keep the reference rather than lose it
    } else {
      return src; // already ours
    }
    const mime = /^data:image\/(png|jpeg|jpg|webp)/i.exec(dataUrl)?.[1]?.toLowerCase() ?? 'png';
    const ext = mime === 'jpeg' ? 'jpg' : mime;
    const path = `template-pages/${tpl.id}/page-${idx}-${rid()}.${ext}`;
    const blob = dataUrlToBlob(dataUrl);
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: true });
    if (error) throw error;
    return publicUrl(path);
  };

  const out: T = { ...tpl };
  if (out.pages?.length) {
    out.pages = await Promise.all(out.pages.map(async (pg, i) => ({ ...pg, imageSrc: await place(pg.imageSrc, i) })));
    // The legacy root fields mirror page 0.
    if (out.imageSrc !== undefined) out.imageSrc = out.pages[0]?.imageSrc;
  } else if (out.imageSrc) {
    out.imageSrc = await place(out.imageSrc, 0);
  }
  return out;
}

// Remove every stored page of a deleted template.
export async function removeTemplatePages(templateId: string): Promise<void> {
  const prefix = `template-pages/${templateId}`;
  const { data } = await supabase.storage.from(BUCKET).list(prefix, { limit: 100 });
  const names = (data ?? []).map((o) => `${prefix}/${o.name}`);
  if (names.length) await supabase.storage.from(BUCKET).remove(names);
}
