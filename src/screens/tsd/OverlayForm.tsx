import { useEffect, useRef, useState } from 'react';
import { C } from '../../theme';
import { FileText, Camera } from 'lucide-react';
import { uploadFormPhoto } from '../../lib/formMedia';
import type {
  FieldType,
  FormField,
  FormTemplate,
  FormValues,
  OverlayPage,
} from '../../workOrderStore';

// ── Shared helpers ────────────────────────────────────────────────

const A4_ASPECT = '210 / 297';

// Lazy-load pdf.js from a CDN (no npm dep, mirroring the Leaflet pattern) so an
// overlay form can be uploaded as a PDF — we render page 1 to a PNG.
const PDFJS_VERSION = '3.11.174';
let pdfjsLoader: Promise<unknown> | null = null;
function loadPdfJs(): Promise<{ getDocument: (s: { data: Uint8Array }) => { promise: Promise<unknown> }; GlobalWorkerOptions: { workerSrc: string } }> {
  const w = window as unknown as { pdfjsLib?: { getDocument: (s: { data: Uint8Array }) => { promise: Promise<unknown> }; GlobalWorkerOptions: { workerSrc: string } } };
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  if (!pdfjsLoader) {
    pdfjsLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
      s.onload = () => {
        if (!w.pdfjsLib) { reject(new Error('pdf.js did not attach to window')); return; }
        w.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
        resolve(w.pdfjsLib);
      };
      s.onerror = () => reject(new Error('Failed to load pdf.js from CDN'));
      document.head.appendChild(s);
    });
  }
  return pdfjsLoader as Promise<{ getDocument: (s: { data: Uint8Array }) => { promise: Promise<unknown> }; GlobalWorkerOptions: { workerSrc: string } }>;
}

async function pdfToImages(file: File): Promise<OverlayPage[]> {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: bytes }).promise as {
    numPages: number;
    getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> } }>;
  };
  const pages: OverlayPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({ imageSrc: canvas.toDataURL('image/png'), imageWidth: canvas.width, imageHeight: canvas.height });
  }
  return pages;
}

export function pagesOf(template: FormTemplate): OverlayPage[] {
  if (template.pages && template.pages.length) return template.pages;
  if (template.imageSrc) return [{ imageSrc: template.imageSrc, imageWidth: template.imageWidth, imageHeight: template.imageHeight }];
  return [];
}
function pageAspect(page: OverlayPage): React.CSSProperties {
  return page.imageWidth && page.imageHeight ? { aspectRatio: `${page.imageWidth} / ${page.imageHeight}` } : { aspectRatio: A4_ASPECT };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const fieldColor = (type: FieldType) =>
  type === 'cross' ? '#C0321A'
  : type === 'checkbox' ? C.opal : type === 'textarea' ? C.yellow : type === 'photo' || type === 'signature' ? C.opal : C.green;

const OVERLAY_FIELD_LABELS: Partial<Record<FieldType, string>> = {
  text: 'Text',
  textarea: 'Long text',
  checkbox: 'Checkbox',
  cross: 'Cross',
  photo: 'Photo',
  date: 'Date',
  time: 'Time',
  signature: 'Signature',
};

// ══════════════════════════════════════════════════════════════════
// Editor (builder mode)
// ══════════════════════════════════════════════════════════════════

export function OverlayEditor({
  template,
  onChange,
}: {
  template: FormTemplate;
  onChange: (t: FormTemplate) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [clipboard, setClipboard] = useState<FormField | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; fieldId: string | null; nx: number; ny: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pages = pagesOf(template);
  const pageFields = template.fields.filter((f) => (f.page ?? 0) === currentPage);
  const activePage = pages[currentPage] ?? pages[0];

  const applyPages = (pages: OverlayPage[]) => {
    const first = pages[0];
    onChange({
      ...template,
      pages,
      imageSrc: first?.imageSrc,
      imageWidth: first?.imageWidth,
      imageHeight: first?.imageHeight,
    });
    setCurrentPage(0);
  };

  const uploadFile = async (file: File) => {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
      try {
        const pages = await pdfToImages(file);
        if (!pages.length) throw new Error('No pages found');
        applyPages(pages);
      } catch (err) {
        alert(`Could not read that PDF: ${(err as Error).message}`);
      }
      return;
    }
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image (PNG / JPEG) or a PDF.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () =>
        applyPages([{ imageSrc: dataUrl, imageWidth: img.naturalWidth, imageHeight: img.naturalHeight }]);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = ''; // allow re-uploading the same file
  };

  const addField = (type: FieldType) => {
    if (type === 'section') return; // sections don't apply to overlay
    const id = `f-${Date.now()}`;
    const sizes: Partial<Record<FieldType, { w: number; h: number }>> = {
      checkbox: { w: 3, h: 3 },
      cross: { w: 3, h: 3 },
      textarea: { w: 40, h: 10 },
      photo: { w: 25, h: 18 },
      signature: { w: 30, h: 10 },
      date: { w: 18, h: 4 },
      time: { w: 12, h: 4 },
    };
    const size = sizes[type] ?? { w: 30, h: 4 };
    const newField: FormField = {
      id,
      type,
      label:
        type === 'checkbox' ? 'Check'
        : type === 'cross' ? 'Cross'
        : type === 'textarea' ? 'Notes'
        : type === 'photo' ? 'Photo'
        : type === 'signature' ? 'Signature'
        : type === 'date' ? 'Date'
        : type === 'time' ? 'Time'
        : 'Field',
      page: currentPage,
      x: 10,
      y: 10,
      width: size.w,
      height: size.h,
    };
    onChange({ ...template, fields: [...template.fields, newField] });
    setSelectedId(id);
  };

  const updateField = (id: string, patch: Partial<FormField>) =>
    onChange({
      ...template,
      fields: template.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });

  const removeField = (id: string) => {
    onChange({ ...template, fields: template.fields.filter((f) => f.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };

  // Drop a copy of `src` centred on a normalized (%) point of the current page.
  const placeAt = (src: FormField, nx: number, ny: number) => {
    const id = `f-${Date.now()}`;
    const w = src.width ?? 10;
    const h = src.height ?? 5;
    const x = clamp(nx - w / 2, 0, 100 - w);
    const y = clamp(ny - h / 2, 0, 100 - h);
    onChange({ ...template, fields: [...template.fields, { ...src, id, page: currentPage, x, y }] });
    setSelectedId(id);
  };
  // Same-page copy dropped just below the source so it doesn't overlap.
  const duplicateField = (f: FormField) => {
    const w = f.width ?? 10;
    const h = f.height ?? 5;
    placeAt(f, clamp((f.x ?? 0) + w / 2 + 2, 0, 100), clamp((f.y ?? 0) + h + 1 + h / 2, 0, 100));
  };
  // Open the right-click menu, clamped so it stays on screen; select the field under it.
  const openMenu = (clientX: number, clientY: number, fieldId: string | null, nx: number, ny: number) => {
    setSelectedId(fieldId);
    setMenu({
      x: Math.min(clientX, window.innerWidth - 260),
      y: Math.min(clientY, window.innerHeight - 360),
      fieldId, nx, ny,
    });
  };

  const menuField = menu?.fieldId ? template.fields.find((f) => f.id === menu.fieldId) ?? null : null;

  if (!template.imageSrc) {
    return (
      <UploadPrompt fileInputRef={fileInputRef} onFileSelect={onFileSelect} onUpload={uploadFile} />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={onFileSelect}
      />
      {/* Editing controls stay pinned at the top so Place field / page tabs stay
          reachable however far down the form you scroll. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 30, background: C.seasalt, display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
        <Toolbar onAdd={addField} onReplace={() => fileInputRef.current?.click()} />
        {pages.length > 1 && (
          <PageTabs
            count={pages.length}
            current={currentPage}
            counts={pages.map((_, i) => template.fields.filter((f) => (f.page ?? 0) === i).length)}
            onSelect={(i) => {
              setCurrentPage(i);
              setSelectedId(null);
            }}
          />
        )}
        <div style={{ fontSize: 11, color: C.slate, padding: '0 2px' }}>
          Drag to move, drag the corner to resize. <strong style={{ color: '#1a1a1a' }}>Right-click a field</strong> to copy, duplicate, rename or delete{clipboard ? ' — or right-click the form to paste' : ''}.
        </div>
      </div>
      {activePage && (
        <OverlayCanvas
          page={activePage}
          fields={pageFields}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onUpdate={updateField}
          onContextMenu={openMenu}
        />
      )}
      {menu && (
        <FieldContextMenu
          x={menu.x} y={menu.y} field={menuField} hasClipboard={!!clipboard}
          onCopy={() => menuField && setClipboard(menuField)}
          onDuplicate={() => menuField && duplicateField(menuField)}
          onPaste={() => clipboard && placeAt(clipboard, menu.nx, menu.ny)}
          onRename={(label) => menuField && updateField(menuField.id, { label })}
          onFontSize={(size) => menuField && updateField(menuField.id, { fontSize: size })}
          onToggleRequired={() => menuField && updateField(menuField.id, { required: !menuField.required })}
          onDelete={() => menuField && removeField(menuField.id)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function UploadPrompt({
  fileInputRef,
  onFileSelect,
  onUpload,
}: {
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUpload: (file: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) onUpload(file);
      }}
      onClick={() => fileInputRef.current?.click()}
      style={{
        background: dragOver ? C.honeydew : C.white,
        border: `2px dashed ${dragOver ? C.green : '#EBEBEB'}`,
        borderRadius: 14,
        padding: '60px 24px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'background .15s, border-color .15s',
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={onFileSelect}
      />
      <div style={{marginBottom:12,display:"inline-flex",justifyContent:"center"}}><FileText size={36} strokeWidth={1.5} color="#5B6B7A"/></div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 4 }}>
        Upload the official form template
      </div>
      <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>
        Drop an image here, or click to browse.
        <br />
        PNG, JPEG, or PDF (every page becomes an editable page).
      </div>
    </div>
  );
}

function Toolbar({
  onAdd,
  onReplace,
}: {
  onAdd: (type: FieldType) => void;
  onReplace: () => void;
}) {
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 12,
        border: '1px solid #EBEBEB',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: C.slate,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        Place field:
      </span>
      {(['text', 'textarea', 'checkbox', 'cross', 'photo', 'date', 'time', 'signature'] as FieldType[]).map((t) => (
        <button
          key={t}
          onClick={() => onAdd(t)}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: `1px solid ${fieldColor(t)}`,
            background: 'transparent',
            color: fieldColor(t),
            fontFamily: 'Figtree',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          + {OVERLAY_FIELD_LABELS[t]}
        </button>
      ))}
      <button
        onClick={onReplace}
        style={{
          marginLeft: 'auto',
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid #EBEBEB',
          background: 'transparent',
          color: C.slate,
          fontFamily: 'Figtree',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Replace form image
      </button>
    </div>
  );
}

function PageTabs({
  count,
  current,
  counts,
  onSelect,
}: {
  count: number;
  current: number;
  counts: number[];
  onSelect: (i: number) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        background: C.white,
        borderRadius: 12,
        border: '1px solid #EBEBEB',
        padding: '10px 14px',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: C.slate,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        Page:
      </span>
      {Array.from({ length: count }, (_, i) => {
        const active = i === current;
        return (
          <button
            key={i}
            onClick={() => onSelect(i)}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: `1px solid ${active ? C.green : '#EBEBEB'}`,
              background: active ? C.green : 'transparent',
              color: active ? C.white : C.slate,
              fontFamily: 'Figtree',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {i + 1}
            {counts[i] > 0 && (
              <span style={{ opacity: 0.7, fontWeight: 600 }}> · {counts[i]}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Canvas with drag & resize ─────────────────────────────────────

interface DragState {
  fieldId: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  orig: { x: number; y: number; width: number; height: number };
}

function OverlayCanvas({
  page,
  fields,
  selectedId,
  onSelect,
  onUpdate,
  onContextMenu,
}: {
  page: OverlayPage;
  fields: FormField[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<FormField>) => void;
  onContextMenu: (clientX: number, clientY: number, fieldId: string | null, nx: number, ny: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const updateRef = useRef(onUpdate);
  updateRef.current = onUpdate;

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      const container = containerRef.current;
      if (!drag || !container) return;
      const rect = container.getBoundingClientRect();
      const dxPct = ((e.clientX - drag.startX) / rect.width) * 100;
      const dyPct = ((e.clientY - drag.startY) / rect.height) * 100;
      if (drag.mode === 'move') {
        updateRef.current(drag.fieldId, {
          x: clamp(drag.orig.x + dxPct, 0, 100 - drag.orig.width),
          y: clamp(drag.orig.y + dyPct, 0, 100 - drag.orig.height),
        });
      } else {
        updateRef.current(drag.fieldId, {
          width: clamp(drag.orig.width + dxPct, 2, 100 - drag.orig.x),
          height: clamp(drag.orig.height + dyPct, 2, 100 - drag.orig.y),
        });
      }
    };
    const handleUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  const startDrag = (mode: 'move' | 'resize', e: React.MouseEvent, field: FormField) => {
    if (e.button !== 0) return; // let right-click open the context menu, not drag
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      fieldId: field.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: {
        x: field.x ?? 0,
        y: field.y ?? 0,
        width: field.width ?? 10,
        height: field.height ?? 5,
      },
    };
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const nx = ((e.clientX - rect.left) / rect.width) * 100;
        const ny = ((e.clientY - rect.top) / rect.height) * 100;
        const hit = [...fields].reverse().find(
          (f) => nx >= (f.x ?? 0) && nx <= (f.x ?? 0) + (f.width ?? 10) && ny >= (f.y ?? 0) && ny <= (f.y ?? 0) + (f.height ?? 5),
        );
        onContextMenu(e.clientX, e.clientY, hit?.id ?? null, nx, ny);
      }}
      style={{
        position: 'relative',
        background: C.white,
        border: '1px solid #EBEBEB',
        borderRadius: 10,
        overflow: 'hidden',
        containerType: 'size', // so field labels can preview their text size (cqh)
        ...pageAspect(page),
        userSelect: 'none',
      }}
    >
      <img
        src={page.imageSrc}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />
      {fields.map((f) => (
        <FieldBox
          key={f.id}
          field={f}
          selected={selectedId === f.id}
          onMouseDown={(e) => {
            onSelect(f.id);
            startDrag('move', e, f);
          }}
          onResizeStart={(e) => startDrag('resize', e, f)}
        />
      ))}
    </div>
  );
}

function FieldBox({
  field,
  selected,
  onMouseDown,
  onResizeStart,
}: {
  field: FormField;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
}) {
  const colour = fieldColor(field.type);
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute',
        left: `${field.x ?? 0}%`,
        top: `${field.y ?? 0}%`,
        width: `${field.width ?? 10}%`,
        height: `${field.height ?? 5}%`,
        border: `2px solid ${colour}`,
        background: selected ? `${colour}22` : 'rgba(255,255,255,0.45)',
        boxShadow: selected ? `0 0 0 3px ${colour}33` : 'none',
        cursor: 'move',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        fontFamily: 'Figtree',
        fontSize: 10,
        fontWeight: 700,
        color: colour,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        overflow: 'hidden',
        padding: '0 4px',
        textAlign: 'center',
        lineHeight: 1.1,
      }}
    >
      <span style={{ pointerEvents: 'none', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '100%',
        ...(['text', 'textarea', 'date'].includes(field.type) && field.fontSize ? { fontSize: `${field.fontSize}cqh`, textTransform: 'none' as const } : {}) }}>
        {field.type === 'checkbox' ? '☐' : field.type === 'cross' ? '✕' : field.label}
      </span>
      {selected && (
        <div
          onMouseDown={onResizeStart}
          style={{
            position: 'absolute',
            right: -6,
            bottom: -6,
            width: 12,
            height: 12,
            background: colour,
            border: '2px solid white',
            borderRadius: 2,
            cursor: 'nwse-resize',
          }}
        />
      )}
    </div>
  );
}

// ── Right-click context menu (inline controls, no browser prompts) ────

function MenuAction({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.seasalt; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        textAlign: 'left', padding: '8px 12px', borderRadius: 7, border: 'none', background: 'transparent',
        color: danger ? '#C0321A' : '#1a1a1a', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%',
      }}
    >
      {label}
    </button>
  );
}

const menuRowLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5,
};

function RenameRow({ value, onChange, onClose }: { value: string; onChange: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(value);
  return (
    <div style={{ padding: '6px 12px' }}>
      <div style={menuRowLabel}>Label</div>
      <input
        value={v}
        onChange={(e) => { setV(e.target.value); onChange(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { onChange(v.trim() ? v : v); onClose(); } }}
        placeholder="Field label"
        style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: '#FAFAFA', boxSizing: 'border-box' }}
      />
    </div>
  );
}

// A4 page height in PDF points — the export renders text at (fontSize% × this),
// so we show the exact resulting point size while the user adjusts.
const A4_HEIGHT_PT = 841.89;
const pctToPt = (pct: number) => (pct / 100) * A4_HEIGHT_PT;
const ptToPct = (pt: number) => (pt / A4_HEIGHT_PT) * 100;

function FontSizeRow({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  const pt = value ? pctToPt(value) : null;
  const setPt = (p: number) => onChange(ptToPct(clamp(p, 5, 100)));
  const stepBtn: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 7, border: '1px solid #EBEBEB', background: C.white, color: '#1a1a1a',
    fontFamily: 'Figtree', fontSize: 15, fontWeight: 700, cursor: 'pointer', lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
  return (
    <div style={{ padding: '6px 12px' }}>
      <div style={menuRowLabel}>Text size {pt ? `· ${Math.round(pt)} pt in PDF` : '· auto-fit box'}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={() => onChange(undefined)}
          style={{ padding: '4px 12px', borderRadius: 99, border: `1px solid ${!value ? C.green : '#EBEBEB'}`, background: !value ? C.honeydew : C.white, color: !value ? C.green : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          Auto
        </button>
        <button style={stepBtn} onClick={() => setPt((pt ?? 12) - 1)}>−</button>
        <span style={{ minWidth: 48, textAlign: 'center', fontSize: 13, fontWeight: 700, color: value ? '#1a1a1a' : C.slate }}>
          {pt ? `${Math.round(pt)} pt` : 'auto'}
        </span>
        <button style={stepBtn} onClick={() => setPt((pt ?? 12) + 1)}>+</button>
      </div>
    </div>
  );
}

function FieldContextMenu({
  x, y, field, hasClipboard,
  onCopy, onDuplicate, onPaste, onRename, onFontSize, onToggleRequired, onDelete, onClose,
}: {
  x: number; y: number; field: FormField | null; hasClipboard: boolean;
  onCopy: () => void; onDuplicate: () => void; onPaste: () => void;
  onRename: (label: string) => void; onFontSize: (size: number | undefined) => void;
  onToggleRequired: () => void; onDelete: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const box: React.CSSProperties = {
    position: 'fixed', left: x, top: y, zIndex: 2000, background: C.white, border: '1px solid #EBEBEB',
    borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,.16)', padding: 4, width: 240,
    display: 'flex', flexDirection: 'column', gap: 1,
  };
  const divider = <div style={{ height: 1, background: '#F3F3F3', margin: '4px 6px' }} />;

  if (!field) {
    return (
      <div ref={ref} style={box}>
        {hasClipboard
          ? <MenuAction label="Paste here" onClick={() => { onPaste(); onClose(); }} />
          : <div style={{ padding: '10px 12px', fontSize: 12, color: C.slate }}>Right-click a field to copy it.</div>}
      </div>
    );
  }

  const isText = ['text', 'textarea', 'date', 'time'].includes(field.type);
  return (
    <div ref={ref} style={box}>
      <MenuAction label="Copy" onClick={() => { onCopy(); onClose(); }} />
      <MenuAction label="Duplicate" onClick={() => { onDuplicate(); onClose(); }} />
      {hasClipboard && <MenuAction label="Paste here" onClick={() => { onPaste(); onClose(); }} />}
      {divider}
      <RenameRow value={field.label} onChange={onRename} onClose={onClose} />
      {isText && <FontSizeRow value={field.fontSize} onChange={onFontSize} />}
      {field.type !== 'checkbox' && field.type !== 'cross' && (
        <MenuAction label={`${field.required ? '✓ ' : ''}Required when filling`} onClick={onToggleRequired} />
      )}
      {divider}
      <MenuAction label="Delete" danger onClick={() => { onDelete(); onClose(); }} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Runtime renderer (technician fill / PIC edit / preview)
// ══════════════════════════════════════════════════════════════════

export function OverlayFormRenderer({
  template,
  values,
  onChange,
  disabled = false,
}: {
  template: FormTemplate;
  values: FormValues;
  onChange: (id: string, val: string | boolean) => void;
  disabled?: boolean;
}) {
  const pages = pagesOf(template);
  if (!pages.length) {
    return (
      <div
        style={{
          background: C.white,
          borderRadius: 10,
          border: '1px dashed #EBEBEB',
          padding: '40px 20px',
          textAlign: 'center',
          color: C.slate,
          fontSize: 13,
        }}
      >
        No form image uploaded.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {pages.map((page, pageIndex) => (
        <div key={pageIndex} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {pages.length > 1 && (
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: C.slate,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Page {pageIndex + 1} of {pages.length}
            </div>
          )}
          <div
            style={{
              position: 'relative',
              background: C.white,
              border: '1px solid #EBEBEB',
              borderRadius: 10,
              overflow: 'hidden',
              boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
              containerType: 'size', // lets fields size text as % of page height (cqh)
              ...pageAspect(page),
            }}
          >
            <img
              src={page.imageSrc}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            />
            {template.fields
              .filter((f) => (f.page ?? 0) === pageIndex)
              .map((f) => (
                <OverlayInput
                  key={f.id}
                  field={f}
                  value={values[f.id]}
                  onChange={(v) => onChange(f.id, v)}
                  disabled={disabled}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function OverlayInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
  disabled: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const base: React.CSSProperties = {
    position: 'absolute',
    left: `${field.x ?? 0}%`,
    top: `${field.y ?? 0}%`,
    width: `${field.width ?? 10}%`,
    height: `${field.height ?? 5}%`,
    boxSizing: 'border-box',
  };

  // Cross: a tap stamps an ✕ over the spot (e.g. striking out the option that
  // doesn't apply). Same on/off value shape as a checkbox, drawn as a cross.
  if (field.type === 'cross') {
    const marked = value === true;
    return (
      <div
        onClick={() => { if (!disabled) onChange(!marked); }}
        title={disabled ? undefined : marked ? 'Remove cross' : 'Place cross'}
        style={{
          ...base,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: disabled ? 'default' : 'pointer',
          border: disabled || marked ? '1px solid transparent' : '1px dashed #CBD5DD',
          borderRadius: 4,
          background: marked ? 'transparent' : disabled ? 'transparent' : 'rgba(255,255,255,0.7)',
          userSelect: 'none',
        }}
      >
        {marked && (
          // Scales to the field box — matches the cross the exported PDF draws.
          <svg viewBox="0 0 10 10" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
            <line x1="1" y1="1" x2="9" y2="9" stroke="#1a1a1a" strokeWidth="1.1" strokeLinecap="round" />
            <line x1="9" y1="1" x2="1" y2="9" stroke="#1a1a1a" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        )}
      </div>
    );
  }

  if (field.type === 'checkbox') {
    const checked = value === true;
    return (
      <label
        style={{
          ...base,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          style={{
            width: '85%',
            height: '85%',
            margin: 0,
            accentColor: C.green,
            cursor: disabled ? 'default' : 'pointer',
          }}
        />
      </label>
    );
  }

  const strVal = typeof value === 'string' ? value : '';
  // Explicit text size (as % of page height via container-query units) or default.
  const textFont = field.fontSize ? `${field.fontSize}cqh` : undefined;

  if (field.type === 'date' || field.type === 'time') {
    return (
      <input
        type={field.type}
        value={strVal}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...base,
          background: 'rgba(255,255,255,0.85)',
          border: `1px solid ${disabled ? 'transparent' : '#DADADA'}`,
          borderRadius: 4,
          fontFamily: 'Figtree',
          fontSize: textFont ?? 11,
          padding: '2px 4px',
          outline: 'none',
          color: '#1a1a1a',
        }}
      />
    );
  }

  if (field.type === 'photo') {
    const readPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setUploading(true);
      uploadFormPhoto(file)
        .then((url) => onChange(url))
        .catch(() => alert('Could not upload that photo — please check your connection and try again.'))
        .finally(() => setUploading(false));
    };
    return (
      <div
        style={{
          ...base,
          border: disabled && !strVal ? '1px solid transparent' : `1px dashed ${strVal ? 'transparent' : '#CBD5DD'}`,
          borderRadius: 4,
          overflow: 'hidden',
          background: strVal ? 'transparent' : 'rgba(255,255,255,0.7)',
        }}
      >
        {strVal && <img src={strVal} alt={field.label} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
        {!disabled && (
          <label
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: C.slate,
            }}
          >
            {uploading ? <span style={{ fontSize: 10, fontWeight: 700 }}>Uploading…</span> : (!strVal && <Camera size={16} strokeWidth={2} />)}
            <input type="file" accept="image/*" disabled={uploading} style={{ display: 'none' }} onChange={readPhoto} />
          </label>
        )}
      </div>
    );
  }

  if (field.type === 'signature') {
    return <OverlaySignature value={strVal} disabled={disabled} onChange={onChange} style={base} fontSize={textFont} />;
  }

  if (field.type === 'textarea') {
    return (
      <textarea
        value={strVal}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.label}
        style={{
          ...base,
          background: 'rgba(255,255,255,0.85)',
          border: `1px solid ${disabled ? 'transparent' : '#DADADA'}`,
          borderRadius: 4,
          fontFamily: 'Figtree',
          fontSize: textFont ?? 11,
          padding: '4px 6px',
          resize: 'none',
          outline: 'none',
          lineHeight: 1.4,
          color: '#1a1a1a',
        }}
      />
    );
  }

  return (
    <input
      type="text"
      value={strVal}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.label}
      style={{
        ...base,
        background: 'rgba(255,255,255,0.85)',
        border: `1px solid ${disabled ? 'transparent' : '#DADADA'}`,
        borderRadius: 4,
        fontFamily: 'Figtree',
        fontSize: textFont ?? 12,
        padding: '2px 6px',
        outline: 'none',
        color: '#1a1a1a',
      }}
    />
  );
}

// Overlay signatures are TYPED, not hand-drawn: the technician types their name
// and it renders in a script face — the same one the exported PDF draws, so what
// they see is what gets printed. Work orders signed before this change hold a
// drawn PNG (a data: URL); those still render as an image, with a clear button to
// switch to typing.
function OverlaySignature({
  value,
  onChange,
  disabled,
  style,
  fontSize,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  style: React.CSSProperties;
  fontSize?: string;
}) {
  if (value.startsWith('data:')) {
    return (
      <div style={{ ...style, border: '1px solid transparent', overflow: 'hidden' }}>
        <img src={value} alt="Signature" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        {!disabled && (
          <button type="button" onClick={() => onChange('')} title="Clear this drawn signature and type instead"
            style={{ position: 'absolute', top: 0, right: 0, width: 16, height: 16, lineHeight: '14px', padding: 0, borderRadius: 4, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontSize: 11, cursor: 'pointer' }}>
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <input
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder={disabled ? '' : 'Type name'}
      spellCheck={false}
      autoComplete="off"
      style={{
        ...style,
        fontFamily: SIGNATURE_FONT,
        fontSize: fontSize ?? `${((Number(style.height ? String(style.height).replace('%', '') : 5) || 5) * 0.6).toFixed(2)}cqh`,
        color: '#1a1a1a',
        textAlign: 'center',
        padding: '0 4px',
        border: disabled ? '1px solid transparent' : '1px dashed #CBD5DD',
        borderRadius: 4,
        background: disabled ? 'transparent' : 'rgba(255,255,255,0.7)',
        outline: 'none',
      }}
    />
  );
}

// ── Convenience: which kind is this template? ────────────────────

export const isOverlay = (t: FormTemplate) => (t.kind ?? 'structured') === 'overlay';

// Script face for typed signatures. Shared with the PDF export so the flattened
// page draws the same thing the technician saw. System faces only — no webfont is
// added; the generic `cursive` keyword is the guaranteed fallback.
export const SIGNATURE_FONT = "'Segoe Script', 'Bradley Hand', 'Snell Roundhand', 'Brush Script MT', cursive";
