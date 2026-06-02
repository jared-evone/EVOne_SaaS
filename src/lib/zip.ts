// Minimal in-browser ZIP encoder, STORE mode only (no compression).
// PDFs/images are already compressed internally — deflate gives ~0 win and
// would pull in a 30KB+ dep. STORE keeps this file at ~80 LOC and dep-free.

let CRC_TABLE: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(buf: Uint8Array): number {
  const t = getCrcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d: Date): { date: number; time: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >>> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { date, time };
}

export interface ZipFile { name: string; data: Uint8Array; }

export function createZipBlob(files: ZipFile[]): Blob {
  const enc = new TextEncoder();
  const { date, time } = dosDateTime(new Date());

  interface Entry { nameBytes: Uint8Array; size: number; crc: number; offset: number; }
  const entries: Entry[] = [];
  const localParts: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);

    const header = new ArrayBuffer(30);
    const dv = new DataView(header);
    dv.setUint32(0,  0x04034b50, true);
    dv.setUint16(4,  20, true);
    dv.setUint16(6,  0, true);
    dv.setUint16(8,  0, true);            // STORE
    dv.setUint16(10, time, true);
    dv.setUint16(12, date, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, f.data.length, true);
    dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);

    localParts.push(new Uint8Array(header), nameBytes, f.data);
    entries.push({ nameBytes, size: f.data.length, crc, offset });
    offset += 30 + nameBytes.length + f.data.length;
  }

  const centralStart = offset;
  const centralParts: Uint8Array[] = [];
  let centralSize = 0;
  for (const e of entries) {
    const header = new ArrayBuffer(46);
    const dv = new DataView(header);
    dv.setUint32(0,  0x02014b50, true);
    dv.setUint16(4,  20, true);
    dv.setUint16(6,  20, true);
    dv.setUint16(8,  0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, time, true);
    dv.setUint16(14, date, true);
    dv.setUint32(16, e.crc, true);
    dv.setUint32(20, e.size, true);
    dv.setUint32(24, e.size, true);
    dv.setUint16(28, e.nameBytes.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, e.offset, true);
    centralParts.push(new Uint8Array(header), e.nameBytes);
    centralSize += 46 + e.nameBytes.length;
  }

  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0,  0x06054b50, true);
  ev.setUint16(4,  0, true);
  ev.setUint16(6,  0, true);
  ev.setUint16(8,  entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, new Uint8Array(eocd)], { type: 'application/zip' });
}
