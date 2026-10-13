import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { SearchSelect } from '../components/SearchSelect';
import { OneMapAutocomplete } from '../components/OneMapAutocomplete';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { Search, Plus, ChevronLeft, ChevronRight, Paperclip, FileText, X, MapPin } from 'lucide-react';

// Sites we're trying to secure for CPO charging — from first contact to a
// signed site contract. Not a sale: no amounts, just where each site stands,
// who owns it, what was proposed, and the next follow-up.

type Stage = 'identified' | 'engaging' | 'survey' | 'proposal' | 'negotiation' | 'signed' | 'on_hold' | 'dropped';

const STAGE_META: Record<Stage, { label: string; bg: string; color: string }> = {
  identified:  { label: 'Identified',      bg: '#F3F3F3', color: '#767B77' },
  engaging:    { label: 'Engaging',        bg: '#E3F0FF', color: '#1A62C0' },
  survey:      { label: 'Site survey',     bg: '#F0E8FF', color: '#6B21A8' },
  proposal:    { label: 'Proposal',        bg: '#FFF0E0', color: '#B45309' },
  negotiation: { label: 'Negotiation',     bg: '#FFF8E1', color: '#B07D00' },
  signed:      { label: 'Contract signed', bg: '#E4F3E3', color: '#1B512D' },
  on_hold:     { label: 'On hold',         bg: '#F3F3F3', color: '#767B77' },
  dropped:     { label: 'Dropped',         bg: '#FDEAEA', color: '#C0321A' },
};
const STAGES: Stage[] = ['identified', 'engaging', 'survey', 'proposal', 'negotiation', 'signed', 'on_hold', 'dropped'];
const ACTIVE: Stage[] = ['identified', 'engaging', 'survey', 'proposal', 'negotiation'];
const PARKED: Stage[] = ['on_hold', 'dropped'];

const SITE_TYPES = ['Condominium / MCST', 'Commercial building', 'Industrial', 'Retail mall', 'Hotel', 'Government / HDB / URA car park', 'Landed / private', 'Other'];
const MODELS = ['Revenue share', 'Fixed rent', 'Hybrid (rent + share)', 'No charge to landlord', 'Tender', 'Other'];

interface LogEntry { at: string; by: string; text: string }
interface SiteFile { path: string; name: string; at: string; by: string }

interface Site {
  id: string;
  ref: string;
  site_name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  site_type: string | null;
  lots: number | null;
  landlord: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  stage: Stage;
  proposed_ac: number | null;
  proposed_dc: number | null;
  commercial_model: string | null;
  terms: string | null;
  contract_years: number | null;
  expected_close: string | null;
  tender_close: string | null;
  pic: string | null;
  high_potential: boolean;
  next_action: string | null;
  next_action_date: string | null;
  signed_on: string | null;
  dropped_reason: string | null;
  cpo_location_id: string | null;
  log: LogEntry[];
  files: SiteFile[];
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const BUCKET = 'cpo-land-docs';
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtD = (s: string | null | undefined) =>
  s ? new Date(s.length <= 10 ? `${s}T00:00:00` : s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const chargersLine = (s: Pick<Site, 'lots' | 'proposed_ac' | 'proposed_dc'>) =>
  [s.lots ? `${s.lots} lots` : null, s.proposed_ac ? `${s.proposed_ac} AC` : null, s.proposed_dc ? `${s.proposed_dc} DC` : null].filter(Boolean).join(' · ');
const chargerCount = (s: Site) => (s.proposed_ac ?? 0) + (s.proposed_dc ?? 0);

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
const inputStyle = (disabled = false): React.CSSProperties => ({
  width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13,
  outline: 'none', boxSizing: 'border-box', background: disabled ? C.seasalt : C.white, color: '#1a1a1a',
});

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function ScreenLandAcquisition() {
  const { can, user } = usePermissions();
  const canEdit = can('cpo_land', 'can_edit');
  const canDelete = can('cpo_land', 'can_delete');
  const me = user.full_name || user.email;

  const [sites, setSites] = useState<Site[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const { data, error: e } = await supabase.from('cpo_land_sites').select('*').order('updated_at', { ascending: false });
    if (e) setError(e.message);
    setSites((data as Site[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    void load();
    void supabase.from('cpo_locations').select('id, name').order('name').then(({ data }) => setLocations((data as { id: string; name: string }[]) ?? []));
    // PIC choices: everyone who can open the CPO department.
    void (async () => {
      const { data: grants } = await supabase.from('app_user_permissions').select('user_id').eq('department', 'cpo').eq('can_view', true);
      const ids = [...new Set(((grants ?? []) as { user_id: string }[]).map((g) => g.user_id))];
      if (!ids.length) return;
      const { data: users } = await supabase.from('app_users').select('full_name, email, is_active').in('id', ids);
      setPeople([...new Set(((users ?? []) as { full_name: string | null; email: string; is_active: boolean | null }[])
        .filter((u) => u.is_active !== false).map((u) => (u.full_name || u.email).trim()))].sort((a, b) => a.localeCompare(b)));
    })();
  }, []);

  const [view, setView] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [picFilter, setPicFilter] = useState('');
  const [modal, setModal] = useState<{ site: Site | null; preset?: Partial<Site> } | null>(null);

  const today = todayISO();
  const year = today.slice(0, 4);
  const visible = sites.filter((s) => {
    if (picFilter && (s.pic ?? '') !== picFilter) return false;
    const q = search.trim().toLowerCase();
    return !q || [s.ref, s.site_name, s.address, s.landlord, s.contact_name, s.site_type, s.pic, s.next_action].join(' ').toLowerCase().includes(q);
  });

  // Moving a card: dropping onto Dropped asks for the reason first; Signed stamps
  // today's date. Every move is written to the site's activity log.
  const moveTo = async (site: Site, stage: Stage) => {
    if (!canEdit || site.stage === stage) return;
    if (stage === 'dropped') { setModal({ site, preset: { stage: 'dropped' } }); return; }
    const entry: LogEntry = { at: new Date().toISOString(), by: me, text: `Stage: ${STAGE_META[site.stage].label} → ${STAGE_META[stage].label}` };
    const patch = {
      stage, log: [...(site.log ?? []), entry], updated_at: new Date().toISOString(),
      signed_on: stage === 'signed' ? (site.signed_on ?? today) : site.signed_on,
    };
    setSites((ss) => ss.map((s) => (s.id === site.id ? { ...s, ...patch } : s)));
    const { error: e } = await supabase.from('cpo_land_sites').update(patch).eq('id', site.id);
    if (e) { setError(e.message); void load(); }
  };

  const active = sites.filter((s) => ACTIVE.includes(s.stage));
  const due = active.filter((s) => s.next_action_date && s.next_action_date <= today);
  const closing = sites.filter((s) => ['proposal', 'negotiation'].includes(s.stage));
  const signedThisYear = sites.filter((s) => s.stage === 'signed' && (s.signed_on ?? s.updated_at).startsWith(year));

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading sites…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <KPICard accent label="Sites in pipeline" value={active.length} sub={`${active.reduce((n, s) => n + chargerCount(s), 0)} chargers proposed`} />
        <KPICard label="Follow-ups due" value={due.length} sub="Next action today or overdue" />
        <KPICard label="Proposal / negotiation" value={closing.length} sub="Closest to a contract" />
        <KPICard label={`Signed in ${year}`} value={signedThisYear.length} sub={`${signedThisYear.reduce((n, s) => n + chargerCount(s), 0)} chargers secured`} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 260 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search site, landlord, address…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={14} /></span>
        </div>
        <div style={{ width: 220 }}>
          <SearchSelect value={picFilter} onChange={setPicFilter} placeholder="All PICs"
            options={[{ value: '', label: 'All PICs' }, ...[...new Set([...people, ...sites.map((s) => s.pic ?? '').filter(Boolean)])].sort().map((p) => ({ value: p, label: p }))]} />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, padding: 4 }}>
            {(['board', 'list'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                style={{ padding: '6px 14px', borderRadius: 10, border: 'none', background: view === v ? C.green : 'transparent', color: view === v ? C.white : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {v === 'board' ? 'Pipeline' : 'List'}
              </button>
            ))}
          </div>
          {canEdit && (
            <button onClick={() => setModal({ site: null })}
              style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> New site
            </button>
          )}
        </div>
      </div>

      {view === 'board'
        ? <Board sites={visible} canEdit={canEdit} today={today} onOpen={(s) => setModal({ site: s })} onDrop={moveTo} />
        : <ListView sites={visible} today={today} onOpen={(s) => setModal({ site: s })} />}

      {modal && (
        <SiteModal key={modal.site?.id ?? 'new'} site={modal.site} preset={modal.preset} me={me} people={people} locations={locations}
          canEdit={canEdit} canDelete={canDelete} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await load(); }} />
      )}
    </div>
  );
}

function NextAction({ s, today }: { s: Site; today: string }) {
  if (!s.next_action_date && !s.next_action) return null;
  const overdue = !!s.next_action_date && s.next_action_date < today && ACTIVE.includes(s.stage);
  const isToday = s.next_action_date === today;
  return (
    <span style={{ whiteSpace: 'nowrap', fontWeight: overdue || isToday ? 700 : 400, color: overdue ? '#C0321A' : isToday ? '#B07D00' : C.slate }}>
      {s.next_action_date ? (isToday ? 'Today' : fmtD(s.next_action_date)) : ''}
    </span>
  );
}

function Board({ sites, canEdit, today, onOpen, onDrop }: {
  sites: Site[]; canEdit: boolean; today: string; onOpen: (s: Site) => void; onDrop: (s: Site, stage: Stage) => void;
}) {
  const [dragOver, setDragOver] = useState<Stage | null>(null);
  const [pages, setPages] = useState<Record<string, number>>({});
  // On hold and Dropped share the last column, switched from its header.
  const [parked, setParked] = useState<Stage>('on_hold');
  const SLOTS = ['identified', 'engaging', 'survey', 'proposal', 'negotiation', 'signed', 'parked'] as const;
  const PER_PAGE = 5;
  const CARD_H = 150;
  const CARD_GAP = 10;
  const LIST_H = PER_PAGE * CARD_H + (PER_PAGE - 1) * CARD_GAP;

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${SLOTS.length}, minmax(210px, 1fr))`, gap: 12, minWidth: SLOTS.length * 210 + (SLOTS.length - 1) * 12 }}>
        {SLOTS.map((slot) => {
          const stage: Stage = slot === 'parked' ? parked : slot;
          const col = sites.filter((s) => s.stage === stage);
          const meta = STAGE_META[stage];
          const totalPages = Math.max(1, Math.ceil(col.length / PER_PAGE));
          const page = Math.min(pages[stage] ?? 0, totalPages - 1);
          const pageCol = col.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
          const setPage = (p: number) => setPages((prev) => ({ ...prev, [stage]: Math.max(0, Math.min(totalPages - 1, p)) }));
          return (
            <div key={slot}
              onDragOver={canEdit ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOver !== stage) setDragOver(stage); } : undefined}
              onDragLeave={canEdit ? () => setDragOver((d) => (d === stage ? null : d)) : undefined}
              onDrop={canEdit ? (e) => {
                e.preventDefault();
                setDragOver(null);
                const s = sites.find((x) => x.id === e.dataTransfer.getData('text/plain'));
                if (s) onDrop(s, stage);
              } : undefined}
              style={{ background: dragOver === stage ? C.honeydew : C.seasalt, border: `1.5px solid ${dragOver === stage ? C.green : 'transparent'}`, borderRadius: 14, padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '2px 4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                {slot === 'parked' ? PARKED.map((ps) => {
                  const on = ps === parked;
                  const pm = STAGE_META[ps];
                  return (
                    <button key={ps} onClick={() => setParked(ps)} title={`Show ${pm.label}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 99, border: `1px solid ${on ? pm.color : '#E0E5E9'}`, background: on ? pm.bg : 'transparent', color: on ? pm.color : C.slate, fontFamily: 'Figtree', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                      {pm.label}<span style={{ opacity: 0.7 }}>{sites.filter((s) => s.stage === ps).length}</span>
                    </button>
                  );
                }) : (
                  <>
                    <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, background: meta.bg, padding: '3px 10px', borderRadius: 99, whiteSpace: 'nowrap' }}>{meta.label}</span>
                    <span style={{ fontSize: 11, color: C.slate, fontWeight: 700 }}>{col.length}</span>
                  </>
                )}
              </div>
                <span style={{ fontSize: 11, color: C.slate, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {col.reduce((n, s) => n + chargerCount(s), 0)} charger{col.reduce((n, s) => n + chargerCount(s), 0) === 1 ? '' : 's'} proposed
                </span>
              </div>
              <div style={{ height: LIST_H, display: 'flex', flexDirection: 'column', gap: CARD_GAP, overflow: 'hidden' }}>
                {pageCol.map((s) => (
                  <button key={s.id} draggable={canEdit}
                    onDragStart={canEdit ? (e) => { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
                    onClick={() => onOpen(s)}
                    style={{ textAlign: 'left', background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, padding: '12px 14px', cursor: canEdit ? 'grab' : 'pointer', fontFamily: 'Figtree', display: 'flex', flexDirection: 'column', gap: 5, height: CARD_H, boxSizing: 'border-box', flexShrink: 0, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>{s.ref}</span>
                      {s.site_type && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: '#E3F0FF', color: '#1A62C0', textTransform: 'uppercase', letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{s.site_type}</span>}
                      {s.high_potential && <span title="High potential" style={{ marginLeft: 'auto', width: 12, height: 12, borderRadius: '50%', background: '#E11D2E', flexShrink: 0 }} />}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.site_name}</div>
                    <div style={{ fontSize: 11.5, color: C.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.landlord || s.address || '—'}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.green, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chargersLine(s) || ' '}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.slate, overflow: 'hidden' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.pic || 'No PIC'}</span>
                      <span style={{ marginLeft: 'auto', flexShrink: 0 }}><NextAction s={s} today={today} /></span>
                    </div>
                    {s.next_action && (
                      <div title={s.next_action} style={{ fontSize: 11, color: C.slate, background: C.seasalt, borderRadius: 8, padding: '5px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{s.next_action}</div>
                    )}
                  </button>
                ))}
                {col.length === 0 && (
                  <div style={{ padding: '18px 8px', textAlign: 'center', fontSize: 11, color: C.slate, border: '1px dashed #E0E5E9', borderRadius: 10, flexShrink: 0 }}>
                    {canEdit ? 'Drop sites here' : 'Empty'}
                  </div>
                )}
              </div>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <button onClick={() => setPage(page - 1)} disabled={page === 0}
                    style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: page === 0 ? '#CBD5DD' : C.slate, cursor: page === 0 ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ChevronLeft size={15} strokeWidth={2.25} />
                  </button>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>{page + 1} / {totalPages}</span>
                  <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}
                    style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: page >= totalPages - 1 ? '#CBD5DD' : C.slate, cursor: page >= totalPages - 1 ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ChevronRight size={15} strokeWidth={2.25} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ sites, today, onOpen }: { sites: Site[]; today: string; onOpen: (s: Site) => void }) {
  const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: '#1a1a1a', verticalAlign: 'top' };
  return (
    <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead><tr style={{ background: C.seasalt }}>{['Ref', 'Site', 'Landlord', 'Proposed', 'Stage', 'PIC', 'Next action', 'Updated'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {sites.map((s) => {
              const m = STAGE_META[s.stage];
              return (
                <tr key={s.id} onClick={() => onOpen(s)} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <td style={{ ...td, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>{s.ref}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{s.site_name}</div>
                    <div style={{ fontSize: 11, color: C.slate }}>{[s.site_type, s.address].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td style={{ ...td, color: C.slate }}>{s.landlord || '—'}{s.contact_name && <div style={{ fontSize: 11 }}>{s.contact_name}</div>}</td>
                  <td style={{ ...td, color: C.slate, whiteSpace: 'nowrap' }}>{chargersLine(s) || '—'}</td>
                  <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>{m.label}</span></td>
                  <td style={{ ...td, color: C.slate }}>{s.pic || '—'}</td>
                  <td style={{ ...td, fontSize: 12 }}><NextAction s={s} today={today} />{s.next_action && <div style={{ fontSize: 11, color: C.slate }}>{s.next_action}</div>}</td>
                  <td style={{ ...td, color: C.slate, fontSize: 12, whiteSpace: 'nowrap' }}>{fmtD(s.updated_at)}</td>
                </tr>
              );
            })}
            {sites.length === 0 && <tr><td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No sites yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface PendingFile { file: File; key: string }

function SiteModal({ site, preset, me, people, locations, canEdit, canDelete, onClose, onSaved }: {
  site: Site | null; preset?: Partial<Site>; me: string; people: string[]; locations: { id: string; name: string }[];
  canEdit: boolean; canDelete: boolean; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const isNew = !site;
  const ro = !canEdit;
  const str = (v: string | null | undefined) => v ?? '';
  const num = (v: number | null | undefined) => (v == null ? '' : String(v));
  const [f, setF] = useState({
    site_name: str(site?.site_name), address: str(site?.address), latitude: site?.latitude ?? null as number | null, longitude: site?.longitude ?? null as number | null,
    site_type: str(site?.site_type), lots: num(site?.lots),
    landlord: str(site?.landlord), contact_name: str(site?.contact_name), contact_phone: str(site?.contact_phone), contact_email: str(site?.contact_email),
    stage: (preset?.stage ?? site?.stage ?? 'identified') as Stage,
    proposed_ac: num(site?.proposed_ac), proposed_dc: num(site?.proposed_dc),
    commercial_model: str(site?.commercial_model), terms: str(site?.terms), contract_years: num(site?.contract_years),
    expected_close: str(site?.expected_close), tender_close: str(site?.tender_close),
    pic: site ? str(site.pic) : me, high_potential: site?.high_potential ?? false,
    next_action: str(site?.next_action), next_action_date: str(site?.next_action_date),
    signed_on: str(site?.signed_on), dropped_reason: str(site?.dropped_reason), cpo_location_id: str(site?.cpo_location_id),
    notes: str(site?.notes),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const log: LogEntry[] = site?.log ?? [];
  const [newNote, setNewNote] = useState('');
  const files: SiteFile[] = site?.files ?? [];
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const intOrNull = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v))));
  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

  const save = async () => {
    if (!f.site_name.trim()) { setErr('Give the site a name.'); return; }
    if (f.stage === 'dropped' && !f.dropped_reason.trim()) { setErr('Say why the site was dropped.'); return; }
    for (const [k, v] of [['Lots', f.lots], ['AC chargers', f.proposed_ac], ['DC chargers', f.proposed_dc], ['Contract term', f.contract_years]] as const) {
      if (v.trim() && (isNaN(Number(v)) || Number(v) < 0)) { setErr(`${k} must be a number.`); return; }
    }
    setBusy(true);
    setErr(null);
    const id = site?.id ?? crypto.randomUUID();
    const uploaded: SiteFile[] = [];
    for (const p of pending) {
      const safe = p.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${id}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, p.file, { contentType: p.file.type || undefined });
      if (upErr) { setBusy(false); setErr(`Upload failed (${p.file.name}): ${upErr.message}`); return; }
      uploaded.push({ path, name: p.file.name, at: new Date().toISOString(), by: me });
    }
    const now = new Date().toISOString();
    const entries: LogEntry[] = [...log];
    if (isNew) entries.unshift({ at: now, by: me, text: 'Site added' });
    else if (site && site.stage !== f.stage) entries.push({ at: now, by: me, text: `Stage: ${STAGE_META[site.stage].label} → ${STAGE_META[f.stage].label}` });
    if (newNote.trim()) entries.push({ at: now, by: me, text: newNote.trim() });
    const payload = {
      site_name: f.site_name.trim(), address: f.address.trim() || null, latitude: f.latitude, longitude: f.longitude,
      site_type: f.site_type || null, lots: intOrNull(f.lots),
      landlord: f.landlord.trim() || null, contact_name: f.contact_name.trim() || null, contact_phone: f.contact_phone.trim() || null, contact_email: f.contact_email.trim() || null,
      stage: f.stage, proposed_ac: intOrNull(f.proposed_ac), proposed_dc: intOrNull(f.proposed_dc),
      commercial_model: f.commercial_model || null, terms: f.terms.trim() || null, contract_years: numOrNull(f.contract_years),
      expected_close: f.expected_close || null, tender_close: f.tender_close || null,
      pic: f.pic.trim() || null, high_potential: f.high_potential,
      next_action: f.next_action.trim() || null, next_action_date: f.next_action_date || null,
      signed_on: f.stage === 'signed' ? (f.signed_on || todayISO()) : (f.signed_on || null),
      dropped_reason: f.stage === 'dropped' ? f.dropped_reason.trim() : (f.dropped_reason.trim() || null),
      cpo_location_id: f.cpo_location_id || null, notes: f.notes.trim() || null,
      log: entries, files: [...files.filter((x) => !removed.includes(x.path)), ...uploaded], updated_at: now,
    };
    const { error } = isNew
      ? await supabase.from('cpo_land_sites').insert({ id, ...payload, created_by: me })
      : await supabase.from('cpo_land_sites').update(payload).eq('id', id);
    if (error) {
      if (uploaded.length) void supabase.storage.from(BUCKET).remove(uploaded.map((u) => u.path));
      setBusy(false);
      setErr(error.message);
      return;
    }
    if (removed.length) await supabase.storage.from(BUCKET).remove(removed);
    setBusy(false);
    await onSaved();
  };

  const remove = async () => {
    if (!site) return;
    setBusy(true);
    const { error } = await supabase.from('cpo_land_sites').delete().eq('id', site.id);
    if (error) { setBusy(false); setErr(error.message); return; }
    if (site.files?.length) await supabase.storage.from(BUCKET).remove(site.files.map((x) => x.path));
    setBusy(false);
    await onSaved();
  };

  const openFile = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
    if (error || !data) { setErr(`Could not open the file: ${error?.message ?? 'unknown error'}`); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const section: React.CSSProperties = { background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 };
  const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' };
  const grid = (min: number): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 });
  const m = STAGE_META[f.stage];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.white, borderRadius: 20, width: 720, maxWidth: 'calc(100vw - 24px)', maxHeight: '90vh', overflowY: 'auto', padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{isNew ? 'New site' : `${site!.ref} · ${site!.site_name}`}</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
              {isNew ? 'A site we want to secure for CPO charging' : `Added ${fmtD(site!.created_at)}${site!.created_by ? ` by ${site!.created_by}` : ''} · updated ${fmtD(site!.updated_at)}`}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree', flexShrink: 0 }}>×</button>
        </div>
        {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{err}</div>}

        <div>
          <label style={labelStyle}>Stage</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STAGES.map((st) => {
              const on = f.stage === st;
              const sm = STAGE_META[st];
              return (
                <button key={st} type="button" disabled={ro} onClick={() => set('stage', st)}
                  style={{ padding: '6px 12px', borderRadius: 99, border: `1px solid ${on ? sm.color : '#EBEBEB'}`, background: on ? sm.bg : C.white, color: on ? sm.color : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: ro ? 'default' : 'pointer' }}>
                  {sm.label}
                </button>
              );
            })}
          </div>
        </div>
        {f.stage === 'dropped' && (
          <Field label="Why was it dropped?">
            <input value={f.dropped_reason} disabled={ro} onChange={(e) => set('dropped_reason', e.target.value)} placeholder="e.g. Landlord chose another operator, insufficient power" style={inputStyle(ro)} />
          </Field>
        )}
        {f.stage === 'signed' && (
          <div style={{ ...section, background: m.bg }}>
            <div style={grid(200)}>
              <Field label="Contract signed on"><input type="date" value={f.signed_on || todayISO()} disabled={ro} onChange={(e) => set('signed_on', e.target.value)} style={inputStyle(ro)} /></Field>
              <Field label="Linked CPO location" hint="Once it's live, link the CPO Chargers location it became">
                <SearchSelect value={f.cpo_location_id} disabled={ro} onChange={(v) => set('cpo_location_id', v)} placeholder="Not linked yet"
                  options={[{ value: '', label: 'Not linked yet' }, ...locations.map((l) => ({ value: l.id, label: l.name }))]} />
              </Field>
            </div>
          </div>
        )}

        <div style={section}>
          <div style={sectionTitle}>Site</div>
          <div style={grid(220)}>
            <Field label="Site name"><input value={f.site_name} disabled={ro} onChange={(e) => set('site_name', e.target.value)} placeholder="e.g. The Sail @ Marina Bay" style={inputStyle(ro)} autoFocus={isNew} /></Field>
            <Field label="Site type">
              <SearchSelect value={f.site_type} disabled={ro} onChange={(v) => set('site_type', v)} placeholder="Select type"
                options={[{ value: '', label: 'Not set' }, ...SITE_TYPES.concat(f.site_type && !SITE_TYPES.includes(f.site_type) ? [f.site_type] : []).map((t) => ({ value: t, label: t }))]} />
            </Field>
          </div>
          <Field label="Address">
            {ro ? <input value={f.address} disabled style={inputStyle(true)} /> : (
              <OneMapAutocomplete value={f.address} onChange={(t) => set('address', t)}
                onPick={(r) => setF((x) => ({ ...x, address: r.address, latitude: r.latitude, longitude: r.longitude }))}
                placeholder="Start typing a Singapore address" />
            )}
            {f.latitude != null && f.longitude != null && (
              <div style={{ fontSize: 11, color: C.slate, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={11} /> {f.latitude.toFixed(5)}, {f.longitude.toFixed(5)}</div>
            )}
          </Field>
          <div style={grid(150)}>
            <Field label="Parking lots"><input type="number" min="0" value={f.lots} disabled={ro} onChange={(e) => set('lots', e.target.value)} style={inputStyle(ro)} /></Field>
            <Field label="Proposed AC chargers"><input type="number" min="0" value={f.proposed_ac} disabled={ro} onChange={(e) => set('proposed_ac', e.target.value)} style={inputStyle(ro)} /></Field>
            <Field label="Proposed DC chargers"><input type="number" min="0" value={f.proposed_dc} disabled={ro} onChange={(e) => set('proposed_dc', e.target.value)} style={inputStyle(ro)} /></Field>
          </div>
        </div>

        <div style={section}>
          <div style={sectionTitle}>Landlord</div>
          <div style={grid(200)}>
            <Field label="Landlord / owner"><input value={f.landlord} disabled={ro} onChange={(e) => set('landlord', e.target.value)} placeholder="Company, MCST or agency" style={inputStyle(ro)} /></Field>
            <Field label="Contact person"><input value={f.contact_name} disabled={ro} onChange={(e) => set('contact_name', e.target.value)} style={inputStyle(ro)} /></Field>
            <Field label="Phone"><input value={f.contact_phone} disabled={ro} onChange={(e) => set('contact_phone', e.target.value)} style={inputStyle(ro)} /></Field>
            <Field label="Email"><input value={f.contact_email} disabled={ro} onChange={(e) => set('contact_email', e.target.value)} style={inputStyle(ro)} /></Field>
          </div>
        </div>

        <div style={section}>
          <div style={sectionTitle}>Deal</div>
          <div style={grid(200)}>
            <Field label="Commercial model">
              <SearchSelect value={f.commercial_model} disabled={ro} onChange={(v) => set('commercial_model', v)} placeholder="Select model"
                options={[{ value: '', label: 'Not set' }, ...MODELS.concat(f.commercial_model && !MODELS.includes(f.commercial_model) ? [f.commercial_model] : []).map((t) => ({ value: t, label: t }))]} />
            </Field>
            <Field label="Contract term (years)"><input type="number" min="0" step="0.5" value={f.contract_years} disabled={ro} onChange={(e) => set('contract_years', e.target.value)} style={inputStyle(ro)} /></Field>
            <Field label="Expected signing"><input type="date" value={f.expected_close} disabled={ro} onChange={(e) => set('expected_close', e.target.value)} style={inputStyle(ro)} /></Field>
            <Field label="Tender closes" hint="Only for tendered sites"><input type="date" value={f.tender_close} disabled={ro} onChange={(e) => set('tender_close', e.target.value)} style={inputStyle(ro)} /></Field>
          </div>
          <Field label="Terms"><input value={f.terms} disabled={ro} onChange={(e) => set('terms', e.target.value)} placeholder="e.g. 15% revenue share to landlord, EVOne funds install" style={inputStyle(ro)} /></Field>
        </div>

        <div style={section}>
          <div style={sectionTitle}>Follow-up</div>
          <div style={grid(200)}>
            <Field label="PIC">
              <SearchSelect value={f.pic} disabled={ro} onChange={(v) => set('pic', v)} placeholder="Select PIC"
                options={[{ value: '', label: 'No PIC' }, ...people.concat(f.pic && !people.includes(f.pic) ? [f.pic] : []).map((p) => ({ value: p, label: p }))]} />
            </Field>
            <Field label="Next action date"><input type="date" value={f.next_action_date} disabled={ro} onChange={(e) => set('next_action_date', e.target.value)} style={inputStyle(ro)} /></Field>
          </div>
          <Field label="Next action"><input value={f.next_action} disabled={ro} onChange={(e) => set('next_action', e.target.value)} placeholder="e.g. Send revised proposal to MCST chairman" style={inputStyle(ro)} /></Field>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1a1a1a', cursor: ro ? 'default' : 'pointer' }}>
            <input type="checkbox" checked={f.high_potential} disabled={ro} onChange={(e) => set('high_potential', e.target.checked)} style={{ accentColor: C.green }} />
            High potential
          </label>
        </div>

        <div>
          <label style={labelStyle}>Documents</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {files.filter((x) => !removed.includes(x.path)).map((x) => (
              <div key={x.path} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.seasalt, borderRadius: 10, padding: '8px 12px' }}>
                <FileText size={14} color={C.green} style={{ flexShrink: 0 }} />
                <button type="button" onClick={() => void openFile(x.path)} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', padding: 0, fontFamily: 'Figtree', fontSize: 12.5, fontWeight: 600, color: '#1a1a1a', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</button>
                <span style={{ fontSize: 11, color: C.slate, whiteSpace: 'nowrap' }}>{fmtD(x.at)}</span>
                {!ro && <button type="button" onClick={() => setRemoved((r) => [...r, x.path])} title="Remove" style={{ border: 'none', background: 'none', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', padding: 2 }}><X size={13} /></button>}
              </div>
            ))}
            {pending.map((p) => (
              <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.honeydew, borderRadius: 10, padding: '8px 12px' }}>
                <Paperclip size={14} color={C.green} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.file.name}</span>
                <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>Uploads on save</span>
                <button type="button" onClick={() => setPending((ps) => ps.filter((x) => x.key !== p.key))} style={{ border: 'none', background: 'none', color: '#C0321A', cursor: 'pointer', display: 'inline-flex', padding: 2 }}><X size={13} /></button>
              </div>
            ))}
            {!ro && (
              <>
                <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
                  onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; setPending((ps) => [...ps, ...list.map((file) => ({ file, key: crypto.randomUUID() }))]); }} />
                <button type="button" onClick={() => fileRef.current?.click()}
                  style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 10, border: `1px dashed ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Paperclip size={13} /> Attach proposal, LOI or contract
                </button>
              </>
            )}
          </div>
        </div>

        <div>
          <label style={labelStyle}>Activity</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {!ro && (
              <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={2} placeholder="Log a call, meeting or update — saved with the site"
                style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
            )}
            {[...log].reverse().map((l, i) => (
              <div key={`${l.at}-${i}`} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '6px 2px', borderBottom: '1px solid #F3F3F3' }}>
                <span style={{ color: C.slate, whiteSpace: 'nowrap', minWidth: 92 }}>{fmtD(l.at)}</span>
                <span style={{ flex: 1, color: '#1a1a1a', whiteSpace: 'pre-wrap' }}>{l.text}</span>
                <span style={{ color: C.slate, whiteSpace: 'nowrap' }}>{l.by}</span>
              </div>
            ))}
            {log.length === 0 && ro && <div style={{ fontSize: 12, color: C.slate }}>No activity yet.</div>}
          </div>
        </div>

        <Field label="Notes"><textarea value={f.notes} disabled={ro} onChange={(e) => set('notes', e.target.value)} rows={2} style={{ ...inputStyle(ro), resize: 'vertical', lineHeight: 1.5 }} /></Field>

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete {site!.ref} and its documents? This can't be undone.</span>
            <button onClick={() => setConfirmDelete(false)} style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={() => void remove()} disabled={busy} style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Yes, delete</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {!isNew && canDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{ro ? 'Close' : 'Cancel'}</button>
            {!ro && (
              <button onClick={() => void save()} disabled={busy}
                style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: busy ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
                {busy ? 'Saving…' : isNew ? 'Add site' : 'Save changes'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
