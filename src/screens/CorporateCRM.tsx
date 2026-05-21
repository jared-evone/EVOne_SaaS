import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { AccountOpening } from './crm/AccountOpening';
import { usePermissions } from '../permissions';

// ── Types ─────────────────────────────────────────────────────────

interface CRMCompany {
  id: string;
  name: string;
  base_rate: number;
  threshold_kwh: number;
  discounted_rate: number;
  invoice_email: string | null;
  invoice_cc_emails: string[];
  contract_path: string | null;
  contract_filename: string | null;
}

const CONTRACT_BUCKET = 'crm-contracts';

interface CRMVehicle {
  id: string;
  vehicle_plate: string;
  company_id: string | null;
  crm_companies: { name: string } | null;
}

type CRMTab = 'companies' | 'vehicles' | 'sp' | 'opening';

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

// ── Company Filter (pill-styled dropdown for list views) ──────────

interface CompanyFilterProps {
  value: string; // '' = All, 'unassigned' = no company, otherwise company.id
  companies: CRMCompany[];
  onChange: (v: string) => void;
}

export function CompanyFilter({ value, companies, onChange }: CompanyFilterProps) {
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

  const SENTINELS = [
    { id: '',           name: 'All Companies' },
    { id: 'unassigned', name: '— Unassigned —' },
  ];
  const all = [...SENTINELS, ...companies];
  const filtered = all.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const current = all.find((c) => c.id === value) ?? SENTINELS[0];
  const isFiltering = value !== '';

  return (
    <div ref={ref} style={{ position: 'relative', width: 240 }}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setSearch(''); }}
        style={{
          width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99,
          border: `1px solid ${isFiltering ? C.green : '#EBEBEB'}`,
          background: isFiltering ? C.honeydew : C.white,
          color: isFiltering ? C.green : C.slate,
          fontFamily: 'Figtree', fontSize: 13, fontWeight: isFiltering ? 700 : 500,
          outline: 'none', cursor: 'pointer', textAlign: 'left',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxSizing: 'border-box', position: 'relative',
        }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: isFiltering ? C.green : C.slate }}>◉</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.name}</span>
        <span style={{ fontSize: 10, marginLeft: 8, color: isFiltering ? C.green : C.slate }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: C.white, borderRadius: 12, border: '1px solid #EBEBEB',
          boxShadow: '0 8px 32px rgba(0,0,0,.12)', zIndex: 2000,
          display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 280,
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
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '12px 14px', fontSize: 12, color: C.slate, textAlign: 'center' }}>No results</div>
            )}
            {filtered.map((c) => {
              const isActive = c.id === value;
              const isSentinel = c.id === '' || c.id === 'unassigned';
              return (
                <div
                  key={c.id || c.name}
                  onClick={() => { onChange(c.id); setOpen(false); }}
                  style={{
                    padding: '9px 14px', fontSize: 13, cursor: 'pointer',
                    background: isActive ? C.honeydew : 'transparent',
                    color: isActive ? C.green : isSentinel ? C.slate : '#1a1a1a',
                    fontWeight: isActive ? 700 : isSentinel ? 600 : 400,
                    borderBottom: c.id === 'unassigned' ? '1px solid #F3F3F3' : undefined,
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
  canDelete: boolean;
  onSave: (data: Omit<CRMCompany, 'id'>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function CompanyModal({ initial, title, canDelete, onSave, onDelete, onClose }: CompanyModalProps) {
  const [form, setForm] = useState(initial);
  const [ccText, setCcText] = useState((initial.invoice_cc_emails ?? []).join(', '));
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [removeContract, setRemoveContract] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const contractRef = useRef<HTMLInputElement>(null);

  const viewContract = async () => {
    if (!initial.contract_path) return;
    const { data, error } = await supabase.storage.from(CONTRACT_BUCKET).createSignedUrl(initial.contract_path, 60);
    if (error || !data) { alert(`Could not open contract: ${error?.message ?? 'unknown'}`); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const downloadContract = async () => {
    if (!initial.contract_path) return;
    const { data, error } = await supabase.storage.from(CONTRACT_BUCKET)
      .createSignedUrl(initial.contract_path, 60, { download: initial.contract_filename ?? true });
    if (error || !data) { alert(`Could not download contract: ${error?.message ?? 'unknown'}`); return; }
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const textField = (label: string, key: 'name' | 'base_rate' | 'threshold_kwh' | 'discounted_rate' | 'invoice_email', type = 'text', placeholder?: string) => (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type={type}
        step={type === 'number' ? '0.001' : undefined}
        placeholder={placeholder}
        value={form[key] == null ? '' : String(form[key])}
        onChange={(e) => setForm((f) => ({
          ...f,
          [key]: type === 'number'
            ? Number(e.target.value)
            : (key === 'invoice_email' ? (e.target.value || null) : e.target.value),
        }))}
        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  );

  const handleSave = async () => {
    setSaving(true);
    const cc = ccText
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    let contract_path     = form.contract_path;
    let contract_filename = form.contract_filename;

    if (contractFile) {
      if (initial.contract_path) {
        await supabase.storage.from(CONTRACT_BUCKET).remove([initial.contract_path]);
      }
      const fileId = crypto.randomUUID();
      const ext = contractFile.name.match(/\.[^.]+$/)?.[0] ?? '';
      const path = `${fileId}${ext}`;
      const { error: upErr } = await supabase.storage.from(CONTRACT_BUCKET).upload(path, contractFile, {
        contentType: contractFile.type || 'application/octet-stream',
      });
      if (upErr) {
        alert(`Contract upload failed: ${upErr.message}`);
        setSaving(false);
        return;
      }
      contract_path     = path;
      contract_filename = contractFile.name;
    } else if (removeContract && initial.contract_path) {
      await supabase.storage.from(CONTRACT_BUCKET).remove([initial.contract_path]);
      contract_path     = null;
      contract_filename = null;
    }

    await onSave({
      ...form,
      invoice_cc_emails: cc,
      contract_path,
      contract_filename,
    });
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
    <div
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
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invoicing</div>
          {textField('Invoice Email (To)', 'invoice_email', 'email', 'billing@company.com')}
          <div>
            <FieldLabel>CC List</FieldLabel>
            <textarea
              value={ccText}
              onChange={(e) => setCcText(e.target.value)}
              rows={2}
              placeholder="finance@company.com, ops@company.com"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 }}
            />
            <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>
              Separate multiple addresses with commas, semicolons, spaces, or newlines.
            </div>
          </div>
        </div>
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contract</div>
          {initial.contract_path && initial.contract_filename && !removeContract && !contractFile && (
            <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {initial.contract_filename}
              </div>
              <button type="button" onClick={viewContract}
                style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                View
              </button>
              <button type="button" onClick={downloadContract}
                style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                ⬇ Download
              </button>
              {canDelete && (
                <button type="button" onClick={() => setRemoveContract(true)}
                  style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  Remove
                </button>
              )}
            </div>
          )}
          {removeContract && initial.contract_path && !contractFile && (
            <div style={{ background: '#FDEAEA', border: '1px solid #FDEAEA', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, fontWeight: 600, color: '#C0321A' }}>
              Contract will be removed when you save.
              <button type="button" onClick={() => setRemoveContract(false)}
                style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: 'none', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                Undo
              </button>
            </div>
          )}
          <div>
            <FieldLabel>{initial.contract_path ? 'Replace File' : 'Upload File'}</FieldLabel>
            <input
              ref={contractRef}
              type="file"
              accept="application/pdf,.pdf,.doc,.docx"
              onChange={(e) => { setContractFile(e.target.files?.[0] ?? null); setRemoveContract(false); }}
              style={{ width: '100%', padding: 8, borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white }}
            />
            {contractFile && (
              <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>
                Selected: <span style={{ color: '#1a1a1a', fontWeight: 600 }}>{contractFile.name}</span> ({(contractFile.size / 1024).toFixed(0)} KB)
                <button type="button" onClick={() => { setContractFile(null); if (contractRef.current) contractRef.current.value = ''; }}
                  style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  Clear
                </button>
              </div>
            )}
            {!contractFile && !initial.contract_path && (
              <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>
                Accepted formats: PDF, DOC, DOCX.
              </div>
            )}
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
    <div
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
  const { can } = usePermissions();
  const canEdit   = can('corporatecrm', 'can_edit');
  const canDelete = can('corporatecrm', 'can_delete');

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
  const deleteCompany = async (id: string, contractPath: string | null) => {
    if (contractPath) await supabase.storage.from(CONTRACT_BUCKET).remove([contractPath]);
    await supabase.from('crm_companies').delete().eq('id', id);
    await onRefresh();
  };
  const batchDelete = async () => {
    setBatchDeleting(true);
    const ids = [...selected];
    const paths = companies
      .filter((c) => selected.has(c.id) && c.contract_path)
      .map((c) => c.contract_path!) ;
    if (paths.length) await supabase.storage.from(CONTRACT_BUCKET).remove(paths);
    await supabase.from('crm_companies').delete().in('id', ids);
    await onRefresh();
    clearSelection();
    setBatchDeleting(false);
  };
  const viewContractFor = async (c: CRMCompany) => {
    if (!c.contract_path) return;
    const { data, error: e } = await supabase.storage.from(CONTRACT_BUCKET).createSignedUrl(c.contract_path, 60);
    if (e || !data) { alert(`Could not open contract: ${e?.message ?? 'unknown'}`); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
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
          {canDelete && selected.size > 0 && !batchConfirm && (
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
          {canEdit && (
            <button onClick={() => setAdding(true)}
              style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + Add Company
            </button>
          )}
        </div>
      </div>

      {canDelete && batchConfirm && (
        <BatchConfirmBar count={selected.size} noun="company" deleting={batchDeleting}
          onConfirm={batchDelete} onCancel={() => setBatchConfirm(false)} />
      )}

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {canDelete && (
                  <th style={{ padding: '12px 16px', borderBottom: '1px solid #EBEBEB', width: 40 }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll}
                      style={{ cursor: 'pointer', width: 15, height: 15, accentColor: C.green }} />
                  </th>
                )}
                {['#', 'Company Name', 'Base Rate', 'Threshold', 'Discounted Rate', 'Saving', 'Contract'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((c, i) => {
                const base = Number(c.base_rate), disc = Number(c.discounted_rate);
                const hasSaving = base > 0 && disc < base;
                const isSelected = selected.has(c.id);
                const cellCursor = canEdit ? 'pointer' : 'default';
                const openEdit = () => { if (canEdit) setEditing(c); };
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid #F3F3F3', background: isSelected ? '#FFF8F8' : 'transparent' }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? '#FFF8F8' : 'transparent'; }}>
                    {canDelete && (
                      <td style={{ padding: '12px 16px' }} onClick={(e) => { e.stopPropagation(); toggleOne(c.id); }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleOne(c.id)}
                          style={{ cursor: 'pointer', width: 15, height: 15, accentColor: C.green }} />
                      </td>
                    )}
                    <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate, cursor: cellCursor }} onClick={openEdit}>{(safePage - 1) * PER_PAGE + i + 1}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#1a1a1a', cursor: cellCursor }} onClick={openEdit}>{c.name}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: base > 0 ? C.green : C.slate, whiteSpace: 'nowrap', cursor: cellCursor }} onClick={openEdit}>{fmt(base)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: c.threshold_kwh > 0 ? '#1a1a1a' : C.slate, whiteSpace: 'nowrap', cursor: cellCursor }} onClick={openEdit}>{fmtKwh(c.threshold_kwh)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: disc > 0 ? C.green : C.slate, whiteSpace: 'nowrap', cursor: cellCursor }} onClick={openEdit}>{fmt(disc)}</td>
                    <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', cursor: cellCursor }} onClick={openEdit}>
                      {hasSaving
                        ? <span style={{ background: '#E4F3E3', color: '#1B512D', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>${(base - disc).toFixed(3)}/kWh</span>
                        : <span style={{ color: C.slate, fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      {c.contract_path
                        ? (
                          <button onClick={() => viewContractFor(c)}
                            title={c.contract_filename ? `View ${c.contract_filename}` : 'View contract'}
                            style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                            View
                          </button>
                        )
                        : <span style={{ color: C.slate, fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={canDelete ? 8 : 7} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No companies match your search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginator page={safePage} totalPages={totalPages} total={visible.length}
          from={visible.length ? (safePage - 1) * PER_PAGE + 1 : 0} to={Math.min(safePage * PER_PAGE, visible.length)}
          onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => Math.min(totalPages, p + 1))} />
      </div>

      {adding && (
        <CompanyModal title="Add Company" canDelete={canDelete}
          initial={{ name: '', base_rate: 0, threshold_kwh: 1000, discounted_rate: 0, invoice_email: null, invoice_cc_emails: [], contract_path: null, contract_filename: null }}
          onSave={addCompany} onClose={() => setAdding(false)} />
      )}
      {editing && (
        <CompanyModal key={editing.id} title="Edit Company" canDelete={canDelete}
          initial={{
            name: editing.name,
            base_rate: editing.base_rate,
            threshold_kwh: editing.threshold_kwh,
            discounted_rate: editing.discounted_rate,
            invoice_email: editing.invoice_email,
            invoice_cc_emails: editing.invoice_cc_emails ?? [],
            contract_path: editing.contract_path,
            contract_filename: editing.contract_filename,
          }}
          onSave={(data) => updateCompany(editing.id, data)}
          onDelete={canDelete ? () => deleteCompany(editing.id, editing.contract_path) : undefined}
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
  const { can } = usePermissions();
  const canEdit   = can('corporatecrm', 'can_edit');
  const canDelete = can('corporatecrm', 'can_delete');

  const [vehicles, setVehicles] = useState<CRMVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState(''); // '' = all, 'unassigned' = no company, otherwise company.id
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
    if (companyFilter === 'unassigned' && v.company_id) return false;
    if (companyFilter && companyFilter !== 'unassigned' && v.company_id !== companyFilter) return false;
    const q = search.toLowerCase();
    if (!q) return true;
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
        <CompanyFilter value={companyFilter} companies={companies}
          onChange={(v) => { setCompanyFilter(v); setPage(1); setSelected(new Set()); }} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {canDelete && selected.size > 0 && !batchConfirm && (
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
          {canEdit && (
            <button onClick={() => setAdding(true)}
              style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + Add Vehicle
            </button>
          )}
        </div>
      </div>

      {canDelete && batchConfirm && (
        <BatchConfirmBar count={selected.size} noun="vehicle" deleting={batchDeleting}
          onConfirm={batchDelete} onCancel={() => setBatchConfirm(false)} />
      )}

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {canDelete && (
                  <th style={{ padding: '12px 16px', borderBottom: '1px solid #EBEBEB', width: 40 }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll}
                      style={{ cursor: 'pointer', width: 15, height: 15, accentColor: C.green }} />
                  </th>
                )}
                {['#', 'Vehicle Plate', 'Company'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((v, i) => {
                const isSelected = selected.has(v.id);
                const cellCursor = canEdit ? 'pointer' : 'default';
                const openEdit = () => { if (canEdit) setEditing(v); };
                return (
                  <tr key={v.id} style={{ borderBottom: '1px solid #F3F3F3', background: isSelected ? '#FFF8F8' : 'transparent' }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? '#FFF8F8' : 'transparent'; }}>
                    {canDelete && (
                      <td style={{ padding: '12px 16px' }} onClick={(e) => { e.stopPropagation(); toggleOne(v.id); }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleOne(v.id)}
                          style={{ cursor: 'pointer', width: 15, height: 15, accentColor: C.green }} />
                      </td>
                    )}
                    <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate, cursor: cellCursor }} onClick={openEdit}>{(safePage - 1) * PER_PAGE + i + 1}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green, fontFamily: 'monospace', letterSpacing: '0.05em', cursor: cellCursor }} onClick={openEdit}>{v.vehicle_plate}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: v.crm_companies ? '#1a1a1a' : C.slate, cursor: cellCursor }} onClick={openEdit}>
                      {v.crm_companies?.name ?? <span style={{ fontStyle: 'italic' }}>Unassigned</span>}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={canDelete ? 4 : 3} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No vehicles match your search.</td></tr>
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
          onDelete={canDelete ? () => deleteVehicle(editing.id) : undefined}
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
    <div
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
  const { can } = usePermissions();
  const canEdit   = can('corporatecrm', 'can_edit');
  const canDelete = can('corporatecrm', 'can_delete');

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
          {canDelete && selected.size > 0 && !batchConfirm && (
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
          {canEdit && (
            <button onClick={() => setAdding(true)}
              style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + Add Driver
            </button>
          )}
        </div>
      </div>

      {canDelete && batchConfirm && (
        <BatchConfirmBar count={selected.size} noun="driver" deleting={batchDeleting}
          onConfirm={batchDelete} onCancel={() => setBatchConfirm(false)} />
      )}

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {canDelete && (
                  <th style={{ padding: '12px 16px', borderBottom: '1px solid #EBEBEB', width: 40 }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll}
                      style={{ cursor: 'pointer', width: 15, height: 15, accentColor: C.green }} />
                  </th>
                )}
                {['#', 'Driver Email', 'Company'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((d, i) => {
                const isSelected = selected.has(d.id);
                const cellCursor = canEdit ? 'pointer' : 'default';
                const openEdit = () => { if (canEdit) setEditing(d); };
                return (
                  <tr key={d.id} style={{ borderBottom: '1px solid #F3F3F3', background: isSelected ? '#FFF8F8' : 'transparent' }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? '#FFF8F8' : 'transparent'; }}>
                    {canDelete && (
                      <td style={{ padding: '12px 16px' }} onClick={(e) => { e.stopPropagation(); toggleOne(d.id); }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleOne(d.id)}
                          style={{ cursor: 'pointer', width: 15, height: 15, accentColor: C.green }} />
                      </td>
                    )}
                    <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate, cursor: cellCursor }} onClick={openEdit}>{(safePage - 1) * PER_PAGE + i + 1}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: C.green, cursor: cellCursor }} onClick={openEdit}>{d.driver_email}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: d.crm_companies ? '#1a1a1a' : C.slate, cursor: cellCursor }} onClick={openEdit}>
                      {d.crm_companies?.name ?? <span style={{ fontStyle: 'italic' }}>Unassigned</span>}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={canDelete ? 4 : 3} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No drivers match your search.</td></tr>
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
          onDelete={canDelete ? () => deleteDriver(editing.id) : undefined}
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
    { id: 'opening',   label: 'Account Opening' },
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
      {tab === 'opening'   && <AccountOpening />}
    </div>
  );
}
