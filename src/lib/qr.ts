// Lazy-load the QR generator from a CDN (no npm dep, same pattern as pdf.js / Leaflet).
export interface QRCodeCtor {
  new (el: HTMLElement, opts: { text: string; width: number; height: number; colorDark: string; colorLight: string }): unknown;
}
let qrLoader: Promise<QRCodeCtor> | null = null;
export function loadQrLib(): Promise<QRCodeCtor> {
  const w = window as unknown as { QRCode?: QRCodeCtor };
  if (w.QRCode) return Promise.resolve(w.QRCode);
  if (!qrLoader) {
    qrLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = () => (w.QRCode ? resolve(w.QRCode) : reject(new Error('QR library did not attach to window')));
      s.onerror = () => { qrLoader = null; reject(new Error('Failed to load QR library from CDN')); };
      document.head.appendChild(s);
    });
  }
  return qrLoader;
}

// PNG data URL of a QR for `text`, drawn off-screen so callers can size it freely.
export async function qrDataUrl(text: string, size = 512): Promise<string> {
  const QR = await loadQrLib();
  const el = document.createElement('div');
  new QR(el, { text, width: size, height: size, colorDark: '#1a1a1a', colorLight: '#FFFFFF' });
  const canvas = el.querySelector('canvas');
  if (!canvas) throw new Error('QR library did not draw');
  return canvas.toDataURL('image/png');
}
