import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';

interface AvatarCropperProps {
  file: File;
  onCancel: () => void;
  onApply: (cropped: File, previewUrl: string) => void;
  /** Output dimension in px (square). Default 320. */
  output?: number;
}

const VIEW = 220; // circular viewport diameter on screen

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// Drag-to-reposition + zoom editor. The image always covers the circular
// viewport (cover-fit), and Apply rasterises the visible region to a square
// canvas so the upload is already cropped — no server-side processing.
export function AvatarCropper({ file, onCancel, onApply, output = 320 }: AvatarCropperProps) {
  const [url, setUrl] = useState('');
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 }); // image top-left, in viewport px
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // Create the object URL inside the effect (not a useState initialiser): under
  // React StrictMode the mount/unmount/remount cycle would otherwise revoke the
  // only URL, leaving the <img> pointing at a dead blob.
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // baseFit: the cover-fit scale at zoom = 1 (smaller side fills the viewport).
  const baseFit = nat ? VIEW / Math.min(nat.w, nat.h) : 1;
  const scale = baseFit * zoom;
  const dispW = nat ? nat.w * scale : VIEW;
  const dispH = nat ? nat.h * scale : VIEW;

  const clampOff = (x: number, y: number) => ({
    x: clamp(x, VIEW - dispW, 0),
    y: clamp(y, VIEW - dispH, 0),
  });

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const w = e.currentTarget.naturalWidth;
    const h = e.currentTarget.naturalHeight;
    setNat({ w, h });
    const fit = VIEW / Math.min(w, h);
    setOff({ x: (VIEW - w * fit) / 2, y: (VIEW - h * fit) / 2 });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.px;
    const dy = e.clientY - drag.current.py;
    setOff(clampOff(drag.current.ox + dx, drag.current.oy + dy));
  };
  const onPointerUp = () => { drag.current = null; };

  const onZoom = (z: number) => {
    if (!nat) { setZoom(z); return; }
    const oldScale = baseFit * zoom;
    const newScale = baseFit * z;
    // Keep the viewport centre anchored to the same image point while zooming.
    const cx = (VIEW / 2 - off.x) / oldScale;
    const cy = (VIEW / 2 - off.y) / oldScale;
    const nx = VIEW / 2 - cx * newScale;
    const ny = VIEW / 2 - cy * newScale;
    const w = nat.w * newScale, h = nat.h * newScale;
    setZoom(z);
    setOff({ x: clamp(nx, VIEW - w, 0), y: clamp(ny, VIEW - h, 0) });
  };

  const apply = () => {
    const img = imgRef.current;
    if (!img || !nat) return;
    const canvas = document.createElement('canvas');
    canvas.width = output;
    canvas.height = output;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Map the visible viewport region back to natural image coordinates.
    const sx = -off.x / scale;
    const sy = -off.y / scale;
    const sSize = VIEW / scale;
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, output, output);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const cropped = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      onApply(cropped, URL.createObjectURL(blob));
    }, 'image/jpeg', 0.9);
  };

  const btn: React.CSSProperties = {
    padding: '8px 18px', borderRadius: 10, fontFamily: 'Figtree', fontSize: 13,
    fontWeight: 700, cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '4px 0' }}>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'relative', width: VIEW, height: VIEW, borderRadius: '50%',
          overflow: 'hidden', border: `2px solid ${C.green}`, background: C.seasalt,
          cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none',
        }}
      >
        {url && (
          <img
            ref={imgRef} src={url} alt="" draggable={false} onLoad={onLoad}
            style={{ position: 'absolute', left: off.x, top: off.y, width: dispW, height: dispH, maxWidth: 'none', pointerEvents: 'none' }}
          />
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: VIEW }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>−</span>
        <input type="range" min={1} max={4} step={0.01} value={zoom}
          onChange={(e) => onZoom(Number(e.target.value))}
          style={{ flex: 1, accentColor: C.green, cursor: 'pointer' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>+</span>
      </div>

      <div style={{ fontSize: 11, color: C.slate }}>Drag to reposition · slide to zoom</div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onCancel} style={{ ...btn, border: '1px solid #EBEBEB', background: C.white, color: C.slate }}>Cancel</button>
        <button onClick={apply} style={{ ...btn, border: 'none', background: C.green, color: C.white }}>Apply photo</button>
      </div>
    </div>
  );
}
