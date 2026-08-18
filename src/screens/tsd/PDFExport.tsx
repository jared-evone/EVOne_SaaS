import { useEffect, useState } from 'react';
import { Download as DownloadIcon } from 'lucide-react';
import {
  Document,
  Page,
  View,
  Text,
  Image as PDFImage,
  StyleSheet,
  Font,
  Svg,
  Path,
  pdf,
} from '@react-pdf/renderer';
import logoSrc from '../../assets/evone-logo.png';
import figtree400 from '@fontsource/figtree/files/figtree-latin-400-normal.woff';
import figtree500 from '@fontsource/figtree/files/figtree-latin-500-normal.woff';
import figtree600 from '@fontsource/figtree/files/figtree-latin-600-normal.woff';
import figtree700 from '@fontsource/figtree/files/figtree-latin-700-normal.woff';

// Register Figtree so the PDF uses the same brand typography as the app
Font.register({
  family: 'Figtree',
  fonts: [
    { src: figtree400, fontWeight: 400 },
    { src: figtree500, fontWeight: 500 },
    { src: figtree600, fontWeight: 600 },
    { src: figtree700, fontWeight: 700 },
  ],
});
import { C } from '../../theme';
import { isOverlay, pagesOf, SIGNATURE_FONT } from './OverlayForm';
import { buildImagePdf } from './imagePdf';
import { createZipBlob } from '../../lib/zip';
import { fetchToDataUrl, isStoredImageUrl } from '../../lib/formMedia';
import { assigneesLabel } from '../../workOrderStore';
import type { FormField, FormTemplate, FormValues, OverlayPage, WorkOrder, WorkOrderForm } from '../../workOrderStore';

// ─── Brand tokens scoped to react-pdf (no media queries / no `var`) ──

const PDF_GREEN = '#2A9A47';
const PDF_HONEYDEW = '#E6F4EA';
const PDF_SLATE = '#5B6B7A';
const PDF_LINE = '#EBEBEB';
const PDF_LINE_LIGHT = '#F3F3F3';
const PDF_DANGER = '#C0321A';

// A4 page geometry (points: 1pt = 1/72 inch)
const PAGE_PADDING = 40;
const PAGE_CONTENT_WIDTH = 595 - PAGE_PADDING * 2; // 515 pt
// Printable height left for the overlay image after the top/bottom padding, the
// fixed footer, and the letterhead. Keeping the image within this box (and
// wrap={false}) stops react-pdf from trying to paginate an oversized block of
// absolutely-positioned fields — which hangs the whole render.
const OVERLAY_MAX_HEIGHT = 842 - PAGE_PADDING - (PAGE_PADDING + 32) - 74; // ≈ 656 pt

const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE_PADDING,
    paddingBottom: PAGE_PADDING + 32, // leave room for fixed footer
    paddingHorizontal: PAGE_PADDING,
    fontSize: 10,
    color: '#1a1a1a',
    fontFamily: 'Figtree',
    lineHeight: 1.4,
  },

  // Letterhead
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
    marginBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: PDF_GREEN,
  },
  logo: { width: 70, marginRight: 14 },
  headerCenter: { flex: 1, paddingRight: 8 },
  templateName: {
    fontSize: 13,
    fontFamily: 'Figtree',
    fontWeight: 700,
    color: PDF_GREEN,
    letterSpacing: 0.4,
  },
  templateDesc: { fontSize: 9, color: PDF_SLATE, marginTop: 2 },
  headerMeta: { fontSize: 9, color: PDF_SLATE, textAlign: 'right' },
  metaLine: { marginBottom: 2 },
  metaLabel: { fontFamily: 'Figtree', fontWeight: 700, color: '#1a1a1a' },

  // Section + fields (structured)
  section: {
    marginTop: 12,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: PDF_LINE,
    fontFamily: 'Figtree',
    fontWeight: 700,
    fontSize: 11,
    color: PDF_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  field: { marginBottom: 8 },
  fieldLabel: {
    fontSize: 8,
    color: PDF_SLATE,
    fontFamily: 'Figtree',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 11,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: PDF_LINE,
    borderRadius: 3,
    minHeight: 18,
  },
  fieldValueRequiredEmpty: {
    borderColor: PDF_DANGER,
    color: PDF_DANGER,
  },
  requiredStar: { color: PDF_DANGER, marginLeft: 3 },

  // Checkbox row (structured)
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: PDF_HONEYDEW,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: PDF_LINE,
  },
  checkboxRowUnchecked: {
    backgroundColor: '#FAFAFA',
  },
  checkboxBox: {
    width: 11,
    height: 11,
    marginRight: 8,
    borderWidth: 1,
    borderColor: PDF_SLATE,
    borderRadius: 2,
  },
  checkboxBoxChecked: {
    backgroundColor: PDF_GREEN,
    borderColor: PDF_GREEN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: { fontSize: 10, flex: 1 },

  // Overlay layout
  overlayWrap: {
    position: 'relative',
    alignSelf: 'center',
  },
  overlayImage: { width: '100%', height: '100%' },
  overlayCell: {
    position: 'absolute',
    paddingHorizontal: 2,
    paddingVertical: 1,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  overlayText: {
    fontSize: 9,
    color: '#1a1a1a',
  },
  overlayCheckEmpty: {
    width: '70%',
    height: '70%',
    borderWidth: 1,
    borderColor: PDF_SLATE,
    borderRadius: 1,
    alignSelf: 'center',
  },
  overlayCheckFilled: {
    width: '70%',
    height: '70%',
    backgroundColor: PDF_GREEN,
    borderRadius: 1,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 24,
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: PDF_SLATE,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: PDF_LINE_LIGHT,
  },

  // Audit
  audit: {
    marginTop: 18,
    padding: 8,
    backgroundColor: PDF_HONEYDEW,
    borderRadius: 4,
    fontSize: 9,
    color: PDF_SLATE,
  },
  auditTitle: {
    fontFamily: 'Figtree',
    fontWeight: 700,
    color: '#1a1a1a',
    marginBottom: 2,
    fontSize: 9,
  },
});

// ─── Helpers ──────────────────────────────────────────────────────

function CheckMark({ size = 9 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 16 16" width={size} height={size}>
      <Path
        d="M3.2 8.4 L6.4 11.6 L12.8 4.6"
        stroke="#ffffff"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function stringValue(values: FormValues, id: string): string {
  const v = values[id];
  return typeof v === 'string' ? v : '';
}

// Re-encode a (potentially huge, scale-2 PNG) data URL to a capped-width JPEG so
// react-pdf doesn't have to embed & decode multi-MB images on the main thread —
// that's what freezes the tab ("Page Unresponsive") on multi-page overlay forms.
function downscaleDataUrl(src: string, maxW: number, quality: number): Promise<{ src: string; w: number; h: number } | null> {
  return new Promise((resolve) => {
    if (!/^data:image\//i.test(src)) { resolve(null); return; }
    let done = false;
    const finish = (r: { src: string; w: number; h: number } | null) => { if (!done) { done = true; resolve(r); } };
    // Never let a stuck decode hang the whole export.
    const timer = setTimeout(() => { console.warn('[pdf] image downscale timed out, using original'); finish(null); }, 12000);
    const img = new Image();
    img.onload = () => {
      clearTimeout(timer);
      const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
      const w = Math.max(1, Math.round((img.naturalWidth || maxW) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || maxW) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { finish(null); return; }
      ctx.fillStyle = '#ffffff'; // JPEG has no alpha — paint white so it isn't black
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      try { finish({ src: canvas.toDataURL('image/jpeg', quality), w, h }); }
      catch { finish(null); }
    };
    img.onerror = () => { clearTimeout(timer); finish(null); };
    img.src = src;
  });
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  // A stored photo is now an http(s) URL; fetch it to a data URL first so drawing
  // it to a canvas doesn't taint the canvas (canvas.toDataURL would then throw).
  let resolved = src;
  if (/^https?:\/\//i.test(src)) {
    const dataUrl = await fetchToDataUrl(src);
    if (!dataUrl) return null;
    resolved = dataUrl;
  }
  if (!/^data:image\//i.test(resolved)) return null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: HTMLImageElement | null) => { if (!done) { done = true; resolve(r); } };
    const timer = setTimeout(() => finish(null), 12000);
    const img = new Image();
    img.onload = () => { clearTimeout(timer); finish(img); };
    img.onerror = () => { clearTimeout(timer); finish(null); };
    img.src = resolved;
  });
}

function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ar = (img.naturalWidth || 1) / (img.naturalHeight || 1);
  let dw = w, dh = w / ar;
  if (dh > h) { dh = h; dw = h * ar; }
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawCheck(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const s = Math.min(w, h) * 0.8;
  const cx = x + w / 2, cy = y + h / 2;
  ctx.save();
  ctx.strokeStyle = PDF_GREEN;
  ctx.lineWidth = Math.max(1.5, s * 0.16);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.32, cy + s * 0.02);
  ctx.lineTo(cx - s * 0.06, cy + s * 0.28);
  ctx.lineTo(cx + s * 0.34, cy - s * 0.28);
  ctx.stroke();
  ctx.restore();
}

// An ✕ stamped across the field box — used to strike out the option that doesn't
// apply. Spans the box the same way the on-screen SVG does.
function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const padX = w * 0.1, padY = h * 0.1;
  ctx.save();
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.11);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + padX, y + padY);
  ctx.lineTo(x + w - padX, y + h - padY);
  ctx.moveTo(x + w - padX, y + padY);
  ctx.lineTo(x + padX, y + h - padY);
  ctx.stroke();
  ctx.restore();
}

// Split text into lines that fit `maxW` at the ctx's current font. Honours
// explicit newlines, and hard-breaks a single word that is itself too wide
// (a long URL / part number) instead of letting it run past the box.
function wrapToWidth(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxW) { line = test; continue; }
      if (line) { out.push(line); line = ''; }
      if (ctx.measureText(word).width <= maxW) { line = word; continue; }
      // Word alone overflows — break it across lines by character.
      let chunk = '';
      for (const ch of word) {
        if (chunk && ctx.measureText(chunk + ch).width > maxW) { out.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      line = chunk;
    }
    if (line) out.push(line);
  }
  return out;
}

// Draw text inside a field box. Text is wrapped, and if it still doesn't fit the
// box height the font shrinks until it does — so a long remark is never silently
// truncated (the old behaviour dropped every line past the first that fit) and
// never spills outside its cell. The box is clipped as a final guarantee.
function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, fontPx: number, fontFamily = 'Figtree, Arial, sans-serif') {
  const maxW = Math.max(1, w - 4);
  const MIN_PX = 5;
  let size = Math.max(MIN_PX, fontPx);
  let lines: string[] = [];
  for (;;) {
    ctx.font = `${size}px ${fontFamily}`;
    lines = wrapToWidth(ctx, text, maxW);
    if (lines.length * (size * 1.22) <= h || size <= MIN_PX) break;
    size = Math.max(MIN_PX, size - 0.5);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#1a1a1a';
  ctx.font = `${size}px ${fontFamily}`;
  ctx.textBaseline = 'top';
  const lineH = size * 1.22;
  let ty = y + Math.max(1, (h - lines.length * lineH) / 2);
  for (const ln of lines) { ctx.fillText(ln, x + 2, ty); ty += lineH; }
  ctx.restore();
}

// Bake one overlay page (background + all field values) into a single flat JPEG.
// react-pdf then embeds ONE image per page instead of a background plus dozens of
// absolutely-positioned Views/Texts/photos — which is what freezes the browser.
async function flattenOverlayPage(
  page: OverlayPage,
  fields: FormField[],
  values: FormValues,
  footer?: string,
): Promise<{ src: string; w: number; h: number }> {
  const bg = isImageSrc(page.imageSrc) ? await loadImage(page.imageSrc) : null;
  const srcW = page.imageWidth || bg?.naturalWidth || 1000;
  const srcH = page.imageHeight || bg?.naturalHeight || Math.round((srcW * 297) / 210);
  const scale = Math.min(1, 1400 / srcW); // cap width for sharp text at a small size
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { src: page.imageSrc ?? '', w, h };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  if (bg) ctx.drawImage(bg, 0, 0, w, h);
  for (const f of fields) {
    const fx = ((f.x ?? 0) / 100) * w;
    const fy = ((f.y ?? 0) / 100) * h;
    const fw = ((f.width ?? 10) / 100) * w;
    const fh = ((f.height ?? 5) / 100) * h;
    const val = values[f.id];
    if (f.type === 'checkbox') {
      if (val === true) drawCheck(ctx, fx, fy, fw, fh);
    } else if (f.type === 'cross') {
      if (val === true) drawCross(ctx, fx, fy, fw, fh);
    } else if (f.type === 'photo' || f.type === 'signature') {
      const typed = typeof val === 'string' ? val.trim() : '';
      if (typeof val === 'string' && isImageSrc(val)) {
        const im = await loadImage(val);
        if (im) drawContain(ctx, im, fx, fy, fw, fh);
      } else if (f.type === 'signature' && typed) {
        // Typed signature — match the on-screen size (≈60% of the field height,
        // no low cap) so a large field shows a large signature. Draw it as one
        // centred line, shrinking only if the name is too wide to fit the box.
        let fontPx = f.fontSize ? (f.fontSize / 100) * h : fh * 0.6;
        ctx.save();
        ctx.font = `${fontPx}px ${SIGNATURE_FONT}`;
        const tw = ctx.measureText(typed).width;
        const maxW = Math.max(1, fw - 6);
        if (tw > maxW) fontPx = Math.max(8, fontPx * (maxW / tw));
        ctx.font = `${fontPx}px ${SIGNATURE_FONT}`;
        ctx.fillStyle = '#1a1a1a';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(typed, fx + fw / 2, fy + fh / 2);
        ctx.restore();
      }
    } else if (typeof val === 'string' && val.trim()) {
      // Explicit size = % of page height (matches the on-screen cqh units); else auto-fit the box.
      const fontPx = f.fontSize ? (f.fontSize / 100) * h : Math.max(8, Math.min(fh * 0.62, 15));
      drawWrappedText(ctx, val, fx, fy, fw, fh, fontPx);
    }
  }
  if (footer) {
    const fp = Math.max(9, Math.round(w * 0.011));
    ctx.save();
    ctx.font = `${fp}px Figtree, Arial, sans-serif`;
    ctx.fillStyle = '#8A97A3';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'center';
    ctx.fillText(footer, w / 2, h - Math.round(h * 0.008));
    ctx.restore();
  }
  return { src: canvas.toDataURL('image/jpeg', 0.8), w, h };
}

// Lighten an overlay template's page images for PDF output. Structured templates
// are returned untouched. Safe to call on every export — falls back to the
// original image if a page can't be re-encoded.
export async function lightenTemplateForPdf(t: FormTemplate): Promise<FormTemplate> {
  if (!isOverlay(t)) return t;
  const pages = pagesOf(t);
  const lightPages: OverlayPage[] = await Promise.all(
    pages.map(async (p) => {
      const small = isImageSrc(p.imageSrc) ? await downscaleDataUrl(p.imageSrc, 1000, 0.68) : null;
      return small
        ? { imageSrc: small.src, imageWidth: small.w, imageHeight: small.h }
        : p;
    }),
  );
  const first = lightPages[0];
  return { ...t, pages: lightPages, imageSrc: first?.imageSrc, imageWidth: first?.imageWidth, imageHeight: first?.imageHeight };
}

// Lighten EVERY image the PDF will embed — overlay page images AND the
// technician's filled photo/signature values. The browser build of react-pdf
// decodes each image on the main thread to embed it, so full-res photos are
// what actually freeze the tab ("Page Unresponsive"). Shrinking them first
// keeps generation fast. Returns lightened forms + a lightened template resolver.
export type BakedPage = { src: string; w: number; h: number };

export async function preparePdfExport(
  forms: WorkOrderForm[],
  getTemplate: (id: string) => FormTemplate | undefined,
  footerPrefix = '',
): Promise<{ forms: WorkOrderForm[]; getTemplate: (id: string) => FormTemplate | undefined; baked: Map<string, BakedPage[]> }> {
  const t0 = performance.now();

  // Overlay forms: bake each page (bg + values) to one flat image per page.
  const baked = new Map<string, BakedPage[]>();
  for (const f of forms) {
    const t = getTemplate(f.templateId);
    if (t && isOverlay(t)) {
      const pages = pagesOf(t);
      const out: BakedPage[] = [];
      for (let i = 0; i < pages.length; i++) {
        const footer = footerPrefix ? `${footerPrefix} · Page ${i + 1} of ${pages.length}` : undefined;
        out.push(await flattenOverlayPage(pages[i], t.fields.filter((fl) => (fl.page ?? 0) === i), f.values ?? {}, footer));
      }
      baked.set(f.id, out);
    }
  }

  // Structured forms keep react-pdf field rendering, but shrink any embedded
  // photo/signature values so those don't freeze the browser either.
  const lightForms = await Promise.all(
    forms.map(async (f) => {
      const t = getTemplate(f.templateId);
      if (!f.values || (t && isOverlay(t))) return f; // overlay values are baked in
      const out: FormValues = { ...f.values };
      for (const [k, v] of Object.entries(f.values)) {
        if (typeof v !== 'string') continue;
        // Stored photos are http URLs — fetch to a data URL so react-pdf embeds
        // them reliably (and we can shrink them). Legacy inline data URLs shrink
        // directly.
        let dataUrl = /^data:image\//i.test(v) ? v : null;
        if (!dataUrl && isStoredImageUrl(v)) dataUrl = await fetchToDataUrl(v);
        if (!dataUrl) continue;
        const small = await downscaleDataUrl(dataUrl, 1000, 0.7);
        out[k] = small ? small.src : dataUrl;
      }
      return { ...f, values: out };
    }),
  );

  const totalKb = Math.round([...baked.values()].flat().reduce((a, p) => a + p.src.length, 0) / 1024);
  console.log(`[pdf] baked ${[...baked.values()].flat().length} overlay pages (${totalKb}KB) in ${Math.round(performance.now() - t0)}ms`);
  return { forms: lightForms, getTemplate, baked };
}

// Widest a baked overlay page is handed to react-pdf at (mixed exports only).
// react-pdf's browser renderer degrades with TOTAL pixels, not page count, so the
// budget is shared: a 2-page form keeps ~120 DPI, while a 7-page one drops to
// ~85 DPI rather than hanging the tab. Overlay-only exports bypass react-pdf
// entirely (buildImagePdf) and keep full resolution.
function overlayWidthForReactPdf(pageCount: number): number {
  if (pageCount <= 2) return 1000;
  if (pageCount <= 4) return 850;
  return 700;
}

// Single entry point for producing a work-order PDF blob. Overlay-only exports
// (which freeze react-pdf's browser renderer) are assembled directly from the
// baked page images; anything with a structured form still uses react-pdf.
export async function generateWorkOrderPdf(
  workOrder: WorkOrder,
  forms: WorkOrderForm[],
  getTemplate: (id: string) => FormTemplate | undefined,
): Promise<Blob> {
  // No baked header/footer — overlay pages are the clean form only (branding is
  // added downstream when the team designs the final PDF).
  const prepared = await preparePdfExport(forms, getTemplate);

  const allOverlay = forms.length > 0 && forms.every((f) => (prepared.baked.get(f.id)?.length ?? 0) > 0);
  if (allOverlay) {
    const pages = forms.flatMap((f) => prepared.baked.get(f.id) ?? []);
    const t = performance.now();
    const blob = buildImagePdf(pages.map((p) => ({ dataUrl: p.src, wPx: p.w, hPx: p.h })));
    console.log(`[pdf] assembled ${pages.length}-page image PDF in ${Math.round(performance.now() - t)}ms → ${Math.round(blob.size / 1024)}KB`);
    return blob;
  }

  // Reaching here with baked overlay pages means a MIXED set (overlay +
  // structured) was requested as one document. That cannot be rendered well:
  // the structured form needs react-pdf layout, and react-pdf's browser renderer
  // hangs the tab on overlay page images — which is exactly what made previewing
  // a mixed work order look like a crash.
  //
  // Callers must therefore split by kind (PDFPreviewModal previews one form at a
  // time and downloads each kind as its own file). This shrink is only a
  // last-resort guard so a future caller degrades instead of freezing.
  const baked = new Map(prepared.baked);
  if (baked.size) {
    console.warn(`[pdf] ${workOrder.id}: overlay + structured forms requested in one document — render them separately instead (see PDFPreviewModal).`);
    const t = performance.now();
    const totalPages = [...baked.values()].reduce((n, ps) => n + ps.length, 0);
    const maxW = overlayWidthForReactPdf(totalPages);
    let before = 0, after = 0;
    for (const [formId, pages] of baked) {
      const shrunk: BakedPage[] = [];
      for (const p of pages) {
        before += p.src.length;
        const small = await downscaleDataUrl(p.src, maxW, 0.7);
        shrunk.push(small ? { src: small.src, w: small.w, h: small.h } : p);
        after += (small ? small.src : p.src).length;
      }
      baked.set(formId, shrunk);
    }
    console.log(`[pdf] mixed export: shrank ${totalPages} overlay pages to ${maxW}px wide, ${Math.round(before / 1024)}KB → ${Math.round(after / 1024)}KB in ${Math.round(performance.now() - t)}ms`);
  }

  return pdf(
    <WorkOrderDocument workOrder={workOrder} forms={prepared.forms} getTemplate={prepared.getTemplate} baked={baked} />,
  ).toBlob();
}

// ─── Document component ──────────────────────────────────────────

export function WorkOrderDocument({
  workOrder,
  forms,
  getTemplate,
  baked,
}: {
  workOrder: WorkOrder;
  forms: WorkOrderForm[];
  getTemplate: (id: string) => FormTemplate | undefined;
  baked?: Map<string, BakedPage[]>;
}) {
  const docForms = forms
    .map((f) => ({ f, t: getTemplate(f.templateId) }))
    .filter((x): x is { f: WorkOrderForm; t: FormTemplate } => !!x.t);

  // Flatten to printable pages: a structured form is one page; an overlay form
  // expands to one page per uploaded form page. When baked (the normal export
  // path) each overlay page is a single pre-rendered flat image.
  type DocPage = { f: WorkOrderForm; t: FormTemplate; overlay: boolean; page?: OverlayPage; flat?: BakedPage; pageIndex: number; pageCount: number };
  const docPages: DocPage[] = docForms.flatMap(({ f, t }): DocPage[] => {
    if (isOverlay(t)) {
      const bp = baked?.get(f.id);
      if (bp && bp.length) {
        return bp.map((flat, i) => ({ f, t, overlay: true, flat, pageIndex: i, pageCount: bp.length }));
      }
      const pgs = pagesOf(t);
      return pgs.map((op, i) => ({ f, t, overlay: true, page: op, pageIndex: i, pageCount: pgs.length }));
    }
    return [{ f, t, overlay: false, page: undefined, pageIndex: 0, pageCount: 1 }];
  });

  return (
    <Document
      title={`${workOrder.id} · ${workOrder.customer}`}
      author="EVOne Sdn Bhd"
      creator="EVOne TSD"
    >
      {docPages.map(({ f, t, overlay, page, flat, pageIndex, pageCount }) => {
        const values = f.values ?? {};
        const subtitle = pageCount > 1
          ? `${f.label} — page ${pageIndex + 1} of ${pageCount}`
          : (docForms.length > 1 ? f.label : t.description);
        return (
          <Page key={`${f.id}-${pageIndex}`} size="A4" style={styles.page}>
            {/* Letterhead */}
            <View style={styles.header} fixed>
              <PDFImage src={logoSrc} style={styles.logo} />
              <View style={styles.headerCenter}>
                <Text style={styles.templateName}>{t.name}</Text>
                {subtitle ? <Text style={styles.templateDesc}>{subtitle}</Text> : null}
              </View>
              <View style={styles.headerMeta}>
                <Text style={styles.metaLine}><Text style={styles.metaLabel}>Ref: </Text>{workOrder.id}</Text>
                <Text style={styles.metaLine}><Text style={styles.metaLabel}>Customer: </Text>{workOrder.customer}</Text>
                <Text style={styles.metaLine}><Text style={styles.metaLabel}>Scheduled: </Text>{workOrder.scheduledDate}</Text>
                <Text style={styles.metaLine}><Text style={styles.metaLabel}>Technician: </Text>{assigneesLabel(workOrder, '—')}</Text>
              </View>
            </View>

            {/* Body */}
            {overlay && flat
              ? <FlatImageBody flat={flat} />
              : overlay && page
              ? <OverlayBody page={page} fields={t.fields.filter((fl: FormField) => (fl.page ?? 0) === pageIndex)} values={values} />
              : <StructuredBody template={t} values={values} />}

            {/* Audit */}
            {workOrder.response && (
              <View style={styles.audit} wrap={false}>
                <Text style={styles.auditTitle}>Audit trail</Text>
                {workOrder.response.submittedBy && (
                  <Text>Submitted by {workOrder.response.submittedBy} on {workOrder.response.submittedAt}</Text>
                )}
                {workOrder.response.editedBy && (
                  <Text>Edited by {workOrder.response.editedBy} on {workOrder.response.editedAt}</Text>
                )}
                {workOrder.status === 'completed' && <Text>Approved & marked completed.</Text>}
              </View>
            )}

            {/* Footer */}
            <View style={styles.footer} fixed>
              <Text>EVOne Sdn Bhd · evone.com.my</Text>
              <Text render={({ pageNumber, totalPages }) => `${workOrder.id} · Page ${pageNumber} of ${totalPages}`} />
            </View>
          </Page>
        );
      })}
    </Document>
  );
}

// ─── Structured body ─────────────────────────────────────────────

function StructuredBody({
  template,
  values,
}: {
  template: FormTemplate;
  values: FormValues;
}) {
  return (
    <View>
      {template.fields.map((f) => (
        <StructuredField key={f.id} field={f} values={values} />
      ))}
    </View>
  );
}

function StructuredField({
  field,
  values,
}: {
  field: FormField;
  values: FormValues;
}) {
  if (field.type === 'section') {
    return <Text style={styles.section}>{field.label}</Text>;
  }

  if (field.type === 'checkbox') {
    const checked = values[field.id] === true;
    return (
      <View
        style={checked ? styles.checkboxRow : [styles.checkboxRow, styles.checkboxRowUnchecked]}
        wrap={false}
      >
        <View style={checked ? [styles.checkboxBox, styles.checkboxBoxChecked] : styles.checkboxBox}>
          {checked && <CheckMark />}
        </View>
        <Text style={styles.checkboxLabel}>{field.label}</Text>
      </View>
    );
  }

  if (field.type === 'group' && field.children) {
    // Two columns: the non-photo fields (numbers / text) on the left, and up to 4 photos
    // in a 2x2 grid on the right.
    const photoChildren = field.children.filter((c) => c.type === 'photo');
    const otherChildren = field.children.filter((c) => c.type !== 'photo');
    const photos = photoChildren
      .map((c) => ({ child: c, src: stringValue(values, c.id) }))
      .filter((p) => !!p.src)
      .slice(0, 4);
    const hasPhotos = photos.length > 0;
    return (
      <View style={styles.field} wrap={false}>
        <Text style={[styles.fieldLabel, { fontSize: 9, marginBottom: 2 }]}>{field.label}</Text>
        <View style={{ flexDirection: 'row', paddingLeft: 8, borderLeftWidth: 1.5, borderLeftColor: '#E4F3E3' }}>
          <View style={{ flex: 1, marginRight: hasPhotos ? 10 : 0 }}>
            {otherChildren.map((c) => (
              <StructuredField key={c.id} field={c} values={values} />
            ))}
          </View>
          {hasPhotos && (
            <View style={{ width: 232, flexDirection: 'row', flexWrap: 'wrap' }}>
              {photos.map((p) => (
                <View key={p.child.id} style={{ width: '50%', padding: 2 }}>
                  <Text style={[styles.fieldLabel, { fontSize: 7, marginBottom: 2 }]}>{p.child.label}</Text>
                  <PDFImage src={p.src} style={{ width: '100%', height: 96, borderRadius: 4, objectFit: 'cover' }} />
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  if (field.type === 'group') {
    const checked = values[field.id] === true;
    const photo = stringValue(values, `${field.id}::photo`);
    const remark = stringValue(values, `${field.id}::remark`);
    return (
      <View wrap={false} style={styles.field}>
        <View style={checked ? styles.checkboxRow : [styles.checkboxRow, styles.checkboxRowUnchecked]}>
          <View style={checked ? [styles.checkboxBox, styles.checkboxBoxChecked] : styles.checkboxBox}>
            {checked && <CheckMark />}
          </View>
          <Text style={styles.checkboxLabel}>{field.label}</Text>
        </View>
        {photo ? (
          <View style={{ marginTop: 6 }}>
            <Text style={styles.fieldLabel}>{field.photoLabel || 'Photo'}</Text>
            <PDFImage src={photo} style={{ width: 200, marginTop: 4, borderRadius: 4 }} />
          </View>
        ) : null}
        {remark ? (
          <View style={{ marginTop: 6 }}>
            <Text style={styles.fieldLabel}>{field.remarkLabel || 'Remarks'}</Text>
            <Text style={styles.fieldValue}>{remark}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  const value = stringValue(values, field.id);
  const isMissing = !!field.required && !value;

  if (field.type === 'photo') {
    return (
      <View style={styles.field} wrap={false}>
        <Text style={styles.fieldLabel}>
          {field.label}
          {field.required ? <Text style={styles.requiredStar}> *</Text> : ''}
        </Text>
        {value
          ? <PDFImage src={value} style={{ width: 240, marginTop: 4, borderRadius: 4 }} />
          : <Text style={isMissing ? [styles.fieldValue, styles.fieldValueRequiredEmpty] : styles.fieldValue}>{isMissing ? '— required —' : '— no photo —'}</Text>}
      </View>
    );
  }

  if (field.type === 'signature') {
    return (
      <View style={styles.field} wrap={false}>
        <Text style={styles.fieldLabel}>
          {field.label}
          {field.required ? <Text style={styles.requiredStar}> *</Text> : ''}
        </Text>
        {value
          ? <PDFImage src={value} style={{ width: 200, marginTop: 4, borderBottomWidth: 1, borderBottomColor: PDF_SLATE }} />
          : <Text style={isMissing ? [styles.fieldValue, styles.fieldValueRequiredEmpty] : styles.fieldValue}>{isMissing ? '— required —' : '— not signed —'}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.field} wrap={false}>
      <Text style={styles.fieldLabel}>
        {field.label}
        {field.required ? <Text style={styles.requiredStar}> *</Text> : ''}
      </Text>
      <Text style={isMissing ? [styles.fieldValue, styles.fieldValueRequiredEmpty] : styles.fieldValue}>
        {value || (isMissing ? '— required —' : ' ')}
      </Text>
    </View>
  );
}

// ─── Overlay body ────────────────────────────────────────────────

// Only genuine image data URLs (or http URLs) are safe to feed react-pdf's
// <Image> — anything else throws mid-render and, inside <PDFViewer>, takes the
// whole app down. Skip bad values instead.
function isImageSrc(s: unknown): s is string {
  return typeof s === 'string' && (/^data:image\//i.test(s) || /^https?:\/\//i.test(s));
}

// The normal overlay export path: one pre-baked flat image, fitted to the page.
function FlatImageBody({ flat }: { flat: BakedPage }) {
  const rawAspect = flat.w && flat.h ? flat.w / flat.h : 210 / 297;
  const aspect = Number.isFinite(rawAspect) && rawAspect > 0 ? rawAspect : 210 / 297;
  let displayWidth = PAGE_CONTENT_WIDTH;
  let displayHeight = displayWidth / aspect;
  if (displayHeight > OVERLAY_MAX_HEIGHT) {
    displayHeight = OVERLAY_MAX_HEIGHT;
    displayWidth = displayHeight * aspect;
  }
  return (
    <View wrap={false} style={[styles.overlayWrap, { width: displayWidth, height: displayHeight }]}>
      <PDFImage src={flat.src} style={styles.overlayImage} />
    </View>
  );
}

function OverlayBody({
  page,
  fields,
  values,
}: {
  page: OverlayPage;
  fields: FormField[];
  values: FormValues;
}) {
  if (!isImageSrc(page.imageSrc)) {
    return (
      <View style={{ padding: 20, alignItems: 'center' }}>
        <Text style={{ color: PDF_SLATE }}>No form image attached.</Text>
      </View>
    );
  }

  // Absolute display size in points. Absolutely-positioned children are placed
  // in POINTS (not percentages) — percentage top/left is unreliable in
  // @react-pdf and can resolve to NaN, which crashes the whole render.
  const rawAspect =
    page.imageWidth && page.imageHeight ? page.imageWidth / page.imageHeight : 210 / 297;
  const aspect = Number.isFinite(rawAspect) && rawAspect > 0 ? rawAspect : 210 / 297;
  // Fit within the printable box (width AND height) so the page never overflows.
  let displayWidth = PAGE_CONTENT_WIDTH;
  let displayHeight = displayWidth / aspect;
  if (displayHeight > OVERLAY_MAX_HEIGHT) {
    displayHeight = OVERLAY_MAX_HEIGHT;
    displayWidth = displayHeight * aspect;
  }

  return (
    <View
      wrap={false}
      style={[
        styles.overlayWrap,
        { width: displayWidth, height: displayHeight },
      ]}
    >
      <PDFImage src={page.imageSrc} style={styles.overlayImage} />
      {fields.map((f) => (
        <OverlayField key={f.id} field={f} values={values} cw={displayWidth} ch={displayHeight} />
      ))}
    </View>
  );
}

function OverlayField({
  field,
  values,
  cw,
  ch,
}: {
  field: FormField;
  values: FormValues;
  cw: number;
  ch: number;
}) {
  const pct = (v: number | undefined, span: number, fallback: number) => {
    const n = ((Number.isFinite(v) ? (v as number) : fallback) / 100) * span;
    return Number.isFinite(n) ? n : 0;
  };
  const left = pct(field.x, cw, 0);
  const top = pct(field.y, ch, 0);
  const width = pct(field.width, cw, 10);
  const height = pct(field.height, ch, 5);

  if (field.type === 'checkbox') {
    const checked = values[field.id] === true;
    return (
      <View
        style={[
          styles.overlayCell,
          { left, top, width, height, alignItems: 'center' },
        ]}
      >
        <View style={checked ? styles.overlayCheckFilled : styles.overlayCheckEmpty}>
          {checked && <CheckMark />}
        </View>
      </View>
    );
  }

  const value = stringValue(values, field.id);

  if ((field.type === 'photo' || field.type === 'signature') && isImageSrc(value)) {
    return (
      <View style={[styles.overlayCell, { left, top, width, height, padding: 0 }]}>
        <PDFImage src={value} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.overlayCell,
        { left, top, width, height },
      ]}
    >
      <Text style={styles.overlayText}>{field.type === 'photo' || field.type === 'signature' ? '' : value}</Text>
    </View>
  );
}

// ─── Preview modal ───────────────────────────────────────────────

interface PDFPreviewModalProps {
  workOrder: WorkOrder;
  forms: WorkOrderForm[];
  getTemplate: (id: string) => FormTemplate | undefined;
  onClose: () => void;
}

export function PDFPreviewModal({
  workOrder,
  forms,
  getTemplate,
  onClose,
}: PDFPreviewModalProps) {
  // A work order can hold overlay forms AND a structured one. Those two need
  // different renderers, and forcing both through react-pdf hangs the tab — so a
  // mixed set is never rendered as one document. Instead: preview ONE form at a
  // time (always fast), and download a tick-box selection, split by renderer.
  const isOverlayForm = (f: WorkOrderForm) => {
    const t = getTemplate(f.templateId);
    return !!t && isOverlay(t);
  };

  const multi = forms.length > 1;
  const [picked, setPicked] = useState<Set<string>>(() => new Set(forms.map((f) => f.id)));
  // null = show the chooser. Single-form work orders skip straight to the preview.
  const [previewId, setPreviewId] = useState<string | null>(multi ? null : (forms[0]?.id ?? null));

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState('Starting…');
  const [downloading, setDownloading] = useState(false);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);

  const fileBase = `${workOrder.id} ${workOrder.customer}`
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_');
  const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 60);

  // Preview the selected form on its own — one form is by definition one kind,
  // so this always takes a renderer that can cope.
  useEffect(() => {
    if (!previewId) { setBlobUrl(null); return; }
    const form = forms.find((f) => f.id === previewId);
    if (!form) return;
    let cancelled = false;
    let url: string | null = null;
    const paint = () => new Promise((r) => setTimeout(r, 30));
    setBlobUrl(null);
    setError(null);
    (async () => {
      try {
        setStage('Rendering the form…');
        await paint();
        const blob = await generateWorkOrderPdf(workOrder, [form], getTemplate);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch (err) {
        console.error('[pdf] preview failed', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
    // getTemplate isn't stable; regenerate only when the chosen form changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewId]);

  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  // Download the ticked forms. Overlay and structured forms are rendered
  // separately (each group is safe on its own) and zipped when both are present.
  const handleDownloadSelected = async () => {
    const chosen = forms.filter((f) => picked.has(f.id));
    if (!chosen.length) return;
    setDownloading(true);
    setDownloadNote(null);
    try {
      const overlayForms = chosen.filter(isOverlayForm);
      const structuredForms = chosen.filter((f) => !isOverlayForm(f));
      const jobs: { forms: WorkOrderForm[]; suffix: string }[] = [];
      if (overlayForms.length) jobs.push({ forms: overlayForms, suffix: overlayForms.length === 1 ? safeName(overlayForms[0].label) : 'forms' });
      if (structuredForms.length) jobs.push({ forms: structuredForms, suffix: structuredForms.length === 1 ? safeName(structuredForms[0].label) : 'report' });

      const out: { name: string; blob: Blob }[] = [];
      for (const job of jobs) {
        setStage(`Rendering ${job.suffix}…`);
        const blob = await generateWorkOrderPdf(workOrder, job.forms, getTemplate);
        out.push({ name: `${fileBase}_${job.suffix}.pdf`, blob });
      }

      if (out.length === 1) {
        saveBlob(out[0].blob, jobs.length === 1 && chosen.length === forms.length ? `${fileBase}.pdf` : out[0].name);
        setDownloadNote('Downloaded.');
      } else {
        const files = await Promise.all(out.map(async (o) => ({ name: o.name, data: new Uint8Array(await o.blob.arrayBuffer()) })));
        saveBlob(createZipBlob(files), `${fileBase}.zip`);
        setDownloadNote(`Downloaded ${out.length} PDFs as a zip — overlay and structured forms can't share one file.`);
      }
    } catch (err) {
      console.error('[pdf] download failed', err);
      setDownloadNote(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  const toggle = (id: string) =>
    setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const btnGhost: React.CSSProperties = {
    padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.22)',
    background: 'transparent', color: C.white, fontFamily: 'Figtree', fontSize: 12,
    fontWeight: 600, cursor: 'pointer',
  };

  const previewForm = previewId ? forms.find((f) => f.id === previewId) ?? null : null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,20,0.86)', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
      {/* Action bar */}
      <div style={{ background: '#1a1a1a', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12, color: C.white, flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' }}>
            {previewForm ? `Preview · ${previewForm.label}` : 'Export PDF'}
          </div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            {workOrder.id} · {workOrder.customer} · {forms.length} form{forms.length === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {previewForm && multi && (
            <button onClick={() => setPreviewId(null)} style={btnGhost}>← All forms</button>
          )}
          <button onClick={onClose} style={btnGhost}>Close</button>
          {previewForm && (
            <button
              onClick={() => {
                // The previewed blob is already rendered — just save it.
                if (!blobUrl) return;
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = `${fileBase}_${safeName(previewForm.label)}.pdf`;
                a.click();
              }}
              disabled={!blobUrl}
              style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: !blobUrl ? '#7BB985' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: !blobUrl ? 'default' : 'pointer' }}
            >
              <DownloadIcon size={12} strokeWidth={2.25} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} /> Download this form
            </button>
          )}
        </div>
      </div>

      {/* Body: chooser, or the single-form preview */}
      <div style={{ flex: 1, background: '#3a3a3a', padding: 16, overflow: 'auto' }}>
        {!previewForm ? (
          <div style={{ maxWidth: 640, margin: '0 auto', background: C.white, borderRadius: 14, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>Choose what to export</div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 4, lineHeight: 1.5 }}>
                This work order has {forms.length} forms. Preview them one at a time, or tick the ones you want and download.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {forms.map((f) => {
                const on = picked.has(f.id);
                const overlay = isOverlayForm(f);
                return (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1px solid ${on ? C.green : '#EBEBEB'}`, background: on ? C.honeydew : C.white }}>
                    <input
                      type="checkbox" checked={on} onChange={() => toggle(f.id)}
                      style={{ width: 16, height: 16, accentColor: C.green, cursor: 'pointer', flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</div>
                      <div style={{ fontSize: 11, color: C.slate }}>{overlay ? 'Overlay form' : 'Structured report'}</div>
                    </div>
                    <button
                      onClick={() => setPreviewId(f.id)}
                      style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                    >
                      Preview
                    </button>
                  </div>
                );
              })}
            </div>

            {downloadNote && (
              <div style={{ fontSize: 11.5, color: C.slate, background: C.seasalt, borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>{downloadNote}</div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => setPicked(picked.size === forms.length ? new Set() : new Set(forms.map((f) => f.id)))}
                style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
              >
                {picked.size === forms.length ? 'Clear all' : 'Select all'}
              </button>
              <button
                onClick={() => void handleDownloadSelected()}
                disabled={!picked.size || downloading}
                style={{ marginLeft: 'auto', padding: '9px 20px', borderRadius: 10, border: 'none', background: !picked.size || downloading ? '#9DC7A6' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: !picked.size || downloading ? 'default' : 'pointer' }}
              >
                <DownloadIcon size={12} strokeWidth={2.25} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
                {downloading ? `${stage}` : `Download ${picked.size} selected`}
              </button>
            </div>
          </div>
        ) : error ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.white, fontSize: 13, opacity: 0.85, textAlign: 'center', padding: 24 }}>
            <div style={{ maxWidth: 420 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Couldn’t generate the PDF</div>
              <div style={{ fontSize: 12, opacity: 0.6, fontFamily: 'monospace', wordBreak: 'break-word' }}>{error}</div>
            </div>
          </div>
        ) : !blobUrl ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', justifyContent: 'center', color: C.white, fontSize: 13, opacity: 0.85 }}>
            <div>{stage}</div>
            <div style={{ fontSize: 11, opacity: 0.6 }}>Rendering one form at a time keeps this fast.</div>
          </div>
        ) : (
          <iframe
            title="PDF preview"
            src={blobUrl}
            style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8, background: C.white }}
          />
        )}
      </div>
    </div>
  );
}
