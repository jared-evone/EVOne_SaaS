import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { Logo } from '../../components/Logo';
import { supabase } from '../../lib/supabase';
import type { Application, ApplicationStatus, CustomField, FormTemplate } from './AccountOpening';

interface Props {
  token: string;
}

interface LoadResult {
  application: Application;
  template: FormTemplate | null;
}

function inputStyle(): React.CSSProperties {
  return { width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
}

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', gap: 6, marginBottom: 6 }}>
      <span>{children}</span>
      {required && <span style={{ color: '#C0321A' }}>*</span>}
    </label>
  );
}

function MessageScreen({ title, message, tone }: { title: string; message: string; tone: 'success' | 'info' | 'warn' }) {
  const colors = {
    success: { bg: '#E4F3E3', accent: '#1B512D' },
    info:    { bg: C.honeydew,  accent: C.green },
    warn:    { bg: '#FFF8E1', accent: '#B07D00' },
  }[tone];
  return (
    <div style={{ background: colors.bg, borderRadius: 16, padding: 32, textAlign: 'center', maxWidth: 540, margin: '0 auto', border: `1px solid ${colors.accent}33` }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: colors.accent, marginBottom: 10, letterSpacing: '-0.02em' }}>{title}</div>
      <div style={{ fontSize: 14, color: '#1a1a1a', lineHeight: 1.6 }}>{message}</div>
    </div>
  );
}

export function PublicApplication({ token }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LoadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');
  const [plates, setPlates] = useState<string[]>([]);
  const [newPlate, setNewPlate] = useState('');
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [customResponses, setCustomResponses] = useState<Record<string, string>>({});
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: app, error: aErr } = await supabase
        .from('crm_account_applications')
        .select('*')
        .eq('token', token)
        .maybeSingle();
      if (aErr || !app) {
        setError('This invite link is invalid or has been removed.');
        setLoading(false);
        return;
      }
      let template: FormTemplate | null = null;
      if (app.template_id) {
        const { data: t } = await supabase.from('crm_account_form_templates').select('*').eq('id', app.template_id).maybeSingle();
        if (t) {
          const raw = t as FormTemplate & { custom_fields: unknown };
          template = { ...raw, custom_fields: Array.isArray(raw.custom_fields) ? raw.custom_fields as CustomField[] : [] };
        }
      }
      setData({ application: app as Application, template });
      setLoading(false);
    })();
  }, [token]);

  const status: ApplicationStatus | null = data?.application.status ?? null;
  const template = data?.template ?? null;

  const addPlate = () => {
    const p = newPlate.trim().toUpperCase();
    if (!p || plates.includes(p)) return;
    setPlates([...plates, p]);
    setNewPlate('');
  };
  const addEmail = () => {
    const e = newEmail.trim().toLowerCase();
    if (!e || emails.includes(e)) return;
    setEmails([...emails, e]);
    setNewEmail('');
  };

  const requiredOk = () => {
    if (!companyName.trim() || !contactName.trim() || !contactEmail.trim()) return false;
    if (template?.vehicles_required && plates.length === 0) return false;
    if (template?.sp_drivers_required && emails.length === 0) return false;
    if (template) {
      for (const f of template.custom_fields) {
        if (f.required && !(customResponses[f.id] ?? '').trim()) return false;
      }
    }
    if (!agreed) return false;
    return true;
  };

  const submit = async () => {
    if (!data) return;
    setSubmitting(true);
    const now = new Date().toISOString();
    const { error: upErr } = await supabase.from('crm_account_applications').update({
      company_name: companyName.trim(),
      contact_name: contactName.trim(),
      contact_email: contactEmail.trim().toLowerCase(),
      contact_phone: contactPhone.trim() || null,
      billing_address: address.trim() || null,
      vehicle_plates: plates,
      sp_driver_emails: emails,
      custom_responses: customResponses,
      contract_accepted_at: now,
      contract_snapshot: template?.contract_text ?? null,
      status: 'pending',
      submitted_at: now,
    }).eq('id', data.application.id);

    setSubmitting(false);
    if (upErr) {
      alert(`Submission failed: ${upErr.message}`);
      return;
    }
    // Refresh local state to show the post-submit screen
    setData({ ...data, application: { ...data.application, status: 'pending' } });
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: C.seasalt, overflowY: 'auto', padding: '40px 20px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <Logo height={44} />
        </div>

        {loading && (
          <MessageScreen title="Loading…" message="Fetching your application." tone="info" />
        )}

        {!loading && error && (
          <MessageScreen title="Invite not found" message={error} tone="warn" />
        )}

        {!loading && !error && status === 'pending' && (
          <MessageScreen title="Thank you — submitted!" message="Your application is under review. We'll be in touch once it's approved." tone="success" />
        )}

        {!loading && !error && status === 'approved' && (
          <MessageScreen title="Application approved" message="Your corporate account is active. Your fleet is now ready to charge with EVOne." tone="success" />
        )}

        {!loading && !error && status === 'rejected' && (
          <MessageScreen title="Application not approved" message={data?.application.review_notes ?? 'Please contact your EVOne representative for next steps.'} tone="warn" />
        )}

        {!loading && !error && status === 'draft' && template && (
          <>
            {/* Intro */}
            {template.intro_text && (
              <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', fontSize: 14, color: '#1a1a1a', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {template.intro_text}
              </div>
            )}

            {/* App install reminder */}
            <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>Before you start</div>
              <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.6 }}>
                Please install both apps below and register your fleet vehicles inside them <strong>before</strong> submitting this form. We'll match the plates / emails you submit here against what's registered in those apps.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: C.seasalt, borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>GoParkin App</div>
                  <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>Search "GoParkin" on the App Store or Google Play. Register each vehicle plate inside.</div>
                </div>
                <div style={{ background: C.seasalt, borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>SP Mobility App</div>
                  <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>Search "SP Utilities" / "SP Mobility". Have each driver sign in and add their account.</div>
                </div>
              </div>
            </div>

            {/* Company / Contact */}
            <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>Company & Contact</div>
              <div>
                <FieldLabel required>Company Name</FieldLabel>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} style={inputStyle()} placeholder="Acme Logistics Pte Ltd" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <FieldLabel required>Contact Person</FieldLabel>
                  <input value={contactName} onChange={(e) => setContactName(e.target.value)} style={inputStyle()} placeholder="Jane Tan" />
                </div>
                <div>
                  <FieldLabel required>Email</FieldLabel>
                  <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} style={inputStyle()} placeholder="jane@acme.com" />
                </div>
                <div>
                  <FieldLabel>Phone</FieldLabel>
                  <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} style={inputStyle()} placeholder="+65 9123 4567" />
                </div>
              </div>
              <div>
                <FieldLabel>Billing Address</FieldLabel>
                <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2}
                  style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} placeholder="Street, city, postal code…" />
              </div>
            </div>

            {/* Vehicles */}
            <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>
                  GoParkin Vehicle Plates {template.vehicles_required && <span style={{ color: '#C0321A' }}>*</span>}
                </div>
                <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>
                  Add every plate that's registered in the GoParkin app.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={newPlate} onChange={(e) => setNewPlate(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPlate(); } }}
                  placeholder="e.g. SGW1234A"
                  style={{ ...inputStyle(), textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, fontFamily: 'monospace' }} />
                <button onClick={addPlate}
                  style={{ padding: '0 22px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  + Add
                </button>
              </div>
              {plates.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {plates.map((p, i) => (
                    <span key={i} style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', padding: '6px 12px', borderRadius: 99, background: C.honeydew, color: C.green, display: 'flex', alignItems: 'center', gap: 8, letterSpacing: '0.04em' }}>
                      {p}
                      <button onClick={() => setPlates(plates.filter((_, idx) => idx !== i))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.green, fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* SP Drivers */}
            <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>
                  SP Driver Emails {template.sp_drivers_required && <span style={{ color: '#C0321A' }}>*</span>}
                </div>
                <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>
                  Add the email of every driver registered in the SP Mobility app.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
                  placeholder="driver@acme.com"
                  style={inputStyle()} />
                <button onClick={addEmail}
                  style={{ padding: '0 22px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  + Add
                </button>
              </div>
              {emails.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {emails.map((e, i) => (
                    <span key={i} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 99, background: C.honeydew, color: C.green, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {e}
                      <button onClick={() => setEmails(emails.filter((_, idx) => idx !== i))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.green, fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Custom fields */}
            {template.custom_fields.length > 0 && (
              <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>Additional Information</div>
                {template.custom_fields.map((f) => (
                  <div key={f.id}>
                    <FieldLabel required={f.required}>{f.label}</FieldLabel>
                    {f.type === 'textarea' ? (
                      <textarea
                        value={customResponses[f.id] ?? ''}
                        onChange={(e) => setCustomResponses({ ...customResponses, [f.id]: e.target.value })}
                        placeholder={f.placeholder} rows={3}
                        style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
                    ) : (
                      <input
                        type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'}
                        value={customResponses[f.id] ?? ''}
                        onChange={(e) => setCustomResponses({ ...customResponses, [f.id]: e.target.value })}
                        placeholder={f.placeholder}
                        style={inputStyle()} />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Contract */}
            <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>Contract</div>
              <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, maxHeight: 320, overflowY: 'auto', fontSize: 13, color: '#1a1a1a', lineHeight: 1.6, whiteSpace: 'pre-wrap', border: '1px solid #EBEBEB' }}>
                {template.contract_text ?? '(no contract text provided)'}
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', padding: 12, background: agreed ? C.honeydew : C.seasalt, borderRadius: 12, border: `1px solid ${agreed ? C.green : '#EBEBEB'}`, transition: 'background .15s, border-color .15s' }}>
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: C.green, cursor: 'pointer', marginTop: 1 }} />
                <span style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5 }}>
                  I have read and agree to the contract above on behalf of <strong>{companyName.trim() || 'my company'}</strong>.
                </span>
              </label>
            </div>

            {/* Submit */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={submit} disabled={!requiredOk() || submitting}
                style={{ padding: '14px 36px', borderRadius: 12, border: 'none',
                  background: requiredOk() && !submitting ? C.green : '#ccc',
                  color: C.white, fontFamily: 'Figtree', fontSize: 15, fontWeight: 700,
                  cursor: requiredOk() && !submitting ? 'pointer' : 'default' }}>
                {submitting ? 'Submitting…' : 'Submit Application'}
              </button>
            </div>
          </>
        )}

        {!loading && !error && status === 'draft' && !template && (
          <MessageScreen title="Form unavailable" message="This invite is missing its template. Please contact your EVOne representative." tone="warn" />
        )}

        <div style={{ textAlign: 'center', fontSize: 11, color: C.slate, marginTop: 8 }}>
          © {new Date().getFullYear()} EVOne. All rights reserved.
        </div>
      </div>
    </div>
  );
}
