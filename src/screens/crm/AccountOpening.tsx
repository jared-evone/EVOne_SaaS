import { useEffect, useMemo, useState } from 'react';
import { C } from '../../theme';
import { KPICard } from '../../components/KPICard';
import { supabase } from '../../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────

export type CustomFieldType = 'text' | 'textarea' | 'email' | 'phone';

export interface CustomField {
  id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  placeholder: string;
}

export interface FormTemplate {
  id: string;
  name: string;
  intro_text: string | null;
  contract_text: string | null;
  custom_fields: CustomField[];
  vehicles_required: boolean;
  sp_drivers_required: boolean;
  is_active: boolean;
  goparkin_pdf_path: string | null;
  goparkin_pdf_filename: string | null;
  sp_pdf_path: string | null;
  sp_pdf_filename: string | null;
  contract_pdf_path: string | null;
  contract_pdf_filename: string | null;
}

export const INSTRUCTION_BUCKET = 'crm-instructions';

export type ApplicationStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export interface Application {
  id: string;
  token: string;
  template_id: string | null;
  invited_email: string | null;
  company_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_address: string | null;
  vehicle_plates: string[];
  sp_driver_emails: string[];
  custom_responses: Record<string, string>;
  rfid_cards_requested: boolean;
  rfid_cards_quantity: number;
  invoice_cc_emails: string[];
  signature_data_url: string | null;
  signed_at: string | null;
  tariff_base_rate: number;
  tariff_threshold_kwh: number;
  tariff_discounted_rate: number;
  vehicle_count: number;
  contract_accepted_at: string | null;
  contract_snapshot: string | null;
  status: ApplicationStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
  created_company_id: string | null;
  created_at: string;
}

export const RFID_CARD_PRICE_SGD = 15;
export const KWH_PER_VEHICLE = 500;

const STATUS_COLORS: Record<ApplicationStatus, { bg: string; color: string; label: string }> = {
  draft:    { bg: '#F3F3F3', color: '#767B77', label: 'Draft / Not Submitted' },
  pending:  { bg: '#FFF8E1', color: '#B07D00', label: 'Pending Review' },
  approved: { bg: '#E4F3E3', color: '#1B512D', label: 'Approved' },
  rejected: { bg: '#FDEAEA', color: '#C0321A', label: 'Rejected' },
};

// ── Helpers ───────────────────────────────────────────────────────

function fmtDateTime(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function FieldLabel({ children }: { children: string }) {
  return (
    <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
      {children}
    </label>
  );
}

function inputStyle(): React.CSSProperties {
  return { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
}

function buildInviteUrl(token: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?apply=${token}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ── Invite Modal ──────────────────────────────────────────────────

interface InviteModalProps {
  template: FormTemplate;
  onCreated: () => Promise<void>;
  onClose: () => void;
}

function InviteModal({ template, onCreated, onClose }: InviteModalProps) {
  const [email, setEmail] = useState('');
  const [baseRate, setBaseRate]             = useState<string>('');
  const [discountedRate, setDiscountedRate] = useState<string>('');
  const [created, setCreated] = useState<Application | null>(null);
  const [copying, setCopying] = useState(false);
  const [saving, setSaving] = useState(false);

  const generate = async () => {
    setSaving(true);
    const { data, error } = await supabase.from('crm_account_applications').insert({
      template_id: template.id,
      invited_email: email.trim() || null,
      tariff_base_rate:       Number(baseRate)       || 0,
      tariff_discounted_rate: Number(discountedRate) || 0,
      status: 'draft',
    }).select().single();
    setSaving(false);
    if (error || !data) {
      alert(`Failed to create invite: ${error?.message ?? 'unknown'}`);
      return;
    }
    setCreated(data as Application);
    await onCreated();
  };

  const handleCopy = async (url: string) => {
    setCopying(true);
    await copyText(url);
    setTimeout(() => setCopying(false), 1500);
  };

  const url = created ? buildInviteUrl(created.token) : '';

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 520, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>
            {created ? 'Invite Created' : 'Send Account-Opening Invite'}
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        {!created && (
          <>
            <div style={{ fontSize: 13, color: C.slate, lineHeight: 1.5 }}>
              This creates a unique application link. Share it with the prospective customer; they'll fill out the form using your active template ("{template.name}").
            </div>
            <div>
              <FieldLabel>Customer Email (optional, for your records)</FieldLabel>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@company.com" style={inputStyle()} />
            </div>
            <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tariff Quote (SGD / kWh)</div>
                <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                  Shown to the customer right after the charging-network map. Leave at 0 if you don't want to display a tariff yet. The threshold is set by the customer's declared fleet size ({KWH_PER_VEHICLE} kWh per vehicle).
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <FieldLabel>Pre-threshold</FieldLabel>
                  <input type="number" step="0.001" min="0" value={baseRate}
                    onChange={(e) => setBaseRate(e.target.value)}
                    placeholder="0.65" style={inputStyle()} />
                </div>
                <div>
                  <FieldLabel>Post-threshold</FieldLabel>
                  <input type="number" step="0.001" min="0" value={discountedRate}
                    onChange={(e) => setDiscountedRate(e.target.value)}
                    placeholder="0.55" style={inputStyle()} />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose}
                style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={generate} disabled={saving}
                style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {saving ? 'Generating…' : 'Generate Invite Link'}
              </button>
            </div>
          </>
        )}

        {created && (
          <>
            <div style={{ background: C.honeydew, color: C.green, borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 1.5 }}>
              Share this link with the customer. They can open it without logging in.
            </div>
            <div>
              <FieldLabel>Invite URL</FieldLabel>
              <div style={{ display: 'flex', gap: 8 }}>
                <input readOnly value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ ...inputStyle(), fontFamily: 'monospace', fontSize: 12, background: C.seasalt }} />
                <button onClick={() => handleCopy(url)}
                  style={{ padding: '0 18px', borderRadius: 10, border: 'none', background: copying ? '#1B512D' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {copying ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose}
                style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Application Detail Modal ──────────────────────────────────────

interface ApplicationDetailProps {
  application: Application;
  template: FormTemplate | null;
  onChanged: () => Promise<void>;
  onClose: () => void;
}

function ApplicationDetailModal({ application: app, template, onChanged, onClose }: ApplicationDetailProps) {
  const [busy, setBusy] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [copying, setCopying] = useState(false);

  const sc = STATUS_COLORS[app.status];
  const inviteUrl = buildInviteUrl(app.token);

  const handleCopy = async () => {
    setCopying(true);
    await copyText(inviteUrl);
    setTimeout(() => setCopying(false), 1500);
  };

  const approve = async () => {
    if (!confirm('Approve this application?\n\nThis will create the company, add vehicles to GoParkin Vehicles, and add SP driver emails to SP Vehicles.')) return;
    setBusy(true);

    // 1. Create company
    const { data: company, error: cErr } = await supabase
      .from('crm_companies')
      .insert({
        name: app.company_name ?? 'Unnamed Company',
        base_rate:       app.tariff_base_rate,
        threshold_kwh:   app.tariff_threshold_kwh,
        discounted_rate: app.tariff_discounted_rate,
        contract_text: app.contract_snapshot,
        contact_name: app.contact_name,
        contact_email: app.contact_email,
        contact_phone: app.contact_phone,
        billing_address: app.billing_address,
        invoice_email: app.contact_email,
        invoice_cc_emails: app.invoice_cc_emails ?? [],
      })
      .select()
      .single();

    if (cErr || !company) {
      alert(`Failed to create company: ${cErr?.message ?? 'unknown'}`);
      setBusy(false);
      return;
    }

    // 2. Bulk insert vehicles
    if (app.vehicle_plates.length) {
      const rows = app.vehicle_plates.map((p) => ({ vehicle_plate: p.trim().toUpperCase(), company_id: company.id }));
      const { error: vErr } = await supabase.from('crm_vehicles').insert(rows);
      if (vErr) console.warn('Some vehicles failed to insert:', vErr.message);
    }

    // 3. Bulk insert SP drivers
    if (app.sp_driver_emails.length) {
      const rows = app.sp_driver_emails.map((e) => ({ driver_email: e.trim().toLowerCase(), company_id: company.id }));
      const { error: dErr } = await supabase.from('crm_sp_drivers').insert(rows);
      if (dErr) console.warn('Some drivers failed to insert:', dErr.message);
    }

    // 4. Update application
    await supabase.from('crm_account_applications').update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: 'admin',
      created_company_id: company.id,
    }).eq('id', app.id);

    setBusy(false);
    await onChanged();
    onClose();
  };

  const reject = async () => {
    if (!rejectReason.trim()) {
      alert('Please provide a reason.');
      return;
    }
    setBusy(true);
    await supabase.from('crm_account_applications').update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: 'admin',
      review_notes: rejectReason.trim(),
    }).eq('id', app.id);
    setBusy(false);
    await onChanged();
    onClose();
  };

  const remove = async () => {
    if (!confirm('Delete this application? This cannot be undone.')) return;
    setBusy(true);
    await supabase.from('crm_account_applications').delete().eq('id', app.id);
    setBusy(false);
    await onChanged();
    onClose();
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 760, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>
                {app.company_name ?? 'Unnamed Application'}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: sc.bg, color: sc.color }}>
                {sc.label}
              </span>
            </div>
            <div style={{ fontSize: 12, color: C.slate }}>
              Token <span style={{ fontFamily: 'monospace', color: '#1a1a1a' }}>{app.token.slice(0, 12)}…</span>
              {app.invited_email && ` · Invited ${app.invited_email}`}
            </div>
          </div>
          <button onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        {/* Draft: show invite URL */}
        {app.status === 'draft' && (
          <div style={{ background: C.honeydew, color: C.green, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Customer has not submitted yet. Share the invite link:</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()}
                style={{ ...inputStyle(), fontFamily: 'monospace', fontSize: 12, background: C.white }} />
              <button onClick={handleCopy}
                style={{ padding: '0 18px', borderRadius: 10, border: 'none', background: copying ? '#1B512D' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {copying ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {/* Reviewed: show outcome */}
        {(app.status === 'approved' || app.status === 'rejected') && (
          <div style={{ background: sc.bg, color: sc.color, borderRadius: 12, padding: 14, fontSize: 13 }}>
            <div style={{ fontWeight: 700 }}>{sc.label} on {fmtDateTime(app.reviewed_at)} by {app.reviewed_by ?? '—'}</div>
            {app.review_notes && <div style={{ marginTop: 6 }}>Notes: {app.review_notes}</div>}
            {app.created_company_id && <div style={{ marginTop: 6 }}>Company created in CRM.</div>}
          </div>
        )}

        {/* Submitted contents */}
        {app.status !== 'draft' && (
          <>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8 }}>Company & Contact</div>
              <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <InfoRow label="Company"  value={app.company_name ?? '—'} />
                <InfoRow label="Contact"  value={app.contact_name ?? '—'} />
                <InfoRow label="Email"    value={app.contact_email ?? '—'} />
                <InfoRow label="Phone"    value={app.contact_phone ?? '—'} />
                <InfoRow label="Address"  value={app.billing_address ?? '—'} />
                <InfoRow label="Submitted" value={fmtDateTime(app.submitted_at)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8 }}>GoParkin Vehicles ({app.vehicle_plates.length})</div>
                <div style={{ background: C.seasalt, borderRadius: 12, padding: 12, minHeight: 60, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {app.vehicle_plates.length === 0
                    ? <span style={{ fontSize: 12, color: C.slate, fontStyle: 'italic' }}>None</span>
                    : app.vehicle_plates.map((p, i) => (
                        <span key={i} style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', padding: '4px 10px', borderRadius: 99, background: C.white, color: C.green, border: '1px solid #EBEBEB', letterSpacing: '0.04em' }}>{p}</span>
                      ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8 }}>SP Drivers ({app.sp_driver_emails.length})</div>
                <div style={{ background: C.seasalt, borderRadius: 12, padding: 12, minHeight: 60, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {app.sp_driver_emails.length === 0
                    ? <span style={{ fontSize: 12, color: C.slate, fontStyle: 'italic' }}>None</span>
                    : app.sp_driver_emails.map((e, i) => (
                        <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 99, background: C.white, color: C.green, border: '1px solid #EBEBEB' }}>{e}</span>
                      ))}
                </div>
              </div>
            </div>

            {template && template.custom_fields.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8 }}>Custom Responses</div>
                <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {template.custom_fields.map((f) => (
                    <InfoRow key={f.id} label={f.label} value={app.custom_responses[f.id] ?? '—'} />
                  ))}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8 }}>
                Contract {app.contract_accepted_at ? `· Accepted ${fmtDateTime(app.contract_accepted_at)}` : ''}
              </div>
              <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, fontSize: 12, color: '#1a1a1a', lineHeight: 1.5, maxHeight: 180, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                {app.contract_snapshot ?? '—'}
              </div>
            </div>
          </>
        )}

        {/* Reject form */}
        {rejectMode && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <FieldLabel>Reason for rejection (visible to master only)</FieldLabel>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3}
              style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setRejectMode(false)}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={reject} disabled={busy}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {busy ? 'Rejecting…' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={remove} disabled={busy}
            style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Delete
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={onClose}
              style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Close</button>
            {app.status === 'pending' && !rejectMode && (
              <>
                <button onClick={() => setRejectMode(true)} disabled={busy}
                  style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #C0321A', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  Reject
                </button>
                <button onClick={approve} disabled={busy}
                  style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {busy ? 'Approving…' : '✓ Approve & Create Company'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
      <span style={{ width: 110, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#1a1a1a', flex: 1 }}>{value}</span>
    </div>
  );
}

// ── Form Designer ─────────────────────────────────────────────────

interface InstructionPdfBoxProps {
  title: string;
  path: string | null;
  filename: string | null;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
  onView:   (path: string) => Promise<void>;
}

function InstructionPdfBox({ title, path, filename, onUpload, onRemove, onView }: InstructionPdfBoxProps) {
  const [busy, setBusy] = useState(false);
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    await onUpload(file);
    setBusy(false);
  };
  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
      {path && filename ? (
        <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>📄</span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {filename}
          </div>
          <button type="button" onClick={() => onView(path)}
            style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            View
          </button>
          <button type="button" onClick={() => onRemove()} disabled={busy}
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
            Remove
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.5 }}>
          No PDF uploaded yet. Choose a file below to attach instructions for applicants.
        </div>
      )}
      <input type="file" accept="application/pdf,.pdf"
        onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }}
        disabled={busy}
        style={{ width: '100%', padding: 8, borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', boxSizing: 'border-box', background: C.white }} />
      {busy && <div style={{ fontSize: 11, color: C.slate }}>Uploading…</div>}
    </div>
  );
}

interface FormDesignerProps {
  template: FormTemplate;
  onSaved: () => Promise<void>;
}

function FormDesigner({ template, onSaved }: FormDesignerProps) {
  const [form, setForm] = useState<FormTemplate>(template);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => { setForm(template); }, [template.id]);

  const set = <K extends keyof FormTemplate>(k: K, v: FormTemplate[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const dirty = JSON.stringify(form) !== JSON.stringify(template);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('crm_account_form_templates').update({
      name: form.name,
      intro_text: form.intro_text,
      contract_text: form.contract_text,
      custom_fields: form.custom_fields,
      vehicles_required: form.vehicles_required,
      sp_drivers_required: form.sp_drivers_required,
      goparkin_pdf_path: form.goparkin_pdf_path,
      goparkin_pdf_filename: form.goparkin_pdf_filename,
      sp_pdf_path: form.sp_pdf_path,
      sp_pdf_filename: form.sp_pdf_filename,
      contract_pdf_path: form.contract_pdf_path,
      contract_pdf_filename: form.contract_pdf_filename,
      updated_at: new Date().toISOString(),
    }).eq('id', form.id);
    setSaving(false);
    if (error) {
      alert(`Save failed: ${error.message}`);
      return;
    }
    setSavedAt(new Date());
    await onSaved();
  };

  type PdfPathKey = 'goparkin_pdf_path' | 'sp_pdf_path' | 'contract_pdf_path';
  type PdfNameKey = 'goparkin_pdf_filename' | 'sp_pdf_filename' | 'contract_pdf_filename';

  const uploadInstruction = async (file: File, pathKey: PdfPathKey, nameKey: PdfNameKey) => {
    const oldPath = form[pathKey];
    if (oldPath) await supabase.storage.from(INSTRUCTION_BUCKET).remove([oldPath]);
    const fileId = crypto.randomUUID();
    const ext = file.name.match(/\.[^.]+$/)?.[0] ?? '.pdf';
    const path = `${fileId}${ext}`;
    const { error: upErr } = await supabase.storage.from(INSTRUCTION_BUCKET).upload(path, file, {
      contentType: file.type || 'application/pdf',
    });
    if (upErr) { alert(`Upload failed: ${upErr.message}`); return; }
    setForm((f) => ({ ...f, [pathKey]: path, [nameKey]: file.name }));
  };

  const removeInstruction = async (pathKey: PdfPathKey, nameKey: PdfNameKey) => {
    const oldPath = form[pathKey];
    if (oldPath) await supabase.storage.from(INSTRUCTION_BUCKET).remove([oldPath]);
    setForm((f) => ({ ...f, [pathKey]: null, [nameKey]: null }));
  };

  const viewInstruction = async (path: string) => {
    const { data, error } = await supabase.storage.from(INSTRUCTION_BUCKET).createSignedUrl(path, 60);
    if (error || !data) { alert(`Could not open PDF: ${error?.message ?? 'unknown'}`); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Form Designer</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
            Edits to the template apply to all future invites. Existing submitted applications keep their contract snapshot.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {savedAt && !dirty && (
            <span style={{ fontSize: 11, color: C.slate }}>Saved {savedAt.toLocaleTimeString()}</span>
          )}
          <button onClick={save} disabled={!dirty || saving}
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: dirty && !saving ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: dirty && !saving ? 'pointer' : 'default' }}>
            {saving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </div>

      <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <FieldLabel>Template Name (internal only)</FieldLabel>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} style={inputStyle()} />
        </div>
        <div>
          <FieldLabel>Intro / Welcome Text</FieldLabel>
          <textarea value={form.intro_text ?? ''} onChange={(e) => set('intro_text', e.target.value)} rows={3}
            placeholder="Shown to the customer at the top of the form."
            style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
        </div>
        <div>
          <FieldLabel>Contract Text (fallback if no PDF is uploaded)</FieldLabel>
          <textarea value={form.contract_text ?? ''} onChange={(e) => set('contract_text', e.target.value)} rows={10}
            placeholder="The full contract the customer agrees to."
            style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5, fontFamily: 'monospace', fontSize: 12 }} />
        </div>
        <div>
          <FieldLabel>Contract PDF</FieldLabel>
          <InstructionPdfBox
            title="Service Agreement"
            path={form.contract_pdf_path}
            filename={form.contract_pdf_filename}
            onUpload={(f) => uploadInstruction(f, 'contract_pdf_path', 'contract_pdf_filename')}
            onRemove={() => removeInstruction('contract_pdf_path', 'contract_pdf_filename')}
            onView={(p) => viewInstruction(p)}
          />
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>
            When a PDF is uploaded, the public form shows View / Download buttons and uses the file name in the agreement line. Falls back to the text above otherwise.
          </div>
        </div>
      </div>

      <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>Vehicle & Driver Capture</div>
        <div style={{ fontSize: 12, color: C.slate }}>
          Vehicle plates and SP driver emails are always captured (they're required to auto-populate GoParkin / SP Vehicles on approval). Use these toggles to make them mandatory.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, background: C.seasalt, borderRadius: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.vehicles_required} onChange={(e) => set('vehicles_required', e.target.checked)} style={{ width: 16, height: 16, accentColor: C.green, cursor: 'pointer' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>Vehicle plates required</div>
              <div style={{ fontSize: 11, color: C.slate }}>Customer must add at least one plate</div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, background: C.seasalt, borderRadius: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.sp_drivers_required} onChange={(e) => set('sp_drivers_required', e.target.checked)} style={{ width: 16, height: 16, accentColor: C.green, cursor: 'pointer' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>SP driver emails required</div>
              <div style={{ fontSize: 11, color: C.slate }}>Customer must add at least one email</div>
            </div>
          </label>
        </div>
      </div>

      <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>"Before You Start" Instructions</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
            Upload a PDF for each platform. Applicants see View / Download buttons in the public form so they can follow the steps before submitting.
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <InstructionPdfBox
            title="GoParkin App"
            path={form.goparkin_pdf_path}
            filename={form.goparkin_pdf_filename}
            onUpload={(f) => uploadInstruction(f, 'goparkin_pdf_path', 'goparkin_pdf_filename')}
            onRemove={() => removeInstruction('goparkin_pdf_path', 'goparkin_pdf_filename')}
            onView={(p) => viewInstruction(p)}
          />
          <InstructionPdfBox
            title="SP Mobility App"
            path={form.sp_pdf_path}
            filename={form.sp_pdf_filename}
            onUpload={(f) => uploadInstruction(f, 'sp_pdf_path', 'sp_pdf_filename')}
            onRemove={() => removeInstruction('sp_pdf_path', 'sp_pdf_filename')}
            onView={(p) => viewInstruction(p)}
          />
        </div>
      </div>

    </div>
  );
}

// ── Applications View ─────────────────────────────────────────────

type StatusTab = 'all' | ApplicationStatus;

interface ApplicationsViewProps {
  applications: Application[];
  template: FormTemplate | null;
  onRefresh: () => Promise<void>;
}

function ApplicationsView({ applications, template, onRefresh }: ApplicationsViewProps) {
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');
  const [inviting, setInviting] = useState(false);
  const [detail, setDetail] = useState<Application | null>(null);

  const counts = useMemo(() => ({
    all:      applications.length,
    draft:    applications.filter((a) => a.status === 'draft').length,
    pending:  applications.filter((a) => a.status === 'pending').length,
    approved: applications.filter((a) => a.status === 'approved').length,
    rejected: applications.filter((a) => a.status === 'rejected').length,
  }), [applications]);

  const visible = applications.filter((a) => {
    if (statusTab !== 'all' && a.status !== statusTab) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (a.company_name ?? '').toLowerCase().includes(q) ||
      (a.contact_email ?? '').toLowerCase().includes(q) ||
      (a.invited_email ?? '').toLowerCase().includes(q) ||
      a.token.toLowerCase().includes(q)
    );
  });

  const STATUS_TABS: { id: StatusTab; label: string; count: number }[] = [
    { id: 'all',      label: 'All',      count: counts.all },
    { id: 'pending',  label: 'Pending',  count: counts.pending },
    { id: 'approved', label: 'Approved', count: counts.approved },
    { id: 'rejected', label: 'Rejected', count: counts.rejected },
    { id: 'draft',    label: 'Draft',    count: counts.draft },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Total Applications" value={String(counts.all)} sub="all-time" accent />
        <KPICard label="Pending Review"     value={String(counts.pending)} sub="awaiting approval" />
        <KPICard label="Approved"           value={String(counts.approved)} sub="customers onboarded" />
        <KPICard label="Rejected"           value={String(counts.rejected)} sub="" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {STATUS_TABS.map((t) => {
            const active = statusTab === t.id;
            return (
              <button key={t.id} onClick={() => setStatusTab(t.id)}
                style={{ padding: '6px 14px', borderRadius: 99,
                  border: `1px solid ${active ? C.green : '#EBEBEB'}`,
                  background: active ? C.green : C.white,
                  color: active ? C.white : C.slate,
                  fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {t.label} <span style={{ opacity: 0.7 }}>· {t.count}</span>
              </button>
            );
          })}
        </div>
        <div style={{ position: 'relative', width: 280, marginLeft: 'auto' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, email, token…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}>⌕</span>
        </div>
        <button onClick={() => setInviting(true)} disabled={!template}
          style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: template ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: template ? 'pointer' : 'default' }}>
          + Send New Invite
        </button>
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['Company', 'Contact', 'Status', 'Submitted', 'Token', ''].map((h) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => {
              const sc = STATUS_COLORS[a.status];
              return (
                <tr key={a.id}
                  onClick={() => setDetail(a)}
                  style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <td style={{ padding: '13px 16px', fontSize: 13, fontWeight: 700, color: a.company_name ? C.green : C.slate }}>
                    {a.company_name ?? <span style={{ fontStyle: 'italic' }}>(no submission yet)</span>}
                  </td>
                  <td style={{ padding: '13px 16px', fontSize: 12, color: '#1a1a1a' }}>
                    {a.contact_email ?? a.invited_email ?? '—'}
                  </td>
                  <td style={{ padding: '13px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: sc.bg, color: sc.color, whiteSpace: 'nowrap' }}>{sc.label}</span>
                  </td>
                  <td style={{ padding: '13px 16px', fontSize: 12, color: C.slate, whiteSpace: 'nowrap' }}>
                    {fmtDateTime(a.submitted_at)}
                  </td>
                  <td style={{ padding: '13px 16px', fontSize: 11, color: C.slate, fontFamily: 'monospace' }}>
                    {a.token.slice(0, 10)}…
                  </td>
                  <td style={{ padding: '13px 16px', textAlign: 'right' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>View →</span>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No applications match the current filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {inviting && template && (
        <InviteModal template={template} onCreated={onRefresh} onClose={() => setInviting(false)} />
      )}

      {detail && (
        <ApplicationDetailModal
          key={detail.id}
          application={detail}
          template={template}
          onChanged={onRefresh}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────

type OpeningSubTab = 'applications' | 'designer';

export function AccountOpening() {
  const [tab, setTab] = useState<OpeningSubTab>('applications');
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    const [t, a] = await Promise.all([
      supabase.from('crm_account_form_templates').select('*').eq('is_active', true).order('created_at', { ascending: true }).limit(1).single(),
      supabase.from('crm_account_applications').select('*').order('created_at', { ascending: false }),
    ]);
    if (t.data) {
      const raw = t.data as FormTemplate & { custom_fields: unknown };
      setTemplate({ ...raw, custom_fields: Array.isArray(raw.custom_fields) ? raw.custom_fields as CustomField[] : [] });
    }
    setApplications((a.data as Application[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const TABS: { id: OpeningSubTab; label: string }[] = [
    { id: 'applications', label: 'Applications' },
    { id: 'designer',     label: 'Form Designer' },
  ];

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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

      {tab === 'applications' && (
        <ApplicationsView applications={applications} template={template} onRefresh={fetchAll} />
      )}

      {tab === 'designer' && template && (
        <FormDesigner template={template} onSaved={fetchAll} />
      )}
    </div>
  );
}
