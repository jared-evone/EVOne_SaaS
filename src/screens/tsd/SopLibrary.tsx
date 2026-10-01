import { useEffect, useMemo, useRef, useState } from 'react';
import { C } from '../../theme';
import { supabase, uploadWithProgress } from '../../lib/supabase';
import { usePermissions } from '../../permissions';
import { useIsMobile } from '../../lib/useIsMobile';
import {
  Search, Plus, Pin, PinOff, FileText, Download, ExternalLink, ChevronLeft, ChevronRight, Pencil,
  Archive, ArchiveRestore, Trash2, History, BookOpen, Clock, X, FolderClosed, Upload,
  Video, FileCode2, Paperclip, Check,
} from 'lucide-react';

const BUCKET = 'tsd-sops';

interface SopCategory { id: string; name: string; sort_order: number; }

interface Sop {
  id: string;
  doc_no: string;
  title: string;
  description: string | null;
  category_id: string | null;
  tags: string[];
  revision: string;
  revision_note: string | null;
  effective_date: string | null;
  review_due: string | null;
  owner: string | null;
  status: 'active' | 'draft' | 'archived';
  pinned: boolean;
  pdf_path: string | null;
  pdf_filename: string | null;
  pdf_size: number | null;
  flag_note: string | null;
  flagged_by: string | null;
  flagged_at: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

interface SopRevision {
  id: string;
  sop_id: string;
  revision: string;
  pdf_path: string;
  pdf_filename: string | null;
  pdf_size: number | null;
  effective_date: string | null;
  note: string | null;
  replaced_at: string;
  replaced_by: string | null;
}

interface SopAttachment {
  id: string;
  sop_id: string;
  kind: 'file' | 'video';
  name: string;
  description: string | null;
  path: string;
  size: number | null;
  mime: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
}

// Light per-SOP attachment index for list badges + search.
interface AttachmentStub { sop_id: string; kind: 'file' | 'video'; name: string; }

type View =
  | { kind: 'all' } | { kind: 'pinned' } | { kind: 'recent' } | { kind: 'review' }
  | { kind: 'drafts' } | { kind: 'archived' }
  | { kind: 'category'; id: string | null };

const todayISO = () => new Date().toISOString().slice(0, 10);

const fmtDate = (s: string | null) =>
  s ? new Date(s.length <= 10 ? `${s}T00:00:00` : s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const fmtSize = (n: number | null) => {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

// Review freshness: overdue once the due date passes, "due soon" within 30 days.
function reviewState(s: Sop): 'overdue' | 'soon' | null {
  if (!s.review_due || s.status === 'archived') return null;
  const t = todayISO();
  if (s.review_due < t) return 'overdue';
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  return s.review_due <= soon.toISOString().slice(0, 10) ? 'soon' : null;
}

// Next number in the library's existing scheme, e.g. SOP-TSD-007 → SOP-TSD-008.
function nextDocNo(sops: Sop[]): string {
  let prefix = 'SOP-TSD-';
  let max = 0;
  let width = 3;
  for (const s of sops) {
    const m = /^(.*?)(\d+)$/.exec(s.doc_no.trim());
    if (!m) continue;
    const n = Number(m[2]);
    if (n >= max) { max = n; prefix = m[1]; width = m[2].length; }
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

// "Rev 2" → "Rev 3"; anything without a trailing number gets " (2)".
function nextRevision(rev: string): string {
  const m = /^(.*?)(\d+)$/.exec(rev.trim());
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${rev.trim() || 'Rev'} (2)`;
}

function addMonthsISO(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function uploadPdf(sopKey: string, file: File, onProgress?: (f: number) => void): Promise<{ path: string; name: string; size: number }> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${sopKey}/${Date.now()}-${safe}`;
  // Force the PDF content type so the viewer iframe renders it inline.
  const pdf = file.type === 'application/pdf' ? file : new File([file], file.name, { type: 'application/pdf' });
  try {
    await uploadWithProgress(BUCKET, path, pdf, onProgress);
  } catch (e) {
    throw new Error(`PDF upload failed: ${(e as Error).message}`);
  }
  return { path, name: file.name, size: file.size };
}

// Matches the tsd-sops bucket's file_size_limit (enforced server-side too).
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_UPLOAD_LABEL = '2 GB';
const tooBig = (f: File) => f.size > MAX_UPLOAD_BYTES;
const tooBigMsg = (files: File[]) =>
  `${files.map((f) => `${f.name} (${fmtSize(f.size)})`).join(', ')} ${files.length === 1 ? 'is' : 'are'} over the ${MAX_UPLOAD_LABEL} per-file limit — compress or trim ${files.length === 1 ? 'it' : 'them'} first.`;

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|ogv|avi|mkv|wmv|3gp)$/i;
const isVideoFile = (f: File) => f.type.startsWith('video/') || VIDEO_EXT.test(f.name);

// Upload one attachment (programme file or video) with progress, then index it.
async function uploadAttachment(sopId: string, file: File, me: string, onProgress: (f: number) => void): Promise<void> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${sopId}/attachments/${Date.now()}-${safe}`;
  await uploadWithProgress(BUCKET, path, file, onProgress);
  const { error } = await supabase.from('tsd_sop_attachments').insert({
    sop_id: sopId, kind: isVideoFile(file) ? 'video' : 'file', name: file.name,
    path, size: file.size, mime: file.type || null, uploaded_by: me,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`Could not save ${file.name}: ${error.message}`);
  }
}

interface UploadState { name: string; index: number; total: number; fraction: number; }

function UploadProgress({ state }: { state: UploadState }) {
  const pct = Math.round(state.fraction * 100);
  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: C.slate }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
          Uploading {state.name}{state.total > 1 ? ` (${state.index} of ${state.total})` : ''}
        </span>
        <span style={{ fontWeight: 700, color: C.green }}>{pct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: '#E0E5E9', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: C.green, transition: 'width .2s' }} />
      </div>
    </div>
  );
}

// Multi-file picker for programme files + videos (any type).
function AttachmentDrop({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const add = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const big = incoming.filter(tooBig);
    setRejected(big.length ? tooBigMsg(big) : null);
    const next = [...files];
    for (const f of incoming) if (!tooBig(f) && !next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    onChange(next);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
        onClick={() => ref.current?.click()}
        style={{ border: '1.5px dashed #CBD5DC', background: C.seasalt, borderRadius: 14, padding: '14px 16px', textAlign: 'center', cursor: 'pointer', fontSize: 13, color: C.slate }}>
        <input ref={ref} type="file" multiple style={{ display: 'none' }} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <Paperclip size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />
        Drop programme files and videos here, or click to choose — any file type, up to {MAX_UPLOAD_LABEL} each
      </div>
      {rejected && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>{rejected}</div>}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '7px 10px', fontSize: 12.5 }}>
              {isVideoFile(f) ? <Video size={14} color={C.opal} /> : <FileCode2 size={14} color={C.slate} />}
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1a1a1a', fontWeight: 600 }}>{f.name}</span>
              <span style={{ color: C.slate, fontSize: 11, whiteSpace: 'nowrap' }}>{isVideoFile(f) ? 'Video' : 'File'} · {fmtSize(f.size)}</span>
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} title="Remove"
                style={{ border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', display: 'inline-flex', padding: 2 }}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function signedUrl(path: string, download?: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600, download ? { download } : undefined);
  return data?.signedUrl ?? null;
}

const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
const input: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };

function ReviewBadge({ sop }: { sop: Sop }) {
  const st = reviewState(sop);
  if (!st) return null;
  const overdue = st === 'overdue';
  return (
    <span title={`Review due ${fmtDate(sop.review_due)}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap',
        background: overdue ? '#FDEAEA' : '#FFF8E1', color: overdue ? '#C0321A' : '#B07D00' }}>
      <Clock size={10} strokeWidth={2.5} /> {overdue ? 'Review overdue' : 'Review due soon'}
    </span>
  );
}

function StatusTag({ sop }: { sop: Sop }) {
  if (sop.status === 'active') return null;
  const draft = sop.status === 'draft';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: draft ? '#F0E8FF' : '#F3F3F3', color: draft ? '#6B21A8' : '#767B77', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {draft ? 'Draft' : 'Archived'}
    </span>
  );
}

// ── Library ───────────────────────────────────────────────────────

export function SopLibrary() {
  const { can, user } = usePermissions();
  // SOP admin = delete permission on the SOP Library. Only admins upload, edit,
  // revise, pin, archive, delete or manage categories; everyone else reads.
  const canEdit = can('tsd_sop', 'can_delete');
  const canDelete = canEdit;
  const isMobile = useIsMobile();
  const me = user.full_name || user.email;

  const [sops, setSops] = useState<Sop[]>([]);
  const [categories, setCategories] = useState<SopCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: 'new' } | { mode: 'edit'; sop: Sop } | null>(null);
  const [manageCats, setManageCats] = useState(false);

  const [stubs, setStubs] = useState<AttachmentStub[]>([]);

  const fetchAll = async () => {
    const [{ data: s, error: sErr }, { data: c }, { data: a }] = await Promise.all([
      supabase.from('tsd_sops').select('*').order('doc_no'),
      supabase.from('tsd_sop_categories').select('*').order('sort_order').order('name'),
      supabase.from('tsd_sop_attachments').select('sop_id, kind, name'),
    ]);
    if (sErr) setError(sErr.message);
    setSops((s as Sop[]) ?? []);
    setCategories((c as SopCategory[]) ?? []);
    setStubs((a as AttachmentStub[]) ?? []);
    setLoading(false);
  };
  const attachCounts = useMemo(() => {
    const m = new Map<string, { files: number; videos: number; names: string }>();
    for (const a of stubs) {
      const e = m.get(a.sop_id) ?? { files: 0, videos: 0, names: '' };
      if (a.kind === 'video') e.videos++; else e.files++;
      e.names += ` ${a.name}`;
      m.set(a.sop_id, e);
    }
    return m;
  }, [stubs]);
  useEffect(() => { void fetchAll(); }, []);

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Uncategorised';

  // Readers see active SOPs only; editors also see drafts (archived lives in its own view).
  const readable = sops.filter((s) => s.status === 'active' || (canEdit && s.status === 'draft'));

  const counts = {
    all: readable.length,
    pinned: readable.filter((s) => s.pinned).length,
    review: readable.filter((s) => reviewState(s) !== null).length,
    drafts: sops.filter((s) => s.status === 'draft').length,
    archived: sops.filter((s) => s.status === 'archived').length,
    uncategorised: readable.filter((s) => !s.category_id || !categories.some((c) => c.id === s.category_id)).length,
  };
  const catCount = (id: string) => readable.filter((s) => s.category_id === id).length;

  const inView = (s: Sop): boolean => {
    switch (view.kind) {
      case 'all': case 'recent': return readable.includes(s);
      case 'pinned': return readable.includes(s) && s.pinned;
      case 'review': return readable.includes(s) && reviewState(s) !== null;
      case 'drafts': return s.status === 'draft';
      case 'archived': return s.status === 'archived';
      case 'category':
        return readable.includes(s) && (view.id === null
          ? (!s.category_id || !categories.some((c) => c.id === s.category_id))
          : s.category_id === view.id);
    }
  };

  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (s: Sop) => {
    if (tagFilter && !s.tags.includes(tagFilter)) return false;
    if (terms.length === 0) return true;
    const hay = [s.doc_no, s.title, s.description ?? '', s.owner ?? '', catName(s.category_id), ...s.tags, attachCounts.get(s.id)?.names ?? ''].join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  };

  // Search spans the whole readable library regardless of the selected view.
  const searching = terms.length > 0;
  const results = (searching ? readable : sops.filter(inView)).filter(matches);
  const sorted = view.kind === 'recent' && !searching
    ? [...results].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 20)
    : [...results].sort((a, b) => a.doc_no.localeCompare(b.doc_no, undefined, { numeric: true }));

  const viewTitle = searching ? `Search results for "${search.trim()}"` : (() => {
    switch (view.kind) {
      case 'all': return 'All SOPs';
      case 'pinned': return 'Pinned';
      case 'recent': return 'Recently updated';
      case 'review': return 'Review due';
      case 'drafts': return 'Drafts';
      case 'archived': return 'Archived';
      case 'category': return view.id === null ? 'Uncategorised' : catName(view.id);
    }
  })();

  const tagsInView = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of (searching ? readable : sops.filter(inView))) for (const t of s.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 16);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sops, view, searching, categories, canEdit]);

  // Group the "All" listing by category so it reads like a wiki table of contents.
  const grouped = view.kind === 'all' && !searching && !tagFilter;
  const pinnedCards = view.kind === 'all' && !searching && !tagFilter ? readable.filter((s) => s.pinned) : [];

  const open = openId ? sops.find((s) => s.id === openId) ?? null : null;

  const selectView = (v: View) => { setView(v); setOpenId(null); setTagFilter(null); };

  const railItem = (active: boolean, onClick: () => void, icon: React.ReactNode, text: string, count?: number, tone?: 'warn' | 'danger') => (
    <button onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 10, border: 'none',
        background: active ? C.honeydew : 'transparent', color: active ? C.green : '#1a1a1a',
        fontFamily: 'Figtree', fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer' }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#FAFAFA'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ display: 'inline-flex', color: active ? C.green : C.slate, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
      {count !== undefined && count > 0 && (
        <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 99,
          background: tone === 'danger' ? '#FDEAEA' : tone === 'warn' ? '#FFF8E1' : active ? C.white : '#F3F3F3',
          color: tone === 'danger' ? '#C0321A' : tone === 'warn' ? '#B07D00' : C.slate }}>{count}</span>
      )}
    </button>
  );

  const isView = (k: View['kind'], id?: string | null) =>
    !searching && view.kind === k && (k !== 'category' || (view as { id: string | null }).id === id);

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: C.slate, fontSize: 13 }}>Loading SOP library…</div>;
  }

  const rail = (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 10, display: 'flex', flexDirection: 'column', gap: 2, alignSelf: 'start', position: isMobile ? 'static' : 'sticky', top: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 12px 4px' }}>Library</div>
      {railItem(isView('all'), () => selectView({ kind: 'all' }), <BookOpen size={15} />, 'All SOPs', counts.all)}
      {railItem(isView('pinned'), () => selectView({ kind: 'pinned' }), <Pin size={15} />, 'Pinned', counts.pinned)}
      {railItem(isView('recent'), () => selectView({ kind: 'recent' }), <Clock size={15} />, 'Recently updated')}
      {railItem(isView('review'), () => selectView({ kind: 'review' }), <History size={15} />, 'Review due', counts.review, 'warn')}
      {canEdit && railItem(isView('drafts'), () => selectView({ kind: 'drafts' }), <Pencil size={15} />, 'Drafts', counts.drafts)}
      {canEdit && railItem(isView('archived'), () => selectView({ kind: 'archived' }), <Archive size={15} />, 'Archived', counts.archived)}

      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 12px 4px' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: C.slate, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Categories</span>
        {canEdit && (
          <button onClick={() => setManageCats((v) => !v)}
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
            {manageCats ? 'Done' : 'Manage'}
          </button>
        )}
      </div>
      {manageCats
        ? <CategoryManager categories={categories} sops={sops} onChanged={fetchAll} />
        : <>
            {categories.map((c) => railItem(isView('category', c.id), () => selectView({ kind: 'category', id: c.id }), <FolderClosed size={15} />, c.name, catCount(c.id)))}
            {counts.uncategorised > 0 && railItem(isView('category', null), () => selectView({ kind: 'category', id: null }), <FolderClosed size={15} />, 'Uncategorised', counts.uncategorised)}
          </>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>}

      {/* Search-first header, the way wiki home pages lead */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setOpenId(null); }}
            placeholder="Search SOPs by title, number, tag, owner, category or file name…"
            style={{ width: '100%', padding: '11px 36px 11px 40px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 14, outline: 'none', background: C.seasalt, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={16} /></span>
          {search && (
            <button onClick={() => setSearch('')} title="Clear search"
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: 99, border: 'none', background: '#EBEBEB', color: C.slate, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
              <X size={12} strokeWidth={2.5} />
            </button>
          )}
        </div>
        <div style={{ fontSize: 12, color: C.slate, whiteSpace: 'nowrap' }}>{counts.all} SOP{counts.all === 1 ? '' : 's'} · {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}</div>
        {canEdit && (
          <button onClick={() => setModal({ mode: 'new' })}
            style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <Upload size={14} strokeWidth={2.25} /> Upload SOP
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '250px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        {rail}

        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {open ? (
            <SopViewer key={open.id} sop={open} categoryName={catName(open.category_id)} canEdit={canEdit} canDelete={canDelete} me={me}
              onBack={() => setOpenId(null)} onEdit={() => setModal({ mode: 'edit', sop: open })}
              onChanged={fetchAll} onDeleted={() => { setOpenId(null); void fetchAll(); }} />
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>{viewTitle}</div>
                <div style={{ fontSize: 12, color: C.slate }}>{sorted.length} document{sorted.length === 1 ? '' : 's'}</div>
              </div>

              {tagsInView.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 2 }}>Tags</span>
                  {tagsInView.map(([t, n]) => {
                    const on = tagFilter === t;
                    return (
                      <button key={t} onClick={() => setTagFilter(on ? null : t)}
                        style={{ padding: '3px 10px', borderRadius: 99, border: `1px solid ${on ? C.green : '#EBEBEB'}`, background: on ? C.green : C.white, color: on ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        #{t} <span style={{ opacity: 0.7 }}>{n}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {pinnedCards.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                  {pinnedCards.map((s) => (
                    <button key={s.id} onClick={() => setOpenId(s.id)}
                      style={{ textAlign: 'left', background: C.white, border: '1px solid #EBEBEB', borderRadius: 14, padding: '14px 16px', cursor: 'pointer', fontFamily: 'Figtree', display: 'flex', flexDirection: 'column', gap: 6, borderTop: `3px solid ${C.green}` }}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,.06)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Pin size={12} color={C.green} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>{s.doc_no}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: C.slate }}>{s.revision}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.3 }}>{s.title}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.slate }}>
                        <span>{catName(s.category_id)}</span>
                        {(attachCounts.get(s.id)?.videos ?? 0) > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Video size={11} /> {attachCounts.get(s.id)!.videos}</span>}
                        {(attachCounts.get(s.id)?.files ?? 0) > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><FileCode2 size={11} /> {attachCounts.get(s.id)!.files}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {sorted.length === 0 ? (
                <div style={{ background: C.white, borderRadius: 16, border: '1px dashed #EBEBEB', padding: '48px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <BookOpen size={32} strokeWidth={1.5} color={C.slate} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{searching || tagFilter ? 'No SOPs match' : sops.length === 0 ? 'The SOP library is empty' : 'Nothing here yet'}</div>
                  <div style={{ fontSize: 12, color: C.slate, maxWidth: 360, lineHeight: 1.5 }}>
                    {searching || tagFilter ? 'Try a different word, or clear the tag filter.' : canEdit ? 'Upload the first SOP PDF with the Upload SOP button.' : 'SOPs will appear here once they are uploaded.'}
                  </div>
                </div>
              ) : grouped ? (
                [...categories.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: 'Uncategorised' }].map((g) => {
                  const list = sorted.filter((s) => g.id === null
                    ? (!s.category_id || !categories.some((c) => c.id === s.category_id))
                    : s.category_id === g.id);
                  if (list.length === 0) return null;
                  return (
                    <div key={g.id ?? 'none'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <button onClick={() => selectView({ kind: 'category', id: g.id })}
                        style={{ alignSelf: 'flex-start', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'Figtree', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
                        <FolderClosed size={14} color={C.slate} /> {g.name} <span style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>· {list.length}</span>
                      </button>
                      <SopList sops={list} catName={catName} showCategory={false} onOpen={setOpenId} attachCounts={attachCounts} />
                    </div>
                  );
                })
              ) : (
                <SopList sops={sorted} catName={catName} showCategory onOpen={setOpenId} attachCounts={attachCounts} />
              )}
            </>
          )}
        </div>
      </div>

      {modal && (
        <SopModal
          mode={modal.mode}
          sop={modal.mode === 'edit' ? modal.sop : null}
          categories={categories}
          defaultCategory={view.kind === 'category' ? view.id : null}
          suggestedDocNo={nextDocNo(sops)}
          existingDocNos={sops.map((s) => s.doc_no)}
          me={me}
          onClose={() => setModal(null)}
          onSaved={(id) => { setModal(null); void fetchAll().then(() => setOpenId(id)); }}
        />
      )}
    </div>
  );
}

// ── Document list ─────────────────────────────────────────────────

function SopList({ sops, catName, showCategory, onOpen, attachCounts }: { sops: Sop[]; catName: (id: string | null) => string; showCategory: boolean; onOpen: (id: string) => void; attachCounts: Map<string, { files: number; videos: number }> }) {
  return (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
      {sops.map((s, i) => (
        <button key={s.id} onClick={() => onOpen(s.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: '13px 16px', border: 'none', borderTop: i === 0 ? 'none' : '1px solid #F3F3F3', background: 'transparent', cursor: 'pointer', fontFamily: 'Figtree' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FDEAEA', color: '#C0321A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <FileText size={17} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{s.doc_no}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{s.title}</span>
              {s.pinned && <Pin size={12} color={C.green} />}
              <StatusTag sop={s} />
              <ReviewBadge sop={s} />
            </div>
            {(s.description || s.tags.length > 0 || showCategory) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 12, color: C.slate }}>
                {showCategory && <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{catName(s.category_id)}</span>}
                {showCategory && s.description && <span>·</span>}
                {s.description && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{s.description}</span>}
                {s.tags.slice(0, 3).map((t) => (
                  <span key={t} style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 6, background: C.seasalt, color: C.slate, whiteSpace: 'nowrap', flexShrink: 0 }}>#{t}</span>
                ))}
              </div>
            )}
          </div>
          {(() => {
            const ac = attachCounts.get(s.id);
            if (!ac) return null;
            return (
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {ac.videos > 0 && (
                  <span title={`${ac.videos} video${ac.videos === 1 ? '' : 's'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#E3F0FF', color: '#1A62C0' }}>
                    <Video size={11} strokeWidth={2.5} /> {ac.videos}
                  </span>
                )}
                {ac.files > 0 && (
                  <span title={`${ac.files} programme file${ac.files === 1 ? '' : 's'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#F3F3F3', color: '#767B77' }}>
                    <FileCode2 size={11} strokeWidth={2.5} /> {ac.files}
                  </span>
                )}
              </div>
            );
          })()}
          <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>{s.revision}</span>
            <span style={{ fontSize: 11, color: C.slate, whiteSpace: 'nowrap' }}>Updated {fmtDate(s.updated_at)}</span>
          </div>
          <ChevronRight size={16} color={C.slate} style={{ flexShrink: 0 }} />
        </button>
      ))}
    </div>
  );
}

// ── Document viewer ───────────────────────────────────────────────

function SopViewer({ sop, categoryName, canEdit, canDelete, me, onBack, onEdit, onChanged, onDeleted }: {
  sop: Sop; categoryName: string; canEdit: boolean; canDelete: boolean; me: string;
  onBack: () => void; onEdit: () => void; onChanged: () => Promise<void>; onDeleted: () => void;
}) {
  const isMobile = useIsMobile();
  const [url, setUrl] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<SopRevision[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [attachments, setAttachments] = useState<SopAttachment[]>([]);
  const [tab, setTab] = useState<'doc' | 'videos' | 'files' | null>(null);

  const loadAttachments = async () => {
    const { data } = await supabase.from('tsd_sop_attachments').select('*').eq('sop_id', sop.id).order('uploaded_at');
    const list = (data as SopAttachment[]) ?? [];
    setAttachments(list);
    return list;
  };

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (sop.pdf_path) void signedUrl(sop.pdf_path).then((u) => { if (!cancelled) setUrl(u); });
    void supabase.from('tsd_sop_revisions').select('*').eq('sop_id', sop.id).order('replaced_at', { ascending: false })
      .then(({ data }) => { if (!cancelled) setRevisions((data as SopRevision[]) ?? []); });
    void loadAttachments().then((list) => {
      if (cancelled) return;
      // Land on the procedure PDF; video/file-only SOPs open on what they have.
      setTab((t) => t ?? (sop.pdf_path ? 'doc' : list.some((a) => a.kind === 'video') ? 'videos' : list.length ? 'files' : 'doc'));
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sop.id, sop.pdf_path]);

  const videos = attachments.filter((a) => a.kind === 'video');
  const files = attachments.filter((a) => a.kind === 'file');
  const activeTab = tab ?? 'doc';

  const patch = async (p: Partial<Sop>) => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from('tsd_sops').update({ ...p, updated_at: new Date().toISOString(), updated_by: me }).eq('id', sop.id);
    if (error) setErr(error.message);
    await onChanged();
    setBusy(false);
  };

  const download = async (path: string, name: string | null) => {
    const u = await signedUrl(path, name ?? 'SOP.pdf');
    if (!u) { setErr('Could not create a download link.'); return; }
    const a = document.createElement('a');
    a.href = u;
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDelete = async () => {
    setBusy(true);
    const paths = [sop.pdf_path, ...revisions.map((r) => r.pdf_path), ...attachments.map((a) => a.path)].filter((p): p is string => !!p);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    const { error } = await supabase.from('tsd_sops').delete().eq('id', sop.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDeleted();
  };

  const metaRow = (k: string, v: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: '1px solid #F3F3F3', fontSize: 12.5 }}>
      <span style={{ color: C.slate }}>{k}</span>
      <span style={{ color: '#1a1a1a', fontWeight: 600, textAlign: 'right', minWidth: 0 }}>{v}</span>
    </div>
  );

  const actionBtn = (primary = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', borderRadius: 10,
    border: primary ? 'none' : '1px solid #EBEBEB', background: primary ? C.green : C.white, color: primary ? C.white : C.slate,
    fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.slate, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
          <ChevronLeft size={14} strokeWidth={2.5} /> SOP Library
        </button>
        <span>›</span><span>{categoryName}</span><span>›</span><span style={{ fontWeight: 700, color: '#1a1a1a' }}>{sop.doc_no}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.02em' }}>{sop.title}</span>
            <StatusTag sop={sop} />
            <ReviewBadge sop={sop} />
          </div>
          {sop.description && <div style={{ fontSize: 13, color: C.slate, marginTop: 6, lineHeight: 1.55, maxWidth: 820 }}>{sop.description}</div>}
        </div>
      </div>

      {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{err}</div>}

      {confirmDelete && (
        <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete {sop.doc_no}, all {revisions.length + 1} version{revisions.length ? 's' : ''}{attachments.length ? ` and ${attachments.length} attached file${attachments.length === 1 ? '' : 's'}` : ''}? This can't be undone — consider Archive instead.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmDelete(false)} style={actionBtn()}>Cancel</button>
            <button onClick={() => void handleDelete()} disabled={busy} style={{ ...actionBtn(), border: 'none', background: '#C0321A', color: C.white }}>{busy ? 'Deleting…' : 'Yes, delete'}</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 300px', gap: 16, alignItems: 'start' }}>
        {/* Procedure / videos / programme files */}
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden', height: isMobile ? 'auto' : '76vh', minHeight: 420, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 4, padding: 6, borderBottom: '1px solid #F3F3F3', background: C.seasalt, flexWrap: 'wrap' }}>
            {([
              ['doc', 'Procedure', <FileText key="d" size={13} />, sop.pdf_path ? null : 0],
              ['videos', 'Videos', <Video key="v" size={13} />, videos.length],
              ['files', 'Programme files', <FileCode2 key="f" size={13} />, files.length],
            ] as const).map(([k, lbl, icon, n]) => {
              const on = activeTab === k;
              return (
                <button key={k} onClick={() => setTab(k)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: 'none',
                    background: on ? C.white : 'transparent', color: on ? C.green : C.slate, boxShadow: on ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                    fontFamily: 'Figtree', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  {icon} {lbl}
                  {n !== null && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '0 7px', borderRadius: 99, background: on ? C.honeydew : '#EBEBEB', color: on ? C.green : C.slate }}>{n}</span>}
                </button>
              );
            })}
          </div>
          {activeTab === 'doc' ? (
            !sop.pdf_path ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: C.slate, fontSize: 13, padding: 24, textAlign: 'center' }}>
                <FileText size={32} strokeWidth={1.5} />
                No procedure PDF attached{canEdit ? ' — use "Attach PDF" to add one.' : '.'}
              </div>
            ) : url ? (
              <iframe src={url} title={sop.title} style={{ flex: 1, width: '100%', border: 'none', display: 'block', minHeight: isMobile ? 420 : 0 }} />
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.slate, fontSize: 13 }}>Loading document…</div>
            )
          ) : (
            <AttachmentsPanel kind={activeTab === 'videos' ? 'video' : 'file'} sopId={sop.id} items={activeTab === 'videos' ? videos : files}
              canEdit={canEdit} me={me} onChanged={async () => { await loadAttachments(); await onChanged(); }} />
          )}
        </div>

        {/* Details + actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')} disabled={!url} style={actionBtn(true)}>
                <ExternalLink size={13} /> Open
              </button>
              <button onClick={() => sop.pdf_path && void download(sop.pdf_path, sop.pdf_filename)} disabled={!sop.pdf_path} style={actionBtn()}>
                <Download size={13} /> Download
              </button>
            </div>
            {canEdit && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button onClick={() => setRevising(true)} disabled={busy} style={actionBtn()}><Upload size={13} /> {sop.pdf_path ? 'New revision' : 'Attach PDF'}</button>
                <button onClick={onEdit} disabled={busy} style={actionBtn()}><Pencil size={13} /> Edit details</button>
                <button onClick={() => void patch({ pinned: !sop.pinned })} disabled={busy} style={actionBtn()}>
                  {sop.pinned ? <><PinOff size={13} /> Unpin</> : <><Pin size={13} /> Pin</>}
                </button>
                {sop.status === 'archived'
                  ? <button onClick={() => void patch({ status: 'active' })} disabled={busy} style={actionBtn()}><ArchiveRestore size={13} /> Restore</button>
                  : <button onClick={() => void patch({ status: 'archived', pinned: false })} disabled={busy} style={actionBtn()}><Archive size={13} /> Archive</button>}
              </div>
            )}
            {canDelete && !confirmDelete && (
              <button onClick={() => setConfirmDelete(true)} style={{ ...actionBtn(), color: '#C0321A', border: '1px solid #FDEAEA', background: 'transparent' }}>
                <Trash2 size={13} /> Delete SOP
              </button>
            )}
          </div>

          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '12px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Document control</div>
            {metaRow('Document no.', <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{sop.doc_no}</span>)}
            {metaRow('Revision', <span style={{ color: C.green }}>{sop.revision}</span>)}
            {metaRow('Effective', fmtDate(sop.effective_date))}
            {metaRow('Review due', <span style={{ color: reviewState(sop) === 'overdue' ? '#C0321A' : reviewState(sop) === 'soon' ? '#B07D00' : '#1a1a1a' }}>{fmtDate(sop.review_due)}</span>)}
            {metaRow('Owner', sop.owner || '—')}
            {metaRow('Category', categoryName)}
            {metaRow('File', <span title={sop.pdf_filename ?? ''} style={{ display: 'inline-block', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>{sop.pdf_filename ?? '—'}{sop.pdf_size ? ` · ${fmtSize(sop.pdf_size)}` : ''}</span>)}
            {metaRow('Last updated', `${fmtDate(sop.updated_at)}${sop.updated_by ? ` · ${sop.updated_by}` : ''}`)}
            {sop.tags.length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', paddingTop: 10 }}>
                {sop.tags.map((t) => <span key={t} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: C.seasalt, color: C.slate }}>#{t}</span>)}
              </div>
            )}
          </div>

          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '12px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <History size={12} /> Revision history
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '7px 0', borderBottom: revisions.length ? '1px solid #F3F3F3' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.green }}>{sop.revision}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: '#E4F3E3', color: '#1B512D' }}>Current</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: C.slate }}>{fmtDate(sop.effective_date)}</span>
                </div>
                {sop.revision_note && <div style={{ fontSize: 11.5, color: C.slate, marginTop: 3, lineHeight: 1.45 }}>{sop.revision_note}</div>}
              </div>
              {revisions.map((r, i) => (
                <div key={r.id} style={{ padding: '7px 0', borderBottom: i < revisions.length - 1 ? '1px solid #F3F3F3' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1a1a1a' }}>{r.revision}</span>
                    <span style={{ fontSize: 11, color: C.slate }}>{fmtDate(r.effective_date)}</span>
                    <button onClick={() => void download(r.pdf_path, r.pdf_filename)} title={`Download ${r.revision}`}
                      style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: C.green, cursor: 'pointer', display: 'inline-flex', padding: 2 }}>
                      <Download size={13} />
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>Superseded {fmtDate(r.replaced_at)}{r.replaced_by ? ` by ${r.replaced_by}` : ''}</div>
                  {r.note && <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2, lineHeight: 1.45 }}>{r.note}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {revising && (
        <ReviseModal sop={sop} me={me} onClose={() => setRevising(false)}
          onSaved={async () => {
            setRevising(false);
            await onChanged();
            const { data } = await supabase.from('tsd_sop_revisions').select('*').eq('sop_id', sop.id).order('replaced_at', { ascending: false });
            setRevisions((data as SopRevision[]) ?? []);
          }} />
      )}
    </div>
  );
}

// ── Videos / programme files ──────────────────────────────────────

function AttachmentsPanel({ kind, sopId, items, canEdit, me, onChanged }: {
  kind: 'file' | 'video';
  sopId: string;
  items: SopAttachment[];
  canEdit: boolean;
  me: string;
  onChanged: () => Promise<void>;
}) {
  const isVideo = kind === 'video';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = items.find((a) => a.id === selectedId) ?? items[0] ?? null;

  useEffect(() => {
    if (!isVideo || !selected) { setVideoUrl(null); return; }
    let cancelled = false;
    setVideoUrl(null);
    void signedUrl(selected.path).then((u) => { if (!cancelled) setVideoUrl(u); });
    return () => { cancelled = true; };
  }, [isVideo, selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const all = Array.from(list);
    const big = all.filter(tooBig);
    const queue = all.filter((f) => !tooBig(f));
    setErr(big.length ? tooBigMsg(big) : null);
    if (queue.length === 0) return;
    try {
      for (let i = 0; i < queue.length; i++) {
        const f = queue[i];
        await uploadAttachment(sopId, f, me, (fr) => setProgress({ name: f.name, index: i + 1, total: queue.length, fraction: fr }));
      }
    } catch (e) {
      setErr((e as Error).message);
    }
    setProgress(null);
    await onChanged();
  };

  const download = async (a: SopAttachment) => {
    const u = await signedUrl(a.path, a.name);
    if (!u) { setErr('Could not create a download link.'); return; }
    const el = document.createElement('a');
    el.href = u;
    el.rel = 'noreferrer';
    document.body.appendChild(el);
    el.click();
    el.remove();
  };

  const remove = async (a: SopAttachment) => {
    setErr(null);
    const { error } = await supabase.from('tsd_sop_attachments').delete().eq('id', a.id);
    if (error) { setErr(error.message); return; }
    await supabase.storage.from(BUCKET).remove([a.path]);
    setConfirmId(null);
    if (selectedId === a.id) setSelectedId(null);
    await onChanged();
  };

  const saveDesc = async (a: SopAttachment) => {
    const { error } = await supabase.from('tsd_sop_attachments').update({ description: descDraft.trim() || null }).eq('id', a.id);
    if (error) { setErr(error.message); return; }
    setEditId(null);
    await onChanged();
  };

  const extOf = (name: string) => (/\.([A-Za-z0-9]{1,6})$/.exec(name)?.[1] ?? '').toUpperCase();
  const iconBtn: React.CSSProperties = { border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', padding: 5, borderRadius: 8 };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: C.slate }}>
          {isVideo
            ? `How-to and reference videos for this procedure — play here or download. Up to ${MAX_UPLOAD_LABEL} each.`
            : `Charger programme / firmware / config files that go with this procedure. Up to ${MAX_UPLOAD_LABEL} each.`}
        </div>
        {canEdit && (
          <>
            <input ref={inputRef} type="file" multiple accept={isVideo ? 'video/*' : undefined} style={{ display: 'none' }}
              onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
            <button onClick={() => inputRef.current?.click()} disabled={!!progress}
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: progress ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
              <Plus size={13} strokeWidth={2.5} /> {isVideo ? 'Add videos' : 'Add files'}
            </button>
          </>
        )}
      </div>

      {progress && <UploadProgress state={progress} />}
      {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{err}</div>}

      {items.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: C.slate, fontSize: 13, padding: 24, textAlign: 'center',
          border: canEdit ? '1.5px dashed #CBD5DC' : 'none', borderRadius: 14, cursor: canEdit ? 'pointer' : 'default' }}
          onClick={() => canEdit && inputRef.current?.click()}
          onDragOver={(e) => { if (canEdit) e.preventDefault(); }}
          onDrop={(e) => { if (!canEdit) return; e.preventDefault(); void addFiles(e.dataTransfer.files); }}>
          {isVideo ? <Video size={32} strokeWidth={1.5} /> : <FileCode2 size={32} strokeWidth={1.5} />}
          {isVideo ? 'No videos yet.' : 'No programme files yet.'}
          {canEdit && <span style={{ fontSize: 12 }}>Drop files here or click to add.</span>}
        </div>
      ) : (
        <>
          {isVideo && selected && (
            <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 220 }}>
              {videoUrl
                ? <video key={videoUrl} src={videoUrl} controls preload="metadata" playsInline style={{ width: '100%', maxHeight: '48vh', display: 'block', background: '#000' }} />
                : <span style={{ color: '#ccc', fontSize: 12 }}>Loading video…</span>}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            onDragOver={(e) => { if (canEdit) e.preventDefault(); }}
            onDrop={(e) => { if (!canEdit) return; e.preventDefault(); void addFiles(e.dataTransfer.files); }}>
            {items.map((a) => {
              const isSel = isVideo && selected?.id === a.id;
              return (
                <div key={a.id}
                  onClick={() => { if (isVideo) setSelectedId(a.id); }}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 12,
                    border: isSel ? `1.5px solid ${C.green}` : '1px solid #EBEBEB', background: isSel ? C.honeydew : C.white,
                    cursor: isVideo ? 'pointer' : 'default' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isVideo ? '#E3F0FF' : '#F3F3F3', color: isVideo ? '#1A62C0' : '#767B77', fontSize: 9, fontWeight: 700 }}>
                    {isVideo ? <Video size={16} /> : (extOf(a.name) || <FileCode2 size={16} />)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div title={a.name} style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                    {editId === a.id ? (
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                        <input value={descDraft} onChange={(e) => setDescDraft(e.target.value)} autoFocus placeholder="e.g. Firmware v2.3 for HiCi 120kW — flash via USB"
                          onKeyDown={(e) => { if (e.key === 'Enter') void saveDesc(a); if (e.key === 'Escape') setEditId(null); }}
                          style={{ ...input, padding: '6px 10px', fontSize: 12 }} />
                        <button onClick={() => void saveDesc(a)} title="Save" style={{ ...iconBtn, background: C.green, color: C.white, padding: '0 10px' }}><Check size={13} strokeWidth={2.5} /></button>
                      </div>
                    ) : a.description ? (
                      <div style={{ fontSize: 12, color: '#1a1a1a', marginTop: 2, lineHeight: 1.45 }}>{a.description}</div>
                    ) : null}
                    <div style={{ fontSize: 11, color: C.slate, marginTop: 3 }}>
                      {fmtSize(a.size)}{a.size ? ' · ' : ''}Added {fmtDate(a.uploaded_at)}{a.uploaded_by ? ` by ${a.uploaded_by}` : ''}
                    </div>
                    {confirmId === a.id && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, background: '#FDEAEA', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#C0321A', fontWeight: 600 }}
                        onClick={(e) => e.stopPropagation()}>
                        <span style={{ flex: 1 }}>Delete this {isVideo ? 'video' : 'file'}?</span>
                        <button onClick={() => setConfirmId(null)} style={{ border: '1px solid #EBEBEB', background: C.white, color: C.slate, borderRadius: 6, padding: '3px 10px', fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                        <button onClick={() => void remove(a)} style={{ border: 'none', background: '#C0321A', color: C.white, borderRadius: 6, padding: '3px 10px', fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Yes, delete</button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => void download(a)} title="Download" style={{ ...iconBtn, color: C.green }}><Download size={15} /></button>
                    {canEdit && (
                      <>
                        <button onClick={() => { setEditId(a.id); setDescDraft(a.description ?? ''); }} title="Edit description" style={{ ...iconBtn, color: C.slate }}><Pencil size={14} /></button>
                        <button onClick={() => setConfirmId(a.id)} title="Delete" style={{ ...iconBtn, color: '#C0321A' }}><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Category manager (inline in the rail) ─────────────────────────

function CategoryManager({ categories, sops, onChanged }: { categories: SopCategory[]; sops: Sop[]; onChanged: () => Promise<void> }) {
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    const sort = Math.max(0, ...categories.map((c) => c.sort_order)) + 1;
    const { error } = await supabase.from('tsd_sop_categories').insert({ name, sort_order: sort });
    if (error) { setErr(error.message.includes('duplicate') ? 'That category already exists.' : error.message); return; }
    setNewName('');
    setErr(null);
    await onChanged();
  };
  const rename = async (id: string) => {
    const name = draft.trim();
    if (!name) { setEditing(null); return; }
    const { error } = await supabase.from('tsd_sop_categories').update({ name }).eq('id', id);
    if (error) { setErr(error.message); return; }
    setEditing(null);
    await onChanged();
  };
  // SOPs in a removed category fall back to Uncategorised (FK on delete set null).
  const remove = async (id: string) => {
    const { error } = await supabase.from('tsd_sop_categories').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    setConfirmId(null);
    await onChanged();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 4px 6px' }}>
      {categories.map((c) => {
        const n = sops.filter((s) => s.category_id === c.id).length;
        return (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {editing === c.id ? (
              <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') void rename(c.id); if (e.key === 'Escape') setEditing(null); }}
                onBlur={() => void rename(c.id)}
                style={{ ...input, padding: '6px 8px', fontSize: 12 }} />
            ) : confirmId === c.id ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#C0321A', fontWeight: 600 }}>
                <span style={{ flex: 1 }}>Remove? {n} SOP{n === 1 ? '' : 's'} → Uncategorised</span>
                <button onClick={() => void remove(c.id)} style={{ border: 'none', background: '#C0321A', color: C.white, borderRadius: 6, padding: '3px 8px', fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Yes</button>
                <button onClick={() => setConfirmId(null)} style={{ border: '1px solid #EBEBEB', background: C.white, color: C.slate, borderRadius: 6, padding: '3px 8px', fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>No</button>
              </div>
            ) : (
              <>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#1a1a1a', padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <button onClick={() => { setEditing(c.id); setDraft(c.name); }} title="Rename"
                  style={{ border: 'none', background: 'transparent', color: C.slate, cursor: 'pointer', display: 'inline-flex', padding: 4 }}><Pencil size={12} /></button>
                <button onClick={() => setConfirmId(c.id)} title="Remove category"
                  style={{ border: 'none', background: 'transparent', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', padding: 4 }}><Trash2 size={12} /></button>
              </>
            )}
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category"
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
          style={{ ...input, padding: '6px 8px', fontSize: 12 }} />
        <button onClick={() => void add()} disabled={!newName.trim()}
          style={{ border: 'none', background: newName.trim() ? C.green : '#E0E5E9', color: C.white, borderRadius: 8, padding: '0 10px', cursor: newName.trim() ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center' }}>
          <Plus size={14} strokeWidth={2.5} />
        </button>
      </div>
      {err && <div style={{ fontSize: 11, color: '#C0321A' }}>{err}</div>}
    </div>
  );
}

// ── Create / edit modal ───────────────────────────────────────────

function SopModal({ mode, sop, categories, defaultCategory, suggestedDocNo, existingDocNos, me, onClose, onSaved }: {
  mode: 'new' | 'edit';
  sop: Sop | null;
  categories: SopCategory[];
  defaultCategory: string | null;
  suggestedDocNo: string;
  existingDocNos: string[];
  me: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const isNew = mode === 'new';
  const [form, setForm] = useState({
    doc_no: sop?.doc_no ?? suggestedDocNo,
    title: sop?.title ?? '',
    description: sop?.description ?? '',
    category_id: sop?.category_id ?? defaultCategory ?? categories[0]?.id ?? '',
    tagsText: (sop?.tags ?? []).join(', '),
    revision: sop?.revision ?? 'Rev 0',
    effective_date: sop?.effective_date ?? todayISO(),
    review_due: sop?.review_due ?? addMonthsISO(todayISO(), 12),
    owner: sop?.owner ?? me,
    status: (sop?.status === 'archived' ? 'active' : sop?.status) ?? 'active',
    pinned: sop?.pinned ?? false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [progress, setProgress] = useState<UploadState | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const docNoTaken = existingDocNos.some((d) => d.trim().toLowerCase() === form.doc_no.trim().toLowerCase() && d !== sop?.doc_no);

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { setErr('SOPs must be PDF files.'); return; }
    if (tooBig(f)) { setErr(tooBigMsg([f])); return; }
    setErr(null);
    setFile(f);
    if (isNew && !form.title.trim()) set('title', f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim());
  };

  const save = async () => {
    if (!form.doc_no.trim() || !form.title.trim()) { setErr('Document number and title are required.'); return; }
    if (docNoTaken) { setErr(`${form.doc_no.trim()} is already used by another SOP.`); return; }
    if (isNew && !file && attachments.length === 0) { setErr('Attach the SOP PDF and/or the programme files and videos.'); return; }
    setSaving(true);
    setErr(null);
    try {
      const tags = [...new Set(form.tagsText.split(/[,;]+/).map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))];
      const base = {
        doc_no: form.doc_no.trim(),
        title: form.title.trim(),
        description: form.description.trim() || null,
        category_id: form.category_id || null,
        tags,
        revision: form.revision.trim() || 'Rev 0',
        effective_date: form.effective_date || null,
        review_due: form.review_due || null,
        owner: form.owner.trim() || null,
        status: form.status,
        pinned: form.pinned,
        updated_at: new Date().toISOString(),
        updated_by: me,
      };
      if (isNew) {
        const { data, error } = await supabase.from('tsd_sops').insert(base).select('id').single();
        if (error || !data) throw new Error(error?.message ?? 'Could not create the SOP.');
        const id = (data as { id: string }).id;
        const total = (file ? 1 : 0) + attachments.length;
        let n = 0;
        if (file) {
          n++;
          const up = await uploadPdf(id, file, (f) => setProgress({ name: file.name, index: n, total, fraction: f }));
          const { error: uErr } = await supabase.from('tsd_sops').update({ pdf_path: up.path, pdf_filename: up.name, pdf_size: up.size }).eq('id', id);
          if (uErr) throw new Error(uErr.message);
        }
        for (const a of attachments) {
          n++;
          const idx = n;
          await uploadAttachment(id, a, me, (f) => setProgress({ name: a.name, index: idx, total, fraction: f }));
        }
        setProgress(null);
        onSaved(id);
      } else {
        const { error } = await supabase.from('tsd_sops').update(base).eq('id', sop!.id);
        if (error) throw new Error(error.message);
        onSaved(sop!.id);
      }
    } catch (e) {
      setErr((e as Error).message);
      setProgress(null);
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 620, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{isNew ? 'Upload SOP' : `Edit ${sop!.doc_no}`}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{err}</div>}

        {isNew && (
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0] ?? null); }}
            onClick={() => fileRef.current?.click()}
            style={{ border: `1.5px dashed ${file ? C.green : '#CBD5DC'}`, background: file ? C.honeydew : C.seasalt, borderRadius: 14, padding: '18px 16px', textAlign: 'center', cursor: 'pointer' }}>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            {file
              ? <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}><FileText size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />{file.name} · {fmtSize(file.size)}</div>
              : <div style={{ fontSize: 13, color: C.slate }}><Upload size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />Drop the SOP procedure PDF here, or click to choose</div>}
          </div>
        )}

        {isNew && (
          <div>
            <label style={label}>Programme files &amp; videos <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>— optional</span></label>
            <AttachmentDrop files={attachments} onChange={setAttachments} />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 12 }}>
          <div>
            <label style={label}>Document No.</label>
            <input value={form.doc_no} onChange={(e) => set('doc_no', e.target.value)} style={{ ...input, borderColor: docNoTaken ? '#C0321A' : '#EBEBEB', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} />
          </div>
          <div>
            <label style={label}>Title</label>
            <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. DC Charger Commissioning Procedure" style={input} />
          </div>
        </div>

        <div>
          <label style={label}>Summary</label>
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2}
            placeholder="One or two lines on what this SOP covers and when to use it"
            style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={label}>Category</label>
            <select value={form.category_id} onChange={(e) => set('category_id', e.target.value)} style={{ ...input, cursor: 'pointer' }}>
              <option value="">Uncategorised</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Tags</label>
            <input value={form.tagsText} onChange={(e) => set('tagsText', e.target.value)} placeholder="dc, hici, safety" style={input} />
          </div>
        </div>

        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Document control</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <div>
              <label style={label}>Revision</label>
              <input value={form.revision} onChange={(e) => set('revision', e.target.value)} style={input} />
            </div>
            <div>
              <label style={label}>Effective date</label>
              <input type="date" value={form.effective_date} onChange={(e) => set('effective_date', e.target.value)} style={input} />
            </div>
            <div>
              <label style={label}>Owner</label>
              <input value={form.owner} onChange={(e) => set('owner', e.target.value)} style={input} />
            </div>
          </div>
          <div>
            <label style={label}>Next review</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={form.review_due} onChange={(e) => set('review_due', e.target.value)} style={{ ...input, width: 180 }} />
              {([['6 months', 6], ['1 year', 12], ['2 years', 24]] as const).map(([lbl, m]) => (
                <button key={lbl} type="button" onClick={() => set('review_due', addMonthsISO(form.effective_date || todayISO(), m))}
                  style={{ padding: '6px 12px', borderRadius: 99, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  +{lbl}
                </button>
              ))}
              <button type="button" onClick={() => set('review_due', '')}
                style={{ padding: '6px 12px', borderRadius: 99, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                No review date
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', border: '1px solid #EBEBEB', borderRadius: 99, overflow: 'hidden' }}>
            {(['active', 'draft'] as const).map((s) => (
              <button key={s} type="button" onClick={() => set('status', s)}
                style={{ padding: '7px 16px', border: 'none', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: form.status === s ? C.green : 'transparent', color: form.status === s ? C.white : C.slate }}>
                {s === 'active' ? 'Published' : 'Draft'}
              </button>
            ))}
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#1a1a1a', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.pinned} onChange={(e) => set('pinned', e.target.checked)} style={{ accentColor: C.green, width: 15, height: 15 }} />
            Pin to the top of the library
          </label>
        </div>
        {form.status === 'draft' && <div style={{ fontSize: 11, color: C.slate, marginTop: -8 }}>Drafts are only visible to SOP editors until published.</div>}

        {progress && <UploadProgress state={progress} />}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => void save()} disabled={saving}
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: saving ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
            {saving ? (isNew ? 'Uploading…' : 'Saving…') : (isNew ? 'Upload SOP' : 'Save changes')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New revision modal ────────────────────────────────────────────

function ReviseModal({ sop, me, onClose, onSaved }: { sop: Sop; me: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [revision, setRevision] = useState(nextRevision(sop.revision));
  const [effective, setEffective] = useState(todayISO());
  const [reviewDue, setReviewDue] = useState(addMonthsISO(todayISO(), 12));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (!file) { setErr('Attach the revised PDF.'); return; }
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setErr('SOPs must be PDF files.'); return; }
    if (tooBig(file)) { setErr(tooBigMsg([file])); return; }
    setSaving(true);
    setErr(null);
    try {
      const up = await uploadPdf(sop.id, file);
      // Keep the outgoing version in the history before pointing the SOP at the new file.
      if (sop.pdf_path) {
        const { error: hErr } = await supabase.from('tsd_sop_revisions').insert({
          sop_id: sop.id, revision: sop.revision, pdf_path: sop.pdf_path, pdf_filename: sop.pdf_filename,
          pdf_size: sop.pdf_size, effective_date: sop.effective_date, note: sop.revision_note, replaced_by: me,
        });
        if (hErr) throw new Error(`Could not archive the previous version: ${hErr.message}`);
      }
      const { error } = await supabase.from('tsd_sops').update({
        revision: revision.trim() || nextRevision(sop.revision),
        revision_note: note.trim() || null,
        effective_date: effective || null,
        review_due: reviewDue || null,
        pdf_path: up.path, pdf_filename: up.name, pdf_size: up.size,
        updated_at: new Date().toISOString(), updated_by: me,
      }).eq('id', sop.id);
      if (error) throw new Error(error.message);
      await onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 520, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>New revision</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{sop.doc_no} · currently {sop.revision} — it moves to the revision history</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{err}</div>}

        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files?.[0] ?? null); }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `1.5px dashed ${file ? C.green : '#CBD5DC'}`, background: file ? C.honeydew : C.seasalt, borderRadius: 14, padding: '18px 16px', textAlign: 'center', cursor: 'pointer' }}>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file
            ? <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}><FileText size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />{file.name} · {fmtSize(file.size)}</div>
            : <div style={{ fontSize: 13, color: C.slate }}><Upload size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />Drop the revised PDF here, or click to choose</div>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <div><label style={label}>New revision</label><input value={revision} onChange={(e) => setRevision(e.target.value)} style={input} /></div>
          <div><label style={label}>Effective date</label><input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} style={input} /></div>
          <div><label style={label}>Next review</label><input type="date" value={reviewDue} onChange={(e) => setReviewDue(e.target.value)} style={input} /></div>
        </div>

        <div>
          <label style={label}>What changed</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            placeholder="e.g. Updated torque values in step 4; added isolation check before opening the cabinet"
            style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => void save()} disabled={saving}
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: saving ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'Uploading…' : 'Publish revision'}
          </button>
        </div>
      </div>
    </div>
  );
}
