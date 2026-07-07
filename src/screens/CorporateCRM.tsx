import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../lib/useIsMobile';
import { AccountOpening } from './crm/AccountOpening';
import { usePermissions } from '../permissions';
import { Search, Download as DownloadIcon, Mail, ChevronDown, RotateCw } from 'lucide-react';
import { FileText } from 'lucide-react';

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
  is_managed_cpo?: boolean;
}

const CONTRACT_BUCKET = 'crm-contracts';

interface CRMVehicle {
  id: string;
  vehicle_plate: string;
  company_id: string | null;
  crm_companies: { name: string } | null;
}

type CRMTab = 'companies' | 'managed' | 'vehicles' | 'sp' | 'opening' | 'email' | 'email_design' | 'email_audit';

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
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 14 }}><Search size={14} /></span>
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
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 14 }}><Search size={14} /></span>
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
  invoicingOnly?: boolean;
  onSave: (data: Omit<CRMCompany, 'id'>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function CompanyModal({ initial, title, canDelete, invoicingOnly = false, onSave, onDelete, onClose }: CompanyModalProps) {
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

  const textField = (label: string, key: 'name' | 'base_rate' | 'threshold_kwh' | 'discounted_rate' | 'invoice_email', type = 'text', placeholder?: string) => {
    const locked = invoicingOnly && key !== 'invoice_email';
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <input
          type={type}
          step={type === 'number' ? '0.001' : undefined}
          placeholder={placeholder}
          disabled={locked}
          value={form[key] == null ? '' : String(form[key])}
          onChange={(e) => setForm((f) => ({
            ...f,
            [key]: type === 'number'
              ? Number(e.target.value)
              : (key === 'invoice_email' ? (e.target.value || null) : e.target.value),
          }))}
          style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: locked ? C.seasalt : C.white, color: locked ? C.slate : '#1a1a1a', cursor: locked ? 'not-allowed' : 'text' }}
        />
      </div>
    );
  };

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
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 480, maxWidth: 'calc(100vw - 24px)', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Figtree' }}>×</button>
        </div>
        {textField('Company Name', 'name')}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pricing Rates (SGD / kWh)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
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
        {!invoicingOnly && (
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contract</div>
          {initial.contract_path && initial.contract_filename && !removeContract && !contractFile && (
            <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <FileText size={14} strokeWidth={1.75} style={{display:"inline-flex",color:"#5B6B7A"}}/>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {initial.contract_filename}
              </div>
              <button type="button" onClick={viewContract}
                style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                View
              </button>
              <button type="button" onClick={downloadContract}
                style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                <DownloadIcon size={12} strokeWidth={2.25} style={{display:"inline",verticalAlign:"-2px",marginRight:4}}/> Download
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
        )}
        {invoicingOnly && (
          <div style={{ background: C.honeydew, color: C.green, borderRadius: 10, padding: '8px 12px', fontSize: 11, fontWeight: 600, lineHeight: 1.5 }}>
            You can only update the invoice email and CC list. Other fields are locked by your role.
          </div>
        )}

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this company?</div>
            <div style={{ fontSize: 12, color: '#C0321A' }}>All of its GoParkin vehicles and SP drivers will be removed too. This action is permanent and cannot be undone.</div>
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
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 440, maxWidth: 'calc(100vw - 24px)', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
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
          {noun === 'company' ? 'All GoParkin vehicles and SP drivers linked to ' + (count !== 1 ? 'these companies' : 'this company') + ' will be removed too. ' : ''}This action is permanent and cannot be undone.
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
  const canEditInvoicing  = can('corporatecrm_invoicing', 'can_edit');
  const canOpenEdit       = canEdit || canEditInvoicing;
  const invoicingOnlyMode = !canEdit && canEditInvoicing;

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CRMCompany | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  // Billable companies only — managed-CPO accounts live in their own tab and aren't invoiced.
  const billable = companies.filter((c) => !c.is_managed_cpo);
  const priced = billable.filter((c) => c.base_rate > 0);
  const avgBase = priced.length ? priced.reduce((s, c) => s + Number(c.base_rate), 0) / priced.length : 0;
  const withDiscount = priced.filter((c) => Number(c.discounted_rate) < Number(c.base_rate)).length;
  const visible = billable.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  // Export the pricing table (respecting the current search) as CSV.
  const exportCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [
      ['Company Name', 'Base Rate', 'Threshold (kWh)', 'Discounted Rate'],
      ...[...visible].sort((a, b) => a.name.localeCompare(b.name)).map((c) => [
        c.name, Number(c.base_rate), Number(c.threshold_kwh), Number(c.discounted_rate),
      ]),
    ];
    const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `corporate-companies-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Total Companies"   value={String(billable.length)} sub="registered accounts" accent />
        <KPICard label="Avg Base Rate"     value={`$${avgBase.toFixed(3)}`} sub="SGD per kWh" />
        <KPICard label="Volume Discounts"  value={String(withDiscount)} sub="companies with tiered pricing" />
        <KPICard label="Unpriced Accounts" value={String(companies.length - priced.length)} sub="pending rate setup" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 260 }}>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search companies…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}><Search size={14} /></span>
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
          <button onClick={exportCsv} disabled={visible.length === 0}
            title="Export company name, base rate, threshold & discounted rate as CSV"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: visible.length === 0 ? 'default' : 'pointer', opacity: visible.length === 0 ? 0.5 : 1 }}>
            <DownloadIcon size={14} strokeWidth={2.25} /> Export
          </button>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
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
                const cellCursor = canOpenEdit ? 'pointer' : 'default';
                const openEdit = () => { if (canOpenEdit) setEditing(c); };
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
        <CompanyModal key={editing.id} title="Edit Company"
          canDelete={canDelete && !invoicingOnlyMode}
          invoicingOnly={invoicingOnlyMode}
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
          onSave={async (data) => {
            // Invoicing-only role can ONLY patch the two invoicing fields. Everything else stays unchanged
            // even if the modal somehow surfaces stale form values for them.
            if (invoicingOnlyMode) {
              await supabase.from('crm_companies').update({
                invoice_email:     data.invoice_email,
                invoice_cc_emails: data.invoice_cc_emails,
              }).eq('id', editing.id);
              await onRefresh();
            } else {
              await updateCompany(editing.id, data);
            }
          }}
          onDelete={canDelete && !invoicingOnlyMode ? () => deleteCompany(editing.id, editing.contract_path) : undefined}
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Total Vehicles"     value={String(vehicles.length)} sub="registered plates" accent />
        <KPICard label="Companies Covered"  value={String(companiesCovered)} sub="with GoParkin vehicles" />
        <KPICard label="Avg per Company"    value={String(avgPerCompany)} sub="vehicles per account" />
        <KPICard label="Unassigned"         value={String(vehicles.filter((v) => !v.company_id).length)} sub="no company linked" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 280 }}>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search plate or company…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}><Search size={14} /></span>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
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
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 440, maxWidth: 'calc(100vw - 24px)', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Total Drivers"      value={String(drivers.length)} sub="registered SP accounts" accent />
        <KPICard label="Companies Covered"  value={String(companiesCovered)} sub="with SP drivers" />
        <KPICard label="Avg per Company"    value={companiesCovered ? (drivers.length / companiesCovered).toFixed(1) : '—'} sub="drivers per account" />
        <KPICard label="Unassigned"         value={String(drivers.filter((d) => !d.company_id).length)} sub="no company linked" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 300 }}>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search email or company…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}><Search size={14} /></span>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
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

// ── Email Audit ───────────────────────────────────────────────────
// History of every notification send, the Resend daily quota, and
// one-click resend of recipients that failed (e.g. after the limit reset).

const RESEND_DAILY_LIMIT = 100; // Resend free tier; quota resets at midnight UTC

interface EmailBatch {
  id: string;
  subject: string;
  body: string;
  from_address: string;
  reply_to: string | null;
  include_cc: boolean;
  sent_by: string | null;
  created_at: string;
}

interface EmailLogRow {
  id: string;
  batch_id: string;
  company_id: string | null;
  company_name: string;
  to_email: string;
  cc: string[];
  status: 'sent' | 'failed';
  error: string | null;
  attempts: number;
  sent_at: string | null;
}

function EmailAuditTab({ companies }: { companies: CRMCompany[] }) {
  const { can } = usePermissions();
  const canSend = can('corporatecrm', 'can_edit');

  const [batches, setBatches] = useState<EmailBatch[]>([]);
  const [logs, setLogs] = useState<EmailLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resending, setResending] = useState<{ batchId: string; done: number; total: number } | null>(null);
  const [brand, setBrand] = useState<EmailBrand>(DEFAULT_BRAND);

  const fetchAll = async () => {
    const [b, l, br] = await Promise.all([
      supabase.from('crm_email_batches').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('crm_email_log').select('*').order('created_at'),
      fetchBrand(),
    ]);
    const err = b.error ?? l.error;
    if (err) { setError(err.message); setLoading(false); return; }
    setBatches((b.data ?? []) as EmailBatch[]);
    setLogs((l.data ?? []) as EmailLogRow[]);
    setBrand(br);
    setLoading(false);
  };

  useEffect(() => { void fetchAll(); }, []);

  // Resend's quota resets at midnight UTC — count successful sends today (UTC).
  const utcToday = new Date().toISOString().slice(0, 10);
  const sentToday = logs.filter((r) => r.sent_at && r.sent_at.slice(0, 10) === utcToday).length;
  const remaining = Math.max(0, RESEND_DAILY_LIMIT - sentToday);
  const usagePct = Math.min(100, Math.round((sentToday / RESEND_DAILY_LIMIT) * 100));

  const logsByBatch = new Map<string, EmailLogRow[]>();
  for (const r of logs) {
    const arr = logsByBatch.get(r.batch_id) ?? [];
    arr.push(r);
    logsByBatch.set(r.batch_id, arr);
  }

  const resendFailed = async (batch: EmailBatch) => {
    const failedRows = (logsByBatch.get(batch.id) ?? []).filter((r) => r.status === 'failed');
    if (failedRows.length === 0 || resending) return;
    setError(null);
    setResending({ batchId: batch.id, done: 0, total: failedRows.length });
    for (let i = 0; i < failedRows.length; i++) {
      const row = failedRows[i];
      // Prefer the company's current invoice email in case it was fixed since.
      const company = row.company_id ? companies.find((c) => c.id === row.company_id) : undefined;
      const to = company?.invoice_email || row.to_email;
      const cc = batch.include_cc ? (company?.invoice_cc_emails ?? row.cc ?? []) : [];
      const subj = batch.subject.replace(/\{\{\s*company\s*\}\}/gi, row.company_name);
      const html = buildEmailHtml(batch.body, row.company_name, brand);
      let errMsg: string | null = null;
      try {
        const { data, error: err } = await supabase.functions.invoke('send-customer-email', {
          body: { to: [to], cc, subject: subj, html, from: batch.from_address, replyTo: batch.reply_to || undefined },
        });
        errMsg = (data as { error?: string } | null)?.error ?? err?.message ?? null;
      } catch (e) {
        errMsg = (e as Error).message || 'failed';
      }
      await supabase.from('crm_email_log').update({
        status: errMsg ? 'failed' : 'sent',
        error: errMsg,
        attempts: row.attempts + 1,
        to_email: to,
        sent_at: errMsg ? null : new Date().toISOString(),
      }).eq('id', row.id);
      setResending({ batchId: batch.id, done: i + 1, total: failedRows.length });
    }
    setResending(null);
    await fetchAll();
  };

  if (loading) {
    return <div style={{ padding: '60px 20px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading send history…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {/* Daily quota */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Resend Daily Quota</span>
          <span style={{ fontSize: 12, color: C.slate }}>resets at midnight UTC</span>
          <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: remaining === 0 ? '#C0321A' : '#1a1a1a' }}>
            {sentToday} / {RESEND_DAILY_LIMIT} sent today · {remaining} remaining
          </span>
        </div>
        <div style={{ height: 10, borderRadius: 99, background: '#F3F3F3', overflow: 'hidden' }}>
          <div style={{ width: `${usagePct}%`, height: '100%', borderRadius: 99, background: usagePct >= 100 ? '#C0321A' : usagePct >= 80 ? '#B07D00' : C.green, transition: 'width .3s' }} />
        </div>
        {remaining === 0 && (
          <div style={{ fontSize: 12, color: '#C0321A', fontWeight: 600 }}>
            Daily limit reached — failed recipients below can be resent after the quota resets.
          </div>
        )}
      </div>

      {/* Batch history */}
      {batches.length === 0 ? (
        <div style={{ background: C.white, borderRadius: 16, border: '1px dashed #EBEBEB', padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ marginBottom: 12, display: 'inline-flex' }}><Mail size={32} strokeWidth={1.5} color={C.slate} /></div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginBottom: 4 }}>No sends recorded yet</div>
          <div style={{ fontSize: 12, color: C.slate }}>Every notification sent from the Notifications tab is logged here per recipient.</div>
        </div>
      ) : batches.map((b) => {
        const rows = logsByBatch.get(b.id) ?? [];
        const sentCount = rows.filter((r) => r.status === 'sent').length;
        const failedCount = rows.length - sentCount;
        const isOpen = expanded === b.id;
        const busy = resending?.batchId === b.id;
        const when = new Date(b.created_at).toLocaleString();
        return (
          <div key={b.id} style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
            <button onClick={() => setExpanded(isOpen ? null : b.id)}
              style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'Figtree', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.subject}</div>
                <div style={{ fontSize: 11, color: C.slate, marginTop: 3 }}>
                  {when} · {b.from_address}{b.sent_by ? ` · by ${b.sent_by}` : ''}
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: '#E4F3E3', color: '#1B512D' }}>{sentCount} sent</span>
              {failedCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: '#FDEAEA', color: '#C0321A' }}>{failedCount} failed</span>
              )}
              <ChevronDown size={16} strokeWidth={2.25} style={{ color: C.slate, transition: 'transform .15s', transform: isOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
            </button>

            {isOpen && (
              <div style={{ borderTop: '1px solid #F3F3F3' }}>
                {failedCount > 0 && canSend && (
                  <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#FFF8E1' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#B07D00', flex: 1, minWidth: 200 }}>
                      {failedCount} recipient{failedCount === 1 ? '' : 's'} did not receive this email.
                    </span>
                    <button onClick={() => void resendFailed(b)} disabled={!!resending}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none', background: resending ? '#A5D6A7' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: resending ? 'default' : 'pointer' }}>
                      <RotateCw size={13} strokeWidth={2.25} />
                      {busy ? `Resending ${resending!.done}/${resending!.total}…` : `Resend to ${failedCount} failed`}
                    </button>
                  </div>
                )}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: C.seasalt }}>
                        {['Company', 'Email', 'Status', 'Attempts', 'Sent At', 'Error'].map((h) => (
                          <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} style={{ borderBottom: '1px solid #F3F3F3' }}>
                          <td style={{ padding: '11px 16px', fontWeight: 600 }}>{r.company_name}</td>
                          <td style={{ padding: '11px 16px', color: C.slate }}>{r.to_email}{r.cc.length > 0 ? ` +${r.cc.length} cc` : ''}</td>
                          <td style={{ padding: '11px 16px' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: r.status === 'sent' ? '#E4F3E3' : '#FDEAEA', color: r.status === 'sent' ? '#1B512D' : '#C0321A' }}>
                              {r.status === 'sent' ? 'Sent' : 'Failed'}
                            </span>
                          </td>
                          <td style={{ padding: '11px 16px', color: C.slate }}>{r.attempts}</td>
                          <td style={{ padding: '11px 16px', color: C.slate }}>{r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}</td>
                          <td style={{ padding: '11px 16px', color: '#C0321A', fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.error ?? ''}>{r.error ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Managed CPO Tab ───────────────────────────────────────────────
// Companies EVOne manages but does NOT invoice. Their tagged vehicle plates flow through
// the same crm_vehicles matching, so their corporate charging records are MATCHED (leaving
// the Unmatched Records count) — but CorporateInvoicing skips them when generating statements.

function ManagedCpoTab({ companies, onRefresh }: { companies: CRMCompany[]; onRefresh: () => Promise<void> }) {
  const { can } = usePermissions();
  const canEdit = can('corporatecrm', 'can_edit');
  const managed = companies.filter((c) => c.is_managed_cpo).sort((a, b) => a.name.localeCompare(b.name));

  const [vehicles, setVehicles] = useState<{ id: string; vehicle_plate: string; company_id: string | null }[]>([]);
  const [newName, setNewName] = useState('');
  const [plateDraft, setPlateDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const managedKey = managed.map((c) => c.id).join(',');
  const reloadVehicles = async () => {
    const ids = managed.map((c) => c.id);
    if (!ids.length) { setVehicles([]); return; }
    const { data } = await supabase.from('crm_vehicles').select('id, vehicle_plate, company_id').in('company_id', ids).order('vehicle_plate');
    setVehicles((data ?? []) as { id: string; vehicle_plate: string; company_id: string | null }[]);
  };
  useEffect(() => { void reloadVehicles(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [managedKey]);

  const addCompany = async () => {
    const name = newName.trim(); if (!name || busy) return;
    setBusy(true); setError(null);
    try {
      const { error: e } = await supabase.from('crm_companies').insert({ name, is_managed_cpo: true, base_rate: 0, threshold_kwh: 0, discounted_rate: 0, invoice_cc_emails: [] });
      if (e) { setError(e.message); return; }
      setNewName('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the company.');
    } finally {
      setBusy(false);
    }
  };
  const addPlate = async (companyId: string) => {
    const plate = (plateDraft[companyId] ?? '').trim().toUpperCase(); if (!plate) return;
    setError(null);
    const { error: e } = await supabase.from('crm_vehicles').insert({ vehicle_plate: plate, company_id: companyId });
    if (e) { setError(e.message); return; }
    setPlateDraft((d) => ({ ...d, [companyId]: '' })); await reloadVehicles();
  };
  const removePlate = async (id: string) => { await supabase.from('crm_vehicles').delete().eq('id', id); await reloadVehicles(); };
  const removeCompany = async (id: string) => {
    if (!window.confirm('Remove this managed CPO company and its tagged vehicles?')) return;
    await supabase.from('crm_vehicles').delete().eq('company_id', id);
    await supabase.from('crm_companies').delete().eq('id', id);
    await onRefresh();
  };

  const platesByCompany = new Map<string, { id: string; vehicle_plate: string }[]>();
  for (const v of vehicles) { if (!v.company_id) continue; const arr = platesByCompany.get(v.company_id) ?? []; arr.push(v); platesByCompany.set(v.company_id, arr); }

  const pillInput: React.CSSProperties = { padding: '8px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>}

      <div style={{ background: C.honeydew, borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#1B512D', lineHeight: 1.55 }}>
        Managed CPO accounts are companies we operate but <strong>do not invoice</strong>. Tag their vehicle plates here — their corporate charging records get <strong>matched</strong> (so they leave the Unmatched Records count), but no statement is generated for them.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <KPICard label="Managed Companies" value={String(managed.length)} sub="not invoiced" accent />
        <KPICard label="Tagged Vehicles"   value={String(vehicles.length)} sub="matched, not billed" />
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Managed company name…"
            onKeyDown={(e) => { if (e.key === 'Enter') void addCompany(); }}
            style={{ ...pillInput, width: 300 }} />
          <button onClick={() => void addCompany()} disabled={busy || !newName.trim()}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: (busy || !newName.trim()) ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: (busy || !newName.trim()) ? 'default' : 'pointer' }}>
            + Add Managed Company
          </button>
        </div>
      )}

      {managed.length === 0 ? (
        <div style={{ background: C.white, border: '1px dashed #EBEBEB', borderRadius: 12, padding: '32px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
          No managed CPO companies yet.{canEdit && ' Add one above, then tag its vehicle plates.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {managed.map((c) => {
            const plates = platesByCompany.get(c.id) ?? [];
            return (
              <div key={c.id} style={{ background: C.white, borderRadius: 14, border: '1px solid #EBEBEB', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{c.name}</div>
                  <span style={{ fontSize: 11, color: C.slate }}>{plates.length} vehicle{plates.length === 1 ? '' : 's'}</span>
                  {canEdit && (
                    <button onClick={() => void removeCompany(c.id)}
                      style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {plates.length === 0 && <span style={{ fontSize: 12, color: C.slate, fontStyle: 'italic' }}>No vehicle plates tagged yet.</span>}
                  {plates.map((p) => (
                    <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.seasalt, border: '1px solid #EBEBEB', borderRadius: 99, padding: '4px 6px 4px 12px', fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>
                      {p.vehicle_plate}
                      {canEdit && (
                        <button onClick={() => void removePlate(p.id)} title="Remove plate"
                          style={{ width: 20, height: 20, borderRadius: 99, border: 'none', background: '#F3F3F3', color: C.slate, cursor: 'pointer', fontSize: 13, lineHeight: 1, fontFamily: 'Figtree' }}>×</button>
                      )}
                    </span>
                  ))}
                  {canEdit && (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input value={plateDraft[c.id] ?? ''} onChange={(e) => setPlateDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') void addPlate(c.id); }}
                        placeholder="Vehicle no." style={{ ...pillInput, width: 130, padding: '6px 10px', borderRadius: 99 }} />
                      <button onClick={() => void addPlate(c.id)} disabled={!(plateDraft[c.id] ?? '').trim()}
                        style={{ padding: '6px 12px', borderRadius: 99, border: `1px solid ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: (plateDraft[c.id] ?? '').trim() ? 'pointer' : 'default' }}>+ Tag</button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
    { id: 'managed',   label: 'Managed CPO' },
    { id: 'vehicles',  label: 'GoParkin Vehicles' },
    { id: 'sp',        label: 'SP Vehicles' },
    { id: 'opening',   label: 'Account Opening' },
    { id: 'email',     label: 'Notifications' },
    { id: 'email_design', label: 'Email Designer' },
    { id: 'email_audit', label: 'Email Audit' },
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
      {tab === 'managed'   && <ManagedCpoTab companies={companies} onRefresh={fetchCompanies} />}
      {tab === 'vehicles'  && <VehiclesTab  companies={companies} error={error} />}
      {tab === 'sp'        && <SPDriversTab companies={companies} error={error} />}
      {tab === 'opening'   && <AccountOpening />}
      {tab === 'email'     && <NotificationsTab companies={companies} />}
      {tab === 'email_design' && <EmailDesignerTab />}
      {tab === 'email_audit' && <EmailAuditTab companies={companies} />}
    </div>
  );
}

// ── Notifications (Resend email) ──────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface EmailBrand { logoUrl: string; headerTitle: string; footerText: string; accent: string; }

function buildEmailHtml(body: string, companyName: string, brand: EmailBrand): string {
  const safe = escapeHtml(body).replace(/\{\{\s*company\s*\}\}/gi, escapeHtml(companyName)).replace(/\n/g, '<br>');
  const accent = brand.accent || '#2A9A47';
  const title = (brand.headerTitle || '').trim();
  const header = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${escapeHtml(title || 'Logo')}" style="max-height:44px;max-width:220px;display:block;" />${title ? `<div style="margin-top:8px;color:#5B6B7A;font-size:13px;font-weight:600;">${escapeHtml(title)}</div>` : ''}`
    : `<span style="font-weight:700;color:${accent};font-size:20px;letter-spacing:-0.02em;">${escapeHtml(title || 'EVOne')}</span>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:0 16px;">
  <div style="border-top:4px solid ${accent};padding:18px 0 14px;">
    ${header}
  </div>
  <div style="font-size:14px;line-height:1.65;">${safe}</div>
  ${brand.footerText ? `<div style="margin-top:26px;border-top:1px solid #EBEBEB;padding-top:12px;font-size:12px;color:#5B6B7A;">${escapeHtml(brand.footerText).replace(/\n/g, '<br>')}</div>` : ''}
</div>`;
}

// Sender identities are admin-managed (Email Designer tab) and stored in the DB.
interface EmailSender { id: string; from_name: string; from_email: string; reply_to: string | null; }
const LAST_SENDER_STORAGE = 'evone_email_sender_id';
async function fetchSenders(): Promise<EmailSender[]> {
  const { data } = await supabase.from('email_senders').select('*').order('from_name');
  return (data as EmailSender[]) ?? [];
}

// Brand dropdown for choosing a sender identity.
function SenderSelect({ value, senders, onChange }: { value: string; senders: EmailSender[]; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const selected = senders.find((s) => s.id === value);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={senders.length === 0}
        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${open ? C.green : '#EBEBEB'}`, fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: senders.length === 0 ? '#F9F9F9' : C.white, cursor: senders.length === 0 ? 'default' : 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: selected ? '#1a1a1a' : C.slate, boxSizing: 'border-box' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {senders.length === 0 ? 'No sender identities configured' : selected ? `${selected.from_name} <${selected.from_email}>` : '— Select sender —'}
        </span>
        <span style={{ fontSize: 10, color: C.slate, marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && senders.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: C.white, borderRadius: 12, border: '1px solid #EBEBEB', boxShadow: '0 8px 32px rgba(0,0,0,.12)', zIndex: 2000, maxHeight: 260, overflowY: 'auto' }}>
          {senders.map((s) => {
            const isActive = s.id === value;
            return (
              <div key={s.id} onClick={() => { onChange(s.id); setOpen(false); }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = C.seasalt; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? C.honeydew : 'transparent'; }}
                style={{ padding: '9px 14px', cursor: 'pointer', background: isActive ? C.honeydew : 'transparent' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isActive ? C.green : '#1a1a1a' }}>{s.from_name}</div>
                <div style={{ fontSize: 11, color: C.slate, fontFamily: 'monospace' }}>{s.from_email}{s.reply_to ? ` · reply ${s.reply_to}` : ''}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Email branding is shared across all users — one row in crm_email_brand.
const BRAND_ROW_ID = 'default';
const DEFAULT_BRAND: EmailBrand = { logoUrl: '', headerTitle: 'EVOne Corporate Charging', footerText: 'This is a notification from EVOne Corporate Charging.', accent: '#2A9A47' };
async function fetchBrand(): Promise<EmailBrand> {
  const { data } = await supabase.from('crm_email_brand').select('data').eq('id', BRAND_ROW_ID).maybeSingle();
  const stored = (data as { data?: Partial<EmailBrand> } | null)?.data ?? {};
  return { ...DEFAULT_BRAND, ...stored };
}

function NotificationsTab({ companies }: { companies: CRMCompany[] }) {
  const isMobile = useIsMobile();
  const { can, user } = usePermissions();
  const canSend = can('corporatecrm', 'can_edit');

  const recipients = companies.filter((c) => !!(c.invoice_email && c.invoice_email.trim()));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [includeCc, setIncludeCc] = useState(true);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ sent: number; failed: { name: string; error: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sender identity — kept in this browser so it doesn't need re-typing.
  const [senders, setSenders] = useState<EmailSender[]>([]);
  const [senderId, setSenderId] = useState<string>(() => { try { return localStorage.getItem(LAST_SENDER_STORAGE) ?? ''; } catch { return ''; } });
  useEffect(() => {
    fetchSenders().then((list) => {
      setSenders(list);
      setSenderId((cur) => (cur && list.some((s) => s.id === cur) ? cur : (list[0]?.id ?? '')));
    });
  }, []);
  useEffect(() => { try { localStorage.setItem(LAST_SENDER_STORAGE, senderId); } catch { /* ignore */ } }, [senderId]);
  const selectedSender = senders.find((s) => s.id === senderId) ?? null;
  const fromAddress = selectedSender ? `${selectedSender.from_name} <${selectedSender.from_email}>` : '';
  const replyToVal = selectedSender?.reply_to ?? '';

  // Branding (logo + header + footer) is designed in the Email Designer tab and
  // shared across all users via Supabase.
  const [brand, setBrand] = useState<EmailBrand>(DEFAULT_BRAND);
  useEffect(() => { void fetchBrand().then(setBrand); }, []);

  const filtered = recipients.filter((c) => {
    const q = search.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || (c.invoice_email ?? '').toLowerCase().includes(q);
  });
  const allSelected = recipients.length > 0 && selected.size === recipients.length;
  const toggle = (id: string) => setSelected((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(recipients.map((c) => c.id)));

  const targets = recipients.filter((c) => selected.has(c.id));
  const canSubmit = canSend && targets.length > 0 && !!subject.trim() && !!body.trim() && !!selectedSender && !sending;

  const send = async () => {
    if (!canSubmit) return;
    setError(null); setResult(null);
    setSending({ done: 0, total: targets.length });

    // Audit trail — every recipient gets a crm_email_log row, so partial sends
    // (e.g. hitting the Resend daily limit) can be resumed from the Email Audit tab.
    const { data: batchRow, error: batchErr } = await supabase
      .from('crm_email_batches')
      .insert({ subject, body, from_address: fromAddress, reply_to: replyToVal || null, include_cc: includeCc, sent_by: user.full_name })
      .select('id')
      .single();
    if (batchErr) { setError(`Could not start the send audit log: ${batchErr.message}`); setSending(null); return; }
    const batchId = (batchRow as { id: string }).id;

    let sent = 0;
    const failed: { name: string; error: string }[] = [];
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      const subj = subject.replace(/\{\{\s*company\s*\}\}/gi, c.name);
      const html = buildEmailHtml(body, c.name, brand);
      const cc = includeCc ? (c.invoice_cc_emails ?? []) : [];
      let errMsg: string | null = null;
      try {
        const { data, error: err } = await supabase.functions.invoke('send-customer-email', {
          body: { to: [c.invoice_email], cc, subject: subj, html, from: fromAddress, replyTo: replyToVal || undefined },
        });
        errMsg = (data as { error?: string } | null)?.error ?? err?.message ?? null;
      } catch (e) {
        errMsg = (e as Error).message || 'failed';
      }
      if (errMsg) failed.push({ name: c.name, error: errMsg }); else sent++;
      await supabase.from('crm_email_log').insert({
        batch_id: batchId,
        company_id: c.id,
        company_name: c.name,
        to_email: c.invoice_email,
        cc,
        status: errMsg ? 'failed' : 'sent',
        error: errMsg,
        sent_at: errMsg ? null : new Date().toISOString(),
      });
      setSending({ done: i + 1, total: targets.length });
    }
    setSending(null);
    setResult({ sent, failed });
  };

  const field: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '340px 1fr', gap: 16, alignItems: 'start' }}>
      {/* Recipients */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 14, borderBottom: '1px solid #F3F3F3', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recipients · {selected.size}/{recipients.length}</span>
            <button onClick={toggleAll} style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, border: '1px solid #EBEBEB', background: C.white, color: C.slate, cursor: 'pointer', fontFamily: 'Figtree' }}>
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies…"
              style={{ width: '100%', padding: '7px 12px 7px 30px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.seasalt, boxSizing: 'border-box' }} />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate, display: 'inline-flex' }}><Search size={13} /></span>
          </div>
        </div>
        <div style={{ maxHeight: '62vh', overflowY: 'auto', padding: 8 }}>
          {filtered.map((c) => {
            const isSel = selected.has(c.id);
            return (
              <label key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 10px', borderRadius: 10, cursor: 'pointer', background: isSel ? C.honeydew : 'transparent' }}
                onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = C.seasalt; }}
                onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}>
                <input type="checkbox" checked={isSel} onChange={() => toggle(c.id)} style={{ accentColor: C.green, marginTop: 2 }} />
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isSel ? C.green : '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: C.slate, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.invoice_email}</div>
                  {includeCc && (c.invoice_cc_emails?.length ?? 0) > 0 && (
                    <div style={{ fontSize: 10, color: C.slate }}>+{c.invoice_cc_emails.length} cc</div>
                  )}
                </div>
              </label>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: C.slate, fontSize: 12 }}>
              {recipients.length === 0 ? 'No companies have an invoice email. Add one on the Companies tab.' : 'No matches.'}
            </div>
          )}
        </div>
      </div>

      {/* Compose */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>}
        {result && (
          <div style={{ background: result.failed.length === 0 ? C.honeydew : '#FFF8E1', color: result.failed.length === 0 ? C.green : '#B07D00', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>
            <div style={{ fontWeight: 700 }}>✓ Sent {result.sent} email{result.sent === 1 ? '' : 's'}{result.failed.length > 0 ? ` · ${result.failed.length} failed` : ''}.</div>
            {result.failed.slice(0, 5).map((f) => <div key={f.name} style={{ fontSize: 11, marginTop: 2 }}>{f.name}: {f.error}</div>)}
            {result.failed.length > 0 && (
              <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600 }}>
                Failed recipients are tracked in the <strong>Email Audit</strong> tab — resend them from there once the quota allows.
              </div>
            )}
          </div>
        )}

        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Compose notification</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
              Sent via Resend to each selected company's invoice email. Use <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4 }}>{'{{company}}'}</code> to insert the company name.
            </div>
          </div>

          <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <FieldLabel>Sender</FieldLabel>
            <SenderSelect value={senderId} senders={senders} onChange={setSenderId} />
            {selectedSender ? (
              <div style={{ fontSize: 12, color: C.slate, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                <span>From <strong style={{ color: '#1a1a1a' }}>{selectedSender.from_name} &lt;{selectedSender.from_email}&gt;</strong></span>
                <span>Reply-To <strong style={{ color: '#1a1a1a' }}>{selectedSender.reply_to || '—'}</strong></span>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#B07D00' }}>
                No sender identities yet. An admin can add them in the <strong>Email Designer</strong> tab.
              </div>
            )}
          </div>

          <div>
            <FieldLabel>Subject</FieldLabel>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Your April charging statement is ready" style={field} />
          </div>
          <div>
            <FieldLabel>Message</FieldLabel>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder={'Dear {{company}},\n\n…'}
              style={{ ...field, resize: 'vertical', lineHeight: 1.6 }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1a1a1a', cursor: 'pointer' }}>
            <input type="checkbox" checked={includeCc} onChange={(e) => setIncludeCc(e.target.checked)} style={{ accentColor: C.green }} />
            Include each company's CC list
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {sending && <span style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>Sending {sending.done} / {sending.total}…</span>}
            <button onClick={send} disabled={!canSubmit}
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 10, border: 'none', background: canSubmit ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'default' }}>
              <Mail size={15} strokeWidth={2.25} /> {sending ? 'Sending…' : `Send to ${targets.length} compan${targets.length === 1 ? 'y' : 'ies'}`}
            </button>
          </div>
          {!canSend && <div style={{ fontSize: 12, color: '#B07D00' }}>You don't have permission to send emails.</div>}
        </div>

        {/* Live preview */}
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Preview</div>
            <div style={{ fontSize: 11, color: C.slate }}>as {targets[0]?.name ?? 'Sample Company Pte Ltd'}</div>
          </div>
          <div style={{ fontSize: 12, color: C.slate }}><strong style={{ color: '#1a1a1a' }}>Subject:</strong> {(subject || '(no subject)').replace(/\{\{\s*company\s*\}\}/gi, targets[0]?.name ?? 'Sample Company Pte Ltd')}</div>
          <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, padding: 16, background: '#FFFFFF', maxHeight: 460, overflowY: 'auto' }}
            dangerouslySetInnerHTML={{ __html: buildEmailHtml(body || 'Your message preview appears here.', targets[0]?.name ?? 'Sample Company Pte Ltd', brand) }} />
        </div>
      </div>
    </div>
  );
}

// ── Email Designer ────────────────────────────────────────────────

const SAMPLE_BODY = 'Dear {{company}},\n\nThis is a preview of how your notification emails will look. Edit the message on the Notifications tab.\n\nThank you,\nEVOne Corporate Charging';

function EmailDesignerTab() {
  const { can } = usePermissions();
  const canEdit = can('corporatecrm', 'can_edit');
  const canManageSenders = can('corporatecrm', 'can_delete');

  const [brand, setBrand] = useState<EmailBrand>(DEFAULT_BRAND);
  const [brandLoaded, setBrandLoaded] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchBrand().then((b) => { if (live) { setBrand(b); setBrandLoaded(true); } });
    return () => { live = false; };
  }, []);

  // Sender identities — admin-managed (delete permission), used by the Notifications dropdown.
  const [senders, setSenders] = useState<EmailSender[]>([]);
  const [newSender, setNewSender] = useState({ from_name: '', from_email: '', reply_to: '' });
  const [senderBusy, setSenderBusy] = useState(false);
  const loadSenderList = () => fetchSenders().then(setSenders);
  useEffect(() => { loadSenderList(); }, []);

  const addSender = async () => {
    if (!newSender.from_name.trim() || !newSender.from_email.trim()) return;
    setSenderBusy(true);
    setError(null);
    const { error: err } = await supabase.from('email_senders').insert({
      from_name: newSender.from_name.trim(),
      from_email: newSender.from_email.trim(),
      reply_to: newSender.reply_to.trim() || null,
    });
    if (err) setError(err.message);
    else { setNewSender({ from_name: '', from_email: '', reply_to: '' }); await loadSenderList(); }
    setSenderBusy(false);
  };
  const removeSender = async (id: string) => {
    setSenderBusy(true);
    const { error: err } = await supabase.from('email_senders').delete().eq('id', id);
    if (err) setError(err.message); else await loadSenderList();
    setSenderBusy(false);
  };

  // Debounced shared save — every edit persists to Supabase so all users see
  // the same design. Skips the initial load.
  useEffect(() => {
    if (!brandLoaded) return;
    const t = window.setTimeout(() => {
      supabase
        .from('crm_email_brand')
        .upsert({ id: BRAND_ROW_ID, data: brand, updated_at: new Date().toISOString() })
        .then(({ error: err }) => {
          if (err) { setError(`Could not save design: ${err.message}`); return; }
          setSaved(true);
          window.setTimeout(() => setSaved(false), 1500);
        });
    }, 600);
    return () => window.clearTimeout(t);
  }, [brand, brandLoaded]);

  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingLogo(true);
    setError(null);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const path = `logo_${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage.from('email-assets').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const url = supabase.storage.from('email-assets').getPublicUrl(path).data.publicUrl;
      setBrand((b) => ({ ...b, logoUrl: url }));
    } catch (err) {
      setError(`Logo upload failed: ${(err as Error).message}`);
    } finally {
      setUploadingLogo(false);
    }
  };

  const field: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
  const disabled = !canEdit;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, alignItems: 'start' }}>
      {/* Editor */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>}
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Email Designer</div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>The logo, header and footer applied to every notification email. Saved automatically.</div>
            </div>
            {saved && <span style={{ fontSize: 11, fontWeight: 700, color: C.green, background: C.honeydew, padding: '3px 10px', borderRadius: 99 }}>Saved</span>}
          </div>

          <div>
            <FieldLabel>Logo</FieldLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {brand.logoUrl
                ? <img src={brand.logoUrl} alt="logo" style={{ maxHeight: 48, maxWidth: 220, borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, padding: 4 }} />
                : <div style={{ height: 48, padding: '0 16px', display: 'inline-flex', alignItems: 'center', borderRadius: 8, border: '1px dashed #CBD5DD', background: C.seasalt, color: C.slate, fontSize: 12 }}>No logo</div>}
              {canEdit && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: uploadingLogo ? 'default' : 'pointer' }}>
                  {uploadingLogo ? 'Uploading…' : brand.logoUrl ? 'Replace logo' : 'Upload logo'}
                  <input type="file" accept="image/*" disabled={uploadingLogo} style={{ display: 'none' }} onChange={uploadLogo} />
                </label>
              )}
              {canEdit && brand.logoUrl && (
                <button onClick={() => setBrand((b) => ({ ...b, logoUrl: '' }))}
                  style={{ padding: 0, border: 'none', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Remove</button>
              )}
            </div>
            <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>Hosted so it displays in email clients (data-URI images are blocked). PNG with transparent background works best.</div>
          </div>

          <div>
            <FieldLabel>Header Title</FieldLabel>
            <input value={brand.headerTitle} disabled={disabled} onChange={(e) => setBrand((b) => ({ ...b, headerTitle: e.target.value }))} placeholder="EVOne Corporate Charging" style={field} />
            <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>Appears under the logo (and becomes the wordmark when no logo is set).</div>
          </div>

          <div>
            <FieldLabel>Accent Colour</FieldLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="color" value={brand.accent || '#2A9A47'} disabled={disabled} onChange={(e) => setBrand((b) => ({ ...b, accent: e.target.value }))}
                style={{ width: 44, height: 36, borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, cursor: disabled ? 'default' : 'pointer' }} />
              <input value={brand.accent || '#2A9A47'} disabled={disabled} onChange={(e) => setBrand((b) => ({ ...b, accent: e.target.value }))} style={{ ...field, width: 140 }} />
              <button onClick={() => setBrand((b) => ({ ...b, accent: '#2A9A47' }))} disabled={disabled}
                style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer' }}>Brand green</button>
            </div>
          </div>

          <div>
            <FieldLabel>Footer Text</FieldLabel>
            <textarea value={brand.footerText} disabled={disabled} rows={2} onChange={(e) => setBrand((b) => ({ ...b, footerText: e.target.value }))}
              placeholder="This is a notification from EVOne Corporate Charging." style={{ ...field, resize: 'vertical' }} />
          </div>

          {!canEdit && <div style={{ fontSize: 12, color: '#B07D00' }}>You don't have permission to edit the email design.</div>}
        </div>

        {canManageSenders && (
          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Sender Identities</div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>The From / Reply-To options shown in the Notifications dropdown. The From email must be on your Resend-verified domain.</div>
            </div>
            {senders.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {senders.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB' }}>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{s.from_name}</div>
                      <div style={{ fontSize: 11, color: C.slate, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.from_email}{s.reply_to ? ` · reply ${s.reply_to}` : ''}</div>
                    </div>
                    <button onClick={() => removeSender(s.id)} disabled={senderBusy}
                      style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: senderBusy ? 'default' : 'pointer' }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <div>
                <FieldLabel>From Name</FieldLabel>
                <input value={newSender.from_name} onChange={(e) => setNewSender((v) => ({ ...v, from_name: e.target.value }))} placeholder="EVOne Corporate Charging" style={field} />
              </div>
              <div>
                <FieldLabel>From Email</FieldLabel>
                <input type="email" value={newSender.from_email} onChange={(e) => setNewSender((v) => ({ ...v, from_email: e.target.value }))} placeholder="billing@yourdomain.com" style={field} />
              </div>
            </div>
            <div>
              <FieldLabel>Reply-To</FieldLabel>
              <input type="email" value={newSender.reply_to} onChange={(e) => setNewSender((v) => ({ ...v, reply_to: e.target.value }))} placeholder="replies@yourdomain.com" style={field} />
            </div>
            <button onClick={addSender} disabled={senderBusy || !newSender.from_name.trim() || !newSender.from_email.trim()}
              style={{ alignSelf: 'flex-start', padding: '9px 20px', borderRadius: 10, border: 'none', background: (senderBusy || !newSender.from_name.trim() || !newSender.from_email.trim()) ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + Add sender identity
            </button>
          </div>
        )}
      </div>

      {/* Live preview */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10, position: 'sticky', top: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Preview</div>
        <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, padding: 16, background: '#FFFFFF', maxHeight: '70vh', overflowY: 'auto' }}
          dangerouslySetInnerHTML={{ __html: buildEmailHtml(SAMPLE_BODY, 'Sample Company Pte Ltd', brand) }} />
      </div>
    </div>
  );
}
