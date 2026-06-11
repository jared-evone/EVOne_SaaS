import { useEffect, useRef, useState } from 'react';
import { C } from '../../theme';
import { FileText, Camera } from 'lucide-react';
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
  type === 'checkbox' ? C.opal : type === 'textarea' ? C.yellow : type === 'photo' || type === 'signature' ? C.opal : C.green;

const OVERLAY_FIELD_LABELS: Partial<Record<FieldType, string>> = {
  text: 'Text',
  textarea: 'Long text',
  checkbox: 'Checkbox',
  photo: 'Photo',
  date: 'Date',
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selected = template.fields.find((f) => f.id === selectedId) ?? null;
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
      textarea: { w: 40, h: 10 },
      photo: { w: 25, h: 18 },
      signature: { w: 30, h: 10 },
      date: { w: 18, h: 4 },
    };
    const size = sizes[type] ?? { w: 30, h: 4 };
    const newField: FormField = {
      id,
      type,
      label:
        type === 'checkbox' ? 'Check'
        : type === 'textarea' ? 'Notes'
        : type === 'photo' ? 'Photo'
        : type === 'signature' ? 'Signature'
        : type === 'date' ? 'Date'
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
      {activePage && (
        <OverlayCanvas
          page={activePage}
          fields={pageFields}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onUpdate={updateField}
        />
      )}
      {selected ? (
        <FieldInspector
          field={selected}
          onChange={(patch) => updateField(selected.id, patch)}
          onRemove={() => removeField(selected.id)}
        />
      ) : (
        <div
          style={{
            background: C.white,
            borderRadius: 12,
            border: '1px dashed #EBEBEB',
            padding: '14px 16px',
            fontSize: 12,
            color: C.slate,
            textAlign: 'center',
          }}
        >
          Click a field on the form to edit its properties, or add a new one above.
        </div>
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
      {(['text', 'textarea', 'checkbox', 'photo', 'date', 'signature'] as FieldType[]).map((t) => (
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
}: {
  page: OverlayPage;
  fields: FormField[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<FormField>) => void;
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
      style={{
        position: 'relative',
        background: C.white,
        border: '1px solid #EBEBEB',
        borderRadius: 10,
        overflow: 'hidden',
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
      <span style={{ pointerEvents: 'none', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '100%' }}>
        {field.type === 'checkbox' ? '☐' : field.label}
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

// ── Field inspector (selected field properties) ───────────────────

function FieldInspector({
  field,
  onChange,
  onRemove,
}: {
  field: FormField;
  onChange: (patch: Partial<FormField>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 12,
        border: `1.5px solid ${fieldColor(field.type)}`,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 6,
            background: `${fieldColor(field.type)}22`,
            color: fieldColor(field.type),
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {field.type}
        </span>
        <span style={{ fontSize: 11, color: C.slate }}>Selected field</span>
        <button
          onClick={onRemove}
          style={{
            marginLeft: 'auto',
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid #FDEAEA',
            background: 'transparent',
            color: '#C0321A',
            fontFamily: 'Figtree',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Delete
        </button>
      </div>

      <div>
        <label style={inspectorLabel}>Label</label>
        <input
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          style={inspectorInput}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <NumberCell label="X %" value={field.x ?? 0} onChange={(v) => onChange({ x: clamp(v, 0, 100) })} />
        <NumberCell label="Y %" value={field.y ?? 0} onChange={(v) => onChange({ y: clamp(v, 0, 100) })} />
        <NumberCell label="W %" value={field.width ?? 0} onChange={(v) => onChange({ width: clamp(v, 1, 100) })} />
        <NumberCell label="H %" value={field.height ?? 0} onChange={(v) => onChange({ height: clamp(v, 1, 100) })} />
      </div>

      {field.type !== 'checkbox' && (
        <label
          style={{
            fontSize: 12,
            color: C.slate,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={field.required ?? false}
            onChange={(e) => onChange({ required: e.target.checked })}
            style={{ accentColor: C.green }}
          />
          Required when filling
        </label>
      )}
    </div>
  );
}

const inspectorLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: C.slate,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  display: 'block',
  marginBottom: 5,
};

const inspectorInput: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid #EBEBEB',
  fontFamily: 'Figtree',
  fontSize: 12,
  outline: 'none',
  background: '#FAFAFA',
};

function NumberCell({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label style={inspectorLabel}>{label}</label>
      <input
        type="number"
        value={Number(value.toFixed(1))}
        min={0}
        max={100}
        step={0.5}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{ ...inspectorInput, textAlign: 'center' }}
      />
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
  const base: React.CSSProperties = {
    position: 'absolute',
    left: `${field.x ?? 0}%`,
    top: `${field.y ?? 0}%`,
    width: `${field.width ?? 10}%`,
    height: `${field.height ?? 5}%`,
    boxSizing: 'border-box',
  };

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

  if (field.type === 'date') {
    return (
      <input
        type="date"
        value={strVal}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...base,
          background: 'rgba(255,255,255,0.85)',
          border: `1px solid ${disabled ? 'transparent' : '#DADADA'}`,
          borderRadius: 4,
          fontFamily: 'Figtree',
          fontSize: 11,
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
      const reader = new FileReader();
      reader.onloadend = () => onChange(String(reader.result));
      reader.readAsDataURL(file);
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
            {!strVal && <Camera size={16} strokeWidth={2} />}
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={readPhoto} />
          </label>
        )}
      </div>
    );
  }

  if (field.type === 'signature') {
    return <OverlaySignature value={strVal} disabled={disabled} onChange={onChange} style={base} />;
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
          fontSize: 11,
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
        fontSize: 12,
        padding: '2px 6px',
        outline: 'none',
        color: '#1a1a1a',
      }}
    />
  );
}

function OverlaySignature({
  value,
  onChange,
  disabled,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  style: React.CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  // Pre-paint an already-saved signature so editing (PIC review) doesn't start
  // blank, and so multi-stroke signing keeps the earlier strokes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (disabled || !canvas || !value || dirty.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  if (disabled) {
    return (
      <div style={{ ...style, border: '1px solid transparent', overflow: 'hidden' }}>
        {value && <img src={value} alt="Signature" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
      </div>
    );
  }

  return (
    <div style={{ ...style }}>
      <canvas
        ref={canvasRef}
        width={400}
        height={160}
        onPointerDown={(e) => {
          e.preventDefault();
          drawing.current = true;
          const ctx = canvasRef.current!.getContext('2d')!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          canvasRef.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          e.preventDefault();
          const ctx = canvasRef.current!.getContext('2d')!;
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.strokeStyle = '#1a1a1a';
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          if (dirty.current) onChange(canvasRef.current!.toDataURL('image/png'));
        }}
        style={{
          width: '100%',
          height: '100%',
          touchAction: 'none',
          background: 'rgba(255,255,255,0.7)',
          border: '1px dashed #CBD5DD',
          borderRadius: 4,
          cursor: 'crosshair',
        }}
      />
    </div>
  );
}

// ── Convenience: which kind is this template? ────────────────────

export const isOverlay = (t: FormTemplate) => (t.kind ?? 'structured') === 'overlay';
