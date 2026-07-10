// Minimal, dependency-free image-only PDF writer.
//
// Overlay work-order forms are flattened to one JPEG per page (see PDFExport
// `flattenOverlayPage`). react-pdf's *browser* renderer is pathologically slow at
// embedding several images across several pages (it freezes the tab), while the
// same job is instant in Node. So for overlay exports we skip react-pdf entirely
// and drop the JPEGs straight into a PDF via /DCTDecode — the JPEG bytes are
// embedded verbatim (no decode, no re-encode), so this is effectively free.

export interface ImagePdfPage {
  dataUrl: string; // data:image/jpeg;base64,…
  wPx: number;
  hPx: number;
}

const A4_W = 595.28;
const A4_H = 841.89;
// The flattened page IS a full A4 form scan, so it fills the page edge-to-edge
// (matching the original PDF). No margin.
const MARGIN = 0;

function latin1(s: string): Uint8Array {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
  return a;
}

function jpegBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function buildImagePdf(pages: ImagePdfPage[]): Blob {
  const chunks: Uint8Array[] = [];
  let len = 0;
  const offsets: number[] = [];
  const push = (u: Uint8Array) => { chunks.push(u); len += u.length; };
  const str = (s: string) => push(latin1(s));

  const N = Math.max(1, pages.length);
  const totalObjs = 2 + N * 3; // catalog, pages, then {page, content, image} × N
  const pageNum = (i: number) => 3 + i * 3;
  const contentNum = (i: number) => 3 + i * 3 + 1;
  const imageNum = (i: number) => 3 + i * 3 + 2;

  const beginObj = (num: number) => { offsets[num] = len; str(`${num} 0 obj\n`); };
  const endObj = () => str('endobj\n');

  str('%PDF-1.3\n%\xff\xff\xff\xff\n');

  beginObj(1);
  str('<< /Type /Catalog /Pages 2 0 R >>\n');
  endObj();

  beginObj(2);
  const kids = pages.map((_, i) => `${pageNum(i)} 0 R`).join(' ');
  str(`<< /Type /Pages /Count ${N} /Kids [ ${kids} ] >>\n`);
  endObj();

  pages.forEach((pg, i) => {
    const aspect = (pg.wPx || 1) / (pg.hPx || 1);
    const availW = A4_W - 2 * MARGIN;
    const availH = A4_H - 2 * MARGIN;
    let dw = availW;
    let dh = dw / aspect;
    if (dh > availH) { dh = availH; dw = availH * aspect; }
    const x = (A4_W - dw) / 2;
    const y = (A4_H - dh) / 2;
    const content = `q\n${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    const cbytes = latin1(content);

    beginObj(pageNum(i));
    str(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W.toFixed(2)} ${A4_H.toFixed(2)}] /Resources << /XObject << /Im0 ${imageNum(i)} 0 R >> >> /Contents ${contentNum(i)} 0 R >>\n`);
    endObj();

    beginObj(contentNum(i));
    str(`<< /Length ${cbytes.length} >>\nstream\n`);
    push(cbytes);
    str('endstream\n');
    endObj();

    const jpg = jpegBytes(pg.dataUrl);
    beginObj(imageNum(i));
    str(`<< /Type /XObject /Subtype /Image /Width ${pg.wPx} /Height ${pg.hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    push(jpg);
    str('\nendstream\n');
    endObj();
  });

  const xrefOffset = len;
  const size = totalObjs + 1; // + free object 0
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n <= totalObjs; n++) {
    xref += `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  str(xref);
  str(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const out = new Uint8Array(len);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return new Blob([out], { type: 'application/pdf' });
}
