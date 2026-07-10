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
import { isOverlay, pagesOf } from './OverlayForm';
import { buildImagePdf } from './imagePdf';
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

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!/^data:image\//i.test(src) && !/^https?:\/\//i.test(src)) { resolve(null); return; }
    let done = false;
    const finish = (r: HTMLImageElement | null) => { if (!done) { done = true; resolve(r); } };
    const timer = setTimeout(() => finish(null), 12000);
    const img = new Image();
    img.onload = () => { clearTimeout(timer); finish(img); };
    img.onerror = () => { clearTimeout(timer); finish(null); };
    img.src = src;
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

function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, fontPx: number) {
  ctx.save();
  ctx.fillStyle = '#1a1a1a';
  ctx.font = `${fontPx}px Figtree, Arial, sans-serif`;
  ctx.textBaseline = 'top';
  const lineH = fontPx * 1.22;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > w - 4 && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  const maxLines = Math.max(1, Math.floor(h / lineH));
  let ty = y + Math.max(1, (h - Math.min(lines.length, maxLines) * lineH) / 2);
  for (let i = 0; i < lines.length && i < maxLines; i++) { ctx.fillText(lines[i], x + 2, ty); ty += lineH; }
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
    } else if (f.type === 'photo' || f.type === 'signature') {
      if (typeof val === 'string' && isImageSrc(val)) {
        const im = await loadImage(val);
        if (im) drawContain(ctx, im, fx, fy, fw, fh);
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
        if (typeof v === 'string' && /^data:image\//i.test(v)) {
          const small = await downscaleDataUrl(v, 1000, 0.7);
          if (small) out[k] = small.src;
        }
      }
      return { ...f, values: out };
    }),
  );

  const totalKb = Math.round([...baked.values()].flat().reduce((a, p) => a + p.src.length, 0) / 1024);
  console.log(`[pdf] baked ${[...baked.values()].flat().length} overlay pages (${totalKb}KB) in ${Math.round(performance.now() - t0)}ms`);
  return { forms: lightForms, getTemplate, baked };
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

  return pdf(
    <WorkOrderDocument workOrder={workOrder} forms={prepared.forms} getTemplate={prepared.getTemplate} baked={prepared.baked} />,
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
                <Text style={styles.metaLine}><Text style={styles.metaLabel}>Technician: </Text>{workOrder.assignedTo ?? '—'}</Text>
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
  // Generate the PDF blob EXACTLY ONCE on open, then show it in a plain <iframe>
  // (the browser's native PDF viewer). This avoids react-pdf's PDFViewer, which
  // re-generates the document on every render — with an unstable getTemplate
  // that becomes an infinite regeneration loop that freezes the tab.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState('Starting…');

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    // Yield to the browser so the current stage text actually paints before the
    // next (possibly blocking) step — so a frozen screen shows WHERE it stuck.
    const paint = () => new Promise((r) => setTimeout(r, 30));
    (async () => {
      try {
        console.log('[pdf] export started');
        setStage('Rendering the form…');
        await paint();
        const blob = await generateWorkOrderPdf(workOrder, forms, getTemplate);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch (err) {
        console.error('[pdf] export failed', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // Generate once on open — deps intentionally empty (getTemplate isn't stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileBase = `${workOrder.id} ${workOrder.customer}`
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_');
  const fileName = `${fileBase}.pdf`;

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    a.click();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,20,20,0.86)',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Action bar */}
      <div
        style={{
          background: '#1a1a1a',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: C.white,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' }}>
            PDF Preview
          </div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            {workOrder.id} · {workOrder.customer} · {forms.length} form{forms.length === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginRight: 6 }}>
            Rendered with @react-pdf/renderer · preview = download
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.22)',
              background: 'transparent',
              color: C.white,
              fontFamily: 'Figtree',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
          <button
            onClick={handleDownload}
            disabled={!blobUrl}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: 'none',
              background: !blobUrl ? '#7BB985' : C.green,
              color: C.white,
              fontFamily: 'Figtree',
              fontSize: 13,
              fontWeight: 700,
              cursor: !blobUrl ? 'default' : 'pointer',
            }}
          >
            <DownloadIcon size={12} strokeWidth={2.25} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }}/> Download PDF
          </button>
        </div>
      </div>

      {/* PDF viewer */}
      <div
        style={{
          flex: 1,
          background: '#3a3a3a',
          padding: 16,
          overflow: 'hidden',
        }}
      >
        {error ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.white, fontSize: 13, opacity: 0.85, textAlign: 'center', padding: 24 }}>
            <div style={{ maxWidth: 420 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Couldn’t generate the PDF</div>
              <div style={{ fontSize: 12, opacity: 0.6, fontFamily: 'monospace', wordBreak: 'break-word' }}>{error}</div>
            </div>
          </div>
        ) : !blobUrl ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', justifyContent: 'center', color: C.white, fontSize: 13, opacity: 0.85 }}>
            <div>{stage}</div>
            <div style={{ fontSize: 11, opacity: 0.6 }}>If this stays stuck, tell support which step it stopped on.</div>
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
