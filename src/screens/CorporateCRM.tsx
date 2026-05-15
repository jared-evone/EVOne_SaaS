import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────

interface CRMCompany {
  id: string;
  name: string;
  base_rate: number;
  threshold_kwh: number;
  discounted_rate: number;
}

interface CRMVehicle {
  id: string;
  vehicle_plate: string;
  company_id: string | null;
  crm_companies: { name: string } | null;
}

type CRMTab = 'companies' | 'vehicles' | 'sp';

interface CRMDriver {
  id: string;
  driver_email: string;
  company_id: string | null;
  crm_companies: { name: string } | null;
}


// ── Helpers ───────────────────────────────────────────────────────

function fmt(n: number) {
  return n > 0 ? `$${Number(n).toFixed(2)}` : '—';
}
function fmtKwh(n: number) {
  return n > 0 ? `${n.toLocaleString()} kWh` : '—';
}


function FieldLabel({ children }: { children: string }) {
  return (
    <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
      {children}
    </label>
  );
}

// ── Company Select ────────────────────────────────────────────────

interface CompanySelectProps {
  value: string;
  companies: CRMCompany[];
  onChange: (id: string) => void;
}

export function CompanySelect({ value, companies, onChange }: CompanySelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = companies.find((c) => c.id === value);
  const filtered = [{ id: '', name: '— Unassigned —' }, ...companies].filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setSearch(''); }}
        style={{
          width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${open ? C.green : '#EBEBEB'}`,
          fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white,
          cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          color: selected ? '#1a1a1a' : C.slate, boxSizing: 'border-box',
        }}>
        <span>{selected?.name ?? '— Unassigned —'}</span>
        <span style={{ fontSize: 10, color: C.slate, marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: C.white, borderRadius: 12, border: '1px solid #EBEBEB',
          boxShadow: '0 8px 32px rgba(0,0,0,.12)', zIndex: 2000,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ padding: '10px 10px 6px', borderBottom: '1px solid #F3F3F3' }}>
            <div style={{ position: 'relative' }}>
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company…"
                style={{
                  width: '100%', padding: '7px 12px 7px 30px', borderRadius: 8, border: '1px solid #EBEBEB',
                  fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.seasalt, boxSizing: 'border-box',
                }}
              />
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 14 }}>⌕</span>
            </div>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '12px 14px', fontSize: 12, color: C.slate, textAlign: 'center' }}>No results</div>
            )}
            {filtered.map((c) => {
              const isActive = c.id === value;
              return (
                <div
                  key={c.id}
                  onClick={() => { onChange(c.id); setOpen(false); }}
                  style={{
                    padding: '9px 14px', fontSize: 13, cursor: 'pointer',
                    background: isActive ? C.honeydew : 'transparent',
                    color: isActive ? C.green : c.id === '' ? C.slate : '#1a1a1a',
                    fontWeight: isActive ? 700 : 400,
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = C.seasalt; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? C.honeydew : 'transparent'; }}>
                  {c.name}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Company Modal ─────────────────────────────────────────────────

interface CompanyModalProps {
  initial: Omit<CRMCompany, 'id'>;
  title: string;
  onSave: (data: Omit<CRMCompany, 'id'>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function CompanyModal({ initial, title, onSave, onDelete, onClose }: CompanyModalProps) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const textField = (label: string, key: keyof typeof form, type = 'text') => (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type={type}
        step={type === 'number' ? '0.001' : undefined}
        value={String(form[key])}
        onChange={(e) => setForm((f) => ({ ...f, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  );

  const handleSave = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete!();
    setDeleting(false);
    onClose();
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 480, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Figtree' }}>×</button>
        </div>
        {textField('Company Name', 'name')}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pricing Rates (SGD / kWh)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {textField('Base Rate', 'base_rate', 'number')}
            {textField('Threshold (kWh)', 'threshold_kwh', 'number')}
            {textField('Discounted Rate', 'discounted_rate', 'number')}
          </div>
        </div>

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this company?</div>
            <div style={{ fontSize: 12, color: '#C0321A' }}>This action is permanent and cannot be undone.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {onDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Delete
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={!form.name.trim() || saving}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: form.name.trim() && !saving ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: form.name.trim() && !saving ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Vehicle Modal ─────────────────────────────────────────────────

interface VehicleModalProps {
  initial: { vehicle_plate: string; company_id: string };
  title: string;
  companies: CRMCompany[];
  onSave: (data: { vehicle_plate: string; company_id: string | null }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function VehicleModal({ initial, title, companies, onSave, onDelete, onClose }: VehicleModalProps) {
  const [plate, setPlate] = useState(initial.vehicle_plate);
  const [companyId, setCompanyId] = useState(initial.company_id);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({ vehicle_plate: plate.trim().toUpperCase(), company_id: companyId || null });
    setSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete!();
    setDeleting(false);
    onClose();
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 440, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Figtree' }}>×</button>
        </div>
        <div>
          <FieldLabel>Vehicle Plate</FieldLabel>
          <input value={plate} onChange={(e) => setPlate(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }} />
        </div>
        <div>
          <FieldLabel>Company</FieldLabel>
          <CompanySelect value={companyId} companies={companies} onChange={setCompanyId} />
        </div>

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this vehicle?</div>
            <div style={{ fontSize: 12, color: '#C0321A' }}>This action is permanent and cannot be undone.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {onDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Delete
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={!plate.trim() || saving}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: plate.trim() && !saving ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: plate.trim() && !saving ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────

const PER_PAGE = 15;

function Paginator({ page, totalPages, total, from, to, onPrev, onNext }: {
  page: number; totalPages: number; total: number; from: number; to: number;
  onPrev: () => void; onNext: () => void;
}) {
  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid #EBEBEB',
    background: disabled ? C.seasalt : C.white, color: disabled ? '#ccc' : C.slate,
    fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
  });
  return (
    <div style={{ padding: '10px 16px', borderTop: '1px solid #F3F3F3', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 12, color: C.slate }}>
        {total === 0 ? 'No results' : `Showing ${from}–${to} of ${total}`}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onPrev} disabled={page === 1} style={btnStyle(page === 1)}>← Prev</button>
        <span style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>Page {page} of {totalPages}</span>
        <button onClick={onNext} disabled={page >= totalPages} style={btnStyle(page >= totalPages)}>Next →</button>
      </div>
    </div>
  );
}

// ── Batch delete confirmation bar ────────────────────────────────

interface BatchConfirmBarProps {
  count: number;
  noun: string;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function BatchConfirmBar({ count, noun, deleting, onConfirm, onCancel }: BatchConfirmBarProps) {
  return (
    <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>
          Delete {count} {noun}{count !== 1 ? 's' : ''}?
        </div>
        <div style={{ fontSize: 12, color: '#C0321A', marginTop: 2 }}>
          This action is permanent and cannot be undone.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={onCancel}
          style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={onConfirm} disabled={deleting}
          style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          {deleting ? 'Deleting…' : `Yes, Delete ${count}`}
        </button>
      </div>
    </div>
  );
}

// ── Companies Tab ─────────────────────────────────────────────────

interface CompaniesTabProps {
  companies: CRMCompany[];
  onRefresh: () => Promise<void>;
  error: string | null;
}

function CompaniesTab({ companies, onRefresh, error }: CompaniesTabProps) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CRMCompany | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const priced = companies.filter((c) => c.base_rate > 0);
  const avgBase = priced.length ? priced.reduce((s, c) => s + Number(c.base_rate), 0) / priced.length : 0;
  const withDiscount = priced.filter((c) => Number(c.discounted_rate) < Number(c.base_rate)).length;
  const visible = companies.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paged = visible.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  const toggleOne = (id: string) =>
    setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((c) => c.id)));

  const clearSelection = () => { setSelected(new Set()); setBatchConfirm(false); };

  const addCompany = async (data: Omit<CRMCompany, 'id'>) => {
    await supabase.from('crm_companies').insert(data);
    await onRefresh();
  };
  const updateCompany = async (id: string, data: Omit<CRMCompany, 'id'>) => {
    await supabase.from('crm_companies').update(data).eq('id', id);
    await onRefresh();
  };
  const deleteCompany = async (id: string) => {
    await supabase.from('crm_companies').delete().eq('id', id);
    await onRefresh();
  };
  const batchDelete = async () => {
    setBatchDeleting(true);
    await supabase.from('crm_companies').delete().in('id', [...selected]);
    await onRefresh();
    clearSelection();
    setBatchDeleting(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Total Companies"   value={String(companies.length)} sub="registered accounts" accent />
        <KPICard label="Avg Base Rate"     value={`$${avgBase.toFixed(3)}`} sub="SGD per kWh" />
        <KPICard label="Volume Discounts"  value={String(withDiscount)} sub="companies with tiered pricing" />
        <KPICard label="Unpriced Accounts" value={String(companies.length - priced.length)} sub="pending rate setup" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 260 }}>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search companies…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}>⌕</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {selected.size > 0 && !batchConfirm && (
            <>
              <span style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>{selected.size} selected</span>
              <button onClick={() => setBatchConfirm(true)}
                style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Delete Selected
              </button>
              <button onClick={clearSelection}
                style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Clear
              </button>
            </>
          )}
          <button onClick={() => setAdding(true)}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + Add Company
          </button>
        </div>
      </div>

      {batchConfirm && (
        <BatchConfirmBar count={selected.size} noun="company" deleting={batchDeleting}
          onConfirm={batchDelete} onCancel={() => setBatchConfirm(false)} />
      )}

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                <th style={{ padding: '12px 16px', borderBottom: '1px solid #EBEBEB', width: 40 }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll}
                    style={{ cursor: 'pointer', width: 15, height: 15, accentColor: C.green }} />
                </th>
                {['#', 'Company Name', 'Base Rate', 'Threshold', 'Discounted Rate', 'Saving'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((c, i) => {
                const base = Number(c.base_rate), disc = Number(c.discounted_rate);
                const hasSaving = base > 0 && disc < base;
                const isSelected = selected.has(c.id);
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid #F3F3F3', background: isSelected ? '#FFF8F8' : 'transparent' }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? '#FFF8F8' : 'transparent'; }}>
                    <td style={{ padding: '12px 16px' }} onClick={(e) => { e.stopPropagation(); toggleOne(c.id); }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(c.id)}
                        style={{ cursor: 'pointer', width: 15, height: 15, accentColor: C.green }} />
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate, cursor: 'pointer' }} onClick={() => setEditing(c)}>{(safePage - 1) * PER_PAGE + i + 1}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#1a1a1a', cursor: 'pointer' }} onClick={() => setEditing(c)}>{c.name}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: base > 0 ? C.green : C.slate, whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => setEditing(c)}>{fmt(base)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: c.threshold_kwh > 0 ? '#1a1a1a' : C.slate, whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => setEditing(c)}>{fmtKwh(c.threshold_kwh)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: disc > 0 ? C.green : C.slate, whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => setEditing(c)}>{fmt(disc)}</td>
                    <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => setEditing(c)}>
                      {hasSaving
                        ? <span style={{ background: '#E4F3E3', color: '#1B512D', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>${(base - disc).toFixed(3)}/kWh</span>
                        : <span style={{ color: C.slate, fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No companies match your search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginator page={safePage} totalPages={totalPages} total={visible.length}
          from={visible.length ? (safePage - 1) * PER_PAGE + 1 : 0} to={Math.min(safePage * PER_PAGE, visible.length)}
          onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => Math.min(totalPages, p + 1))} />
      </div>

      {adding && (
        <CompanyModal title="Add Company" initial={{ name: '', base_rate: 0, threshold_kwh: 1000, discounted_rate: 0 }}
          onSave={addCompany} onClose={() => setAdding(false)} />
      )}
      {editing && (
        <CompanyModal key={editing.id} title="Edit Company"
          initial={{ name: editing.name, base_rate: editing.base_rate, threshold_kwh: editing.threshold_kwh, discounted_rate: editing.discounted_rate }}
          onSave={(data) => updateCompany(editing.id, data)}
          onDelete={() => deleteCompany(editing.id)}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── Vehicles Tab ──────────────────────────────────────────────────

interface VehiclesTabProps {
  companies: CRMCompany[];
  error: string | null;
}

function VehiclesTab({ companies, error }: VehiclesTabProps) {
  const [vehicles, setVehicles] = useState<CRMVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CRMVehicle | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const fetchVehicles = async () => {
    const { data } = await supabase
      .from('crm_vehicles')
      .select('*, crm_companies(name)')
      .order('vehicle_plate');
    setVehicles((data as CRMVehicle[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchVehicles(); }, []);

  const addVehicle = async (data: { vehicle_plate: string; company_id: string | null }) => {
    await supabase.from('crm_vehicles').insert(data);
    await fetchVehicles();
  };
  const updateVehicle = async (id: string, data: { vehicle_plate: string; company_id: string | null }) => {
    await supabase.from('crm_vehicles').update(data).eq('id', id);
    await fetchVehicles();
  };
  const deleteVehicle = async (id: string) => {
    await supabase.from('crm_vehicles').delete().eq('id', id);
    await fetchVehicles();
  };
  const batchDelete = async () => {
    setBatchDeleting(true);
    await supabase.from('crm_vehicles').delete().in('id', [...selected]);
    await fetchVehicles();
    setSelected(new Set());
    setBatchConfirm(false);
    setBatchDeleting(false);
  };

  const companyCounts = vehicles.reduce<Record<string, number>>((acc, v) => {
    if (v.company_id) acc[v.company_id] = (acc[v.company_id] ?? 0) + 1;
    return acc;
  }, {});
  const companiesCovered = Object.keys(companyCounts).length;
  const avgPerCompany = companiesCovered ? (vehicles.length / companiesCovered).toFixed(1) : '—';

  const visible = vehicles.filter((v) => {
    const q = search.toLowerCase();
    return v.vehicle_plate.toLowerCase().includes(q) || (v.crm_companies?.name ?? '').toLowerCase().includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paged = visible.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const allVisibleSelected = visible.length > 0 && visible.every((v) => selected.has(v.id));

  const toggleOne = (id: string) =>
    setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((v) => v.id)));

  const clearSelection = () => { setSelected(new Set()); setBatchConfirm(false); };

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Total Vehicles"     value={String(vehicles.length)} sub="registered plates" accent />
        <KPICard label="Companies Covered"  value={String(companiesCovered)} sub="with GoParkin vehicles" />
        <KPICard label="Avg per Company"    value={String(avgPerCompany)} sub="vehicles per account" />
        <KPICard label="Unassigned"         value={String(vehicles.filter((v) => !v.company_id).length)} sub="no company linked" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 280 }}>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search plate or company…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}>⌕</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {selected.size > 0 && !batchConfirm && (
            <>
              <span style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>{selected.size} selected</span>
              <button onClick={() => setBatchConfirm(true)}
                style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Delete Selected
              </button>
              <button onClick={clearSelection}
                style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Clear
              </button>
            </>
          )}
          <button onClick={() => setAdding(true)}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + Add Vehicle
          </button>
        </div>
      </div>

      {batchConfirm && (
        <BatchConfirmBar count={selected.size} noun="vehicle" deleting={batchDeleting}
          onConfirm={batchDelete} onCancel={() => setBatchConfirm(false)} />
      )}

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                <th style={{ padding: '12px 16px', borderBottom: '1px solid #EBEBEB', width: 40 }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll}
                    style={{ cursor: 'pointer', width: 15, height: 15, accentColor: C.green }} />
                </th>
                {['#', 'Vehicle Plate', 'Company'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((v, i) => {
                const isSelected = selected.has(v.id);
                return (
                  <tr key={v.id} style={{ borderBottom: '1px solid #F3F3F3', background: isSelected ? '#FFF8F8' : 'transparent' }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? '#FFF8F8' : 'transparent'; }}>
                    <td style={{ padding: '12px 16px' }} onClick={(e) => { e.stopPropagation(); toggleOne(v.id); }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(v.id)}
                        style={{ cursor: 'pointer', width: 15, height: 15, accentColor: C.green }} />
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate, cursor: 'pointer' }} onClick={() => setEditing(v)}>{(safePage - 1) * PER_PAGE + i + 1}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green, fontFamily: 'monospace', letterSpacing: '0.05em', cursor: 'pointer' }} onClick={() => setEditing(v)}>{v.vehicle_plate}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: v.crm_companies ? '#1a1a1a' : C.slate, cursor: 'pointer' }} onClick={() => setEditing(v)}>
                      {v.crm_companies?.name ?? <span style={{ fontStyle: 'italic' }}>Unassigned</span>}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={4} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No vehicles match your search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginator page={safePage} totalPages={totalPages} total={visible.length}
          from={visible.length ? (safePage - 1) * PER_PAGE + 1 : 0} to={Math.min(safePage * PER_PAGE, visible.length)}
          onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => Math.min(totalPages, p + 1))} />
      </div>

      {adding && (
        <VehicleModal title="Add Vehicle" initial={{ vehicle_plate: '', company_id: '' }}
          companies={companies} onSave={addVehicle} onClose={() => setAdding(false)} />
      )}
      {editing && (
        <VehicleModal key={editing.id} title="Edit Vehicle"
          initial={{ vehicle_plate: editing.vehicle_plate, company_id: editing.company_id ?? '' }}
          companies={companies}
          onSave={(data) => updateVehicle(editing.id, data)}
          onDelete={() => deleteVehicle(editing.id)}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── Driver Modal ──────────────────────────────────────────────────

interface DriverModalProps {
  initial: { driver_email: string; company_id: string };
  title: string;
  companies: CRMCompany[];
  onSave: (data: { driver_email: string; company_id: string | null }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function DriverModal({ initial, title, companies, onSave, onDelete, onClose }: DriverModalProps) {
  const [email, setEmail] = useState(initial.driver_email);
  const [companyId, setCompanyId] = useState(initial.company_id);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({ driver_email: email.trim().toLowerCase(), company_id: companyId || null });
    setSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete!();
    setDeleting(false);
    onClose();
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 440, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Figtree' }}>×</button>
        </div>
        <div>
          <FieldLabel>Driver Email</FieldLabel>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div>
          <FieldLabel>Company</FieldLabel>
          <CompanySelect value={companyId} companies={companies} onChange={setCompanyId} />
        </div>

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this driver?</div>
            <div style={{ fontSize: 12, color: '#C0321A' }}>This action is permanent and cannot be undone.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {onDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Delete
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={!email.trim() || saving}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: email.trim() && !saving ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: email.trim() && !saving ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SP Drivers Tab ────────────────────────────────────────────────

interface SPDriversTabProps {
  companies: CRMCompany[];
  error: string | null;
}

function SPDriversTab({ companies, error }: SPDriversTabProps) {
  const [drivers, setDrivers] = useState<CRMDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CRMDriver | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const fetchDrivers = async () => {
    const { data } = await supabase
      .from('crm_sp_drivers')
      .select('*, crm_companies(name)')
      .order('driver_email');
    setDrivers((data as CRMDriver[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchDrivers(); }, []);

  const addDriver = async (data: { driver_email: string; company_id: string | null }) => {
    await supabase.from('crm_sp_drivers').insert(data);
    await fetchDrivers();
  };
  const updateDriver = async (id: string, data: { driver_email: string; company_id: string | null }) => {
    await supabase.from('crm_sp_drivers').update(data).eq('id', id);
    await fetchDrivers();
  };
  const deleteDriver = async (id: string) => {
    await supabase.from('crm_sp_drivers').delete().eq('id', id);
    await fetchDrivers();
  };
  const batchDelete = async () => {
    setBatchDeleting(true);
    await supabase.from('crm_sp_drivers').delete().in('id', [...selected]);
    await fetchDrivers();
    setSelected(new Set());
    setBatchConfirm(false);
    setBatchDeleting(false);
  };

  const companyCounts = drivers.reduce<Record<string, number>>((acc, d) => {
    if (d.company_id) acc[d.company_id] = (acc[d.company_id] ?? 0) + 1;
    return acc;
  }, {});
  const companiesCovered = Object.keys(companyCounts).length;

  const visible = drivers.filter((d) => {
    const q = search.toLowerCase();
    return d.driver_email.toLowerCase().includes(q) || (d.crm_companies?.name ?? '').toLowerCase().includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paged = visible.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const allVisibleSelected = visible.length > 0 && visible.every((d) => selected.has(d.id));
  const toggleOne = (id: string) =>
    setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((d) => d.id)));
  const clearSelection = () => { setSelected(new Set()); setBatchConfirm(false); };

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Total Drivers"      value={String(drivers.length)} sub="registered SP accounts" accent />
        <KPICard label="Companies Covered"  value={String(companiesCovered)} sub="with SP drivers" />
        <KPICard label="Avg per Company"    value={companiesCovered ? (drivers.length / companiesCovered).toFixed(1) : '—'} sub="drivers per account" />
        <KPICard label="Unassigned"         value={String(drivers.filter((d) => !d.company_id).length)} sub="no company linked" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 300 }}>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search email or company…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}>⌕</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {selected.size > 0 && !batchConfirm && (
            <>
              <span style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>{selected.size} selected</span>
              <button onClick={() => setBatchConfirm(true)}
                style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Delete Selected
              </button>
              <button onClick={clearSelection}
                style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Clear
              </button>
            </>
          )}
          <button onClick={() => setAdding(true)}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + Add Driver
          </button>
        </div>
      </div>

      {batchConfirm && (
        <BatchConfirmBar count={selected.size} noun="driver" deleting={batchDeleting}
          onConfirm={batchDelete} onCancel={() => setBatchConfirm(false)} />
      )}

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                <th style={{ padding: '12px 16px', borderBottom: '1px solid #EBEBEB', width: 40 }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll}
                    style={{ cursor: 'pointer', width: 15, height: 15, accentColor: C.green }} />
                </th>
                {['#', 'Driver Email', 'Company'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((d, i) => {
                const isSelected = selected.has(d.id);
                return (
                  <tr key={d.id} style={{ borderBottom: '1px solid #F3F3F3', background: isSelected ? '#FFF8F8' : 'transparent' }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? '#FFF8F8' : 'transparent'; }}>
                    <td style={{ padding: '12px 16px' }} onClick={(e) => { e.stopPropagation(); toggleOne(d.id); }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(d.id)}
                        style={{ cursor: 'pointer', width: 15, height: 15, accentColor: C.green }} />
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate, cursor: 'pointer' }} onClick={() => setEditing(d)}>{(safePage - 1) * PER_PAGE + i + 1}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: C.green, cursor: 'pointer' }} onClick={() => setEditing(d)}>{d.driver_email}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: d.crm_companies ? '#1a1a1a' : C.slate, cursor: 'pointer' }} onClick={() => setEditing(d)}>
                      {d.crm_companies?.name ?? <span style={{ fontStyle: 'italic' }}>Unassigned</span>}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={4} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No drivers match your search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginator page={safePage} totalPages={totalPages} total={visible.length}
          from={visible.length ? (safePage - 1) * PER_PAGE + 1 : 0} to={Math.min(safePage * PER_PAGE, visible.length)}
          onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => Math.min(totalPages, p + 1))} />
      </div>

      {adding && (
        <DriverModal title="Add Driver" initial={{ driver_email: '', company_id: '' }}
          companies={companies} onSave={addDriver} onClose={() => setAdding(false)} />
      )}
      {editing && (
        <DriverModal key={editing.id} title="Edit Driver"
          initial={{ driver_email: editing.driver_email, company_id: editing.company_id ?? '' }}
          companies={companies}
          onSave={(data) => updateDriver(editing.id, data)}
          onDelete={() => deleteDriver(editing.id)}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────

export function ScreenCorporateCRM() {
  const [tab, setTab] = useState<CRMTab>('companies');
  const [companies, setCompanies] = useState<CRMCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCompanies = async () => {
    const { data, error } = await supabase.from('crm_companies').select('*').order('name');
    if (error) { setError(error.message); return; }
    setCompanies(data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchCompanies(); }, []);

  const TABS: { id: CRMTab; label: string }[] = [
    { id: 'companies', label: 'Companies' },
    { id: 'vehicles',  label: 'GoParkin Vehicles' },
    { id: 'sp',        label: 'SP Vehicles' },
  ];

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB', alignSelf: 'flex-start' }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 20px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: tab === t.id ? C.green : 'transparent',
              color: tab === t.id ? C.white : C.slate }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'companies' && <CompaniesTab companies={companies} onRefresh={fetchCompanies} error={error} />}
      {tab === 'vehicles'  && <VehiclesTab  companies={companies} error={error} />}
      {tab === 'sp'        && <SPDriversTab companies={companies} error={error} />}
    </div>
  );
}
