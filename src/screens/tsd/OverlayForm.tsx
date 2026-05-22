import { useEffect, useRef, useState } from 'react';
import { C } from '../../theme';
import { FileText } from 'lucide-react';
import type {
  FieldType,
  FormField,
  FormTemplate,
  FormValues,
} from '../../workOrderStore';

// ── Shared helpers ────────────────────────────────────────────────

const A4_ASPECT = '210 / 297';

function aspectStyle(template: FormTemplate): React.CSSProperties {
  if (template.imageWidth && template.imageHeight) {
    return { aspectRatio: `${template.imageWidth} / ${template.imageHeight}` };
  }
  return { aspectRatio: A4_ASPECT };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const fieldColor = (type: FieldType) =>
  type === 'checkbox' ? C.opal : type === 'textarea' ? C.yellow : C.green;

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selected = template.fields.find((f) => f.id === selectedId) ?? null;

  const uploadFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image (PNG / JPEG). For PDFs, convert to image first.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () =>
        onChange({
          ...template,
          imageSrc: dataUrl,
          imageWidth: img.naturalWidth,
          imageHeight: img.naturalHeight,
        });
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
    const newField: FormField = {
      id,
      type,
      label: type === 'checkbox' ? 'Check' : type === 'textarea' ? 'Notes' : 'Field',
      x: 10,
      y: 10,
      width: type === 'checkbox' ? 3 : type === 'textarea' ? 40 : 30,
      height: type === 'checkbox' ? 3 : type === 'textarea' ? 10 : 4,
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
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onFileSelect}
      />
      <Toolbar onAdd={addField} onReplace={() => fileInputRef.current?.click()} />
      <OverlayCanvas
        template={template}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onUpdate={updateField}
      />
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
        accept="image/*"
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
        PNG or JPEG. For PDFs, convert the page to image first.
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
      {(['text', 'textarea', 'checkbox'] as FieldType[]).map((t) => (
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
          + {t === 'textarea' ? 'Long text' : t === 'text' ? 'Text' : 'Checkbox'}
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

// ── Canvas with drag & resize ─────────────────────────────────────

interface DragState {
  fieldId: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  orig: { x: number; y: number; width: number; height: number };
}

function OverlayCanvas({
  template,
  selectedId,
  onSelect,
  onUpdate,
}: {
  template: FormTemplate;
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
        ...aspectStyle(template),
        userSelect: 'none',
      }}
    >
      <img
        src={template.imageSrc}
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
      {template.fields.map((f) => (
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
  if (!template.imageSrc) {
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
    <div
      style={{
        position: 'relative',
        background: C.white,
        border: '1px solid #EBEBEB',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
        ...aspectStyle(template),
      }}
    >
      <img
        src={template.imageSrc}
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
      {template.fields.map((f) => (
        <OverlayInput
          key={f.id}
          field={f}
          value={values[f.id]}
          onChange={(v) => onChange(f.id, v)}
          disabled={disabled}
        />
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

// ── Convenience: which kind is this template? ────────────────────

export const isOverlay = (t: FormTemplate) => (t.kind ?? 'structured') === 'overlay';
