import { useEffect, useState } from 'react';
import { C } from '../theme';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import {
  type EmailBrand, DEFAULT_LTA_BRAND, fetchLtaBrand, saveLtaBrand, buildLtaEmailHtml,
  type EmailSender, fetchSenders,
} from '../lib/ltaEmail';

// Charger Registry "Email" screen: an Email Designer (branding + sender identities
// + the Form A/D message templates) and an Email Audit (send history). Modelled on
// the Corporate CRM email design / notifications experience.

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
const field: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' };

export function ScreenEmailDesigner() {
  const [tab, setTab] = useState<'designer' | 'audit'>('designer');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB', alignSelf: 'flex-start' }}>
        {([['designer', 'Email Designer'], ['audit', 'Email Audit']] as const).map(([id, l]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: '8px 22px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: tab === id ? C.green : 'transparent', color: tab === id ? C.white : C.slate }}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'designer' ? <EmailDesignerTab /> : <EmailAuditTab />}
    </div>
  );
}

// ── Designer ──────────────────────────────────────────────────────

interface LtaTemplate { form_type: 'A' | 'D'; subject: string; body: string; cc: string; }

const SAMPLE = { charger: 'SN-80250210121', site: '476 Siglap Road', customer: 'Sample Pte Ltd', date: '09 Jun 2026' };
const fillSample = (s: string, formType: 'A' | 'D') => s
  .replace(/\{\{\s*charger\s*\}\}/gi, SAMPLE.charger)
  .replace(/\{\{\s*form_type\s*\}\}/gi, `Form ${formType}`)
  .replace(/\{\{\s*site\s*\}\}/gi, SAMPLE.site)
  .replace(/\{\{\s*customer\s*\}\}/gi, SAMPLE.customer)
  .replace(/\{\{\s*date\s*\}\}/gi, SAMPLE.date);

function EmailDesignerTab() {
  const { can } = usePermissions();
  const canEdit = can('email_designer', 'can_edit');

  // Branding (shared logo / header / footer / accent).
  const [brand, setBrand] = useState<EmailBrand>(DEFAULT_LTA_BRAND);
  const [brandLoaded, setBrandLoaded] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savedBrand, setSavedBrand] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchLtaBrand().then((b) => { if (live) { setBrand(b); setBrandLoaded(true); } });
    return () => { live = false; };
  }, []);

  // Debounced shared save of the brand.
  useEffect(() => {
    if (!brandLoaded || !canEdit) return;
    const t = window.setTimeout(() => {
      void saveLtaBrand(brand).then(({ error: err }) => {
        if (err) { setError(`Could not save design: ${err.message}`); return; }
        setSavedBrand(true);
        window.setTimeout(() => setSavedBrand(false), 1500);
      });
    }, 600);
    return () => window.clearTimeout(t);
  }, [brand, brandLoaded, canEdit]);

  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingLogo(true);
    setError(null);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const path = `lta_logo_${Date.now()}_${safe}`;
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

  // Per-form-type message templates.
  const [formType, setFormType] = useState<'A' | 'D'>('A');
  const [templates, setTemplates] = useState<Record<'A' | 'D', LtaTemplate>>({
    A: { form_type: 'A', subject: '', body: '', cc: '' },
    D: { form_type: 'D', subject: '', body: '', cc: '' },
  });
  const [tplLoaded, setTplLoaded] = useState(false);
  const [savingTpl, setSavingTpl] = useState(false);
  const [savedTpl, setSavedTpl] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('lta_email_templates').select('form_type, subject, body, cc');
      setTemplates((prev) => {
        const map = { ...prev };
        for (const row of (data ?? []) as LtaTemplate[]) {
          if (row.form_type === 'A' || row.form_type === 'D') map[row.form_type] = { ...row, cc: row.cc ?? '' };
        }
        return map;
      });
      setTplLoaded(true);
    })();
  }, []);

  const current = templates[formType];
  const patchTpl = (p: Partial<LtaTemplate>) => { setTemplates((t) => ({ ...t, [formType]: { ...t[formType], ...p } })); setSavedTpl(false); };
  const saveTpl = async () => {
    setSavingTpl(true);
    await supabase.from('lta_email_templates').upsert({
      form_type: formType, subject: current.subject, body: current.body, cc: current.cc, updated_at: new Date().toISOString(),
    }, { onConflict: 'form_type' });
    setSavingTpl(false);
    setSavedTpl(true);
  };

  // Sender identities (shared table).
  const [senders, setSenders] = useState<EmailSender[]>([]);
  const [newSender, setNewSender] = useState({ from_name: '', from_email: '', reply_to: '' });
  const [senderBusy, setSenderBusy] = useState(false);
  const loadSenders = () => fetchSenders().then(setSenders);
  useEffect(() => { void loadSenders(); }, []);

  const addSender = async () => {
    if (!newSender.from_name.trim() || !newSender.from_email.trim()) return;
    setSenderBusy(true); setError(null);
    const { error: err } = await supabase.from('email_senders').insert({
      from_name: newSender.from_name.trim(), from_email: newSender.from_email.trim(), reply_to: newSender.reply_to.trim() || null,
    });
    if (err) setError(err.message);
    else { setNewSender({ from_name: '', from_email: '', reply_to: '' }); await loadSenders(); }
    setSenderBusy(false);
  };
  const removeSender = async (id: string) => {
    setSenderBusy(true);
    const { error: err } = await supabase.from('email_senders').delete().eq('id', id);
    if (err) setError(err.message); else await loadSenders();
    setSenderBusy(false);
  };

  if (!brandLoaded || !tplLoaded) return <div style={{ color: C.slate, fontSize: 13, padding: 28 }}>Loading…</div>;

  const previewSubject = fillSample(current.subject, formType);
  const previewHtml = buildLtaEmailHtml(fillSample(current.body || 'Your message preview appears here.', formType), brand);
  const disabled = !canEdit;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)', gap: 16, alignItems: 'start' }}>
      {/* Editor */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>}

        {/* Branding */}
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Branding</div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>Logo, header and footer applied to every inspection email. Saved automatically.</div>
            </div>
            {savedBrand && <span style={{ fontSize: 11, fontWeight: 700, color: C.green, background: C.honeydew, padding: '3px 10px', borderRadius: 99 }}>Saved</span>}
          </div>

          <div>
            <label style={label}>Logo</label>
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
            <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>Hosted so it displays in email clients. PNG with a transparent background works best.</div>
          </div>

          <div>
            <label style={label}>Header Title</label>
            <input value={brand.headerTitle} disabled={disabled} onChange={(e) => setBrand((b) => ({ ...b, headerTitle: e.target.value }))} placeholder="EVOne Charger Registry" style={field} />
          </div>

          <div>
            <label style={label}>Accent Colour</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="color" value={brand.accent || '#2A9A47'} disabled={disabled} onChange={(e) => setBrand((b) => ({ ...b, accent: e.target.value }))}
                style={{ width: 44, height: 36, borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, cursor: disabled ? 'default' : 'pointer' }} />
              <input value={brand.accent || '#2A9A47'} disabled={disabled} onChange={(e) => setBrand((b) => ({ ...b, accent: e.target.value }))} style={{ ...field, width: 140 }} />
              <button onClick={() => setBrand((b) => ({ ...b, accent: '#2A9A47' }))} disabled={disabled}
                style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer' }}>Brand green</button>
            </div>
          </div>

          <div>
            <label style={label}>Footer Text</label>
            <textarea value={brand.footerText} disabled={disabled} rows={2} onChange={(e) => setBrand((b) => ({ ...b, footerText: e.target.value }))}
              placeholder="This is a notification from EVOne." style={{ ...field, resize: 'vertical' }} />
          </div>
          {!canEdit && <div style={{ fontSize: 12, color: '#B07D00' }}>You don't have permission to edit the email design.</div>}
        </div>

        {/* Message templates */}
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Message</div>
          <div style={{ display: 'flex', gap: 6, background: C.seasalt, borderRadius: 12, padding: 4, alignSelf: 'flex-start' }}>
            {(['A', 'D'] as const).map((t) => (
              <button key={t} onClick={() => { setFormType(t); setSavedTpl(false); }}
                style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: formType === t ? C.white : 'transparent', color: formType === t ? C.green : C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: formType === t ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}>
                Form {t} {t === 'A' ? '(6-month)' : '(12-month)'}
              </button>
            ))}
          </div>
          <div>
            <label style={label}>Subject</label>
            <input value={current.subject} disabled={disabled} onChange={(e) => patchTpl({ subject: e.target.value })} style={field} />
          </div>
          <div>
            <label style={label}>Message Body</label>
            <textarea value={current.body} disabled={disabled} onChange={(e) => patchTpl({ body: e.target.value })} rows={9}
              placeholder="Plain text — the logo, header and footer above are added automatically." style={{ ...field, resize: 'vertical', lineHeight: 1.5, fontFamily: 'Figtree' }} />
          </div>
          <div>
            <label style={label}>Fixed CC — internal team (comma-separated)</label>
            <input value={current.cc} disabled={disabled} onChange={(e) => patchTpl({ cc: e.target.value })}
              placeholder="ops@evone.com.sg, finance@evone.com.sg" style={field} />
            <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>Always CC'd on every {`Form ${formType}`} send, on top of any recipients added per email.</div>
          </div>
          <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.6, background: C.seasalt, borderRadius: 10, padding: '10px 12px' }}>
            Placeholders (auto-filled when sending): <strong>{'{{charger}}'}</strong> · <strong>{'{{form_type}}'}</strong> · <strong>{'{{site}}'}</strong> · <strong>{'{{customer}}'}</strong> · <strong>{'{{date}}'}</strong>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => void saveTpl()} disabled={savingTpl}
                style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: savingTpl ? 'default' : 'pointer' }}>
                {savingTpl ? 'Saving…' : `Save Form ${formType} message`}
              </button>
              {savedTpl && <span style={{ fontSize: 12, fontWeight: 600, color: C.green }}>Saved.</span>}
            </div>
          )}
        </div>

        {/* Sender identities */}
        {canEdit && (
          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Sender Identities</div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>The From / Reply-To options shown when sending. The From email must be on your Resend-verified domain.</div>
            </div>
            {senders.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {senders.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid #EBEBEB' }}>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{s.from_name}</div>
                      <div style={{ fontSize: 11, color: C.slate, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.from_email}{s.reply_to ? ` · reply ${s.reply_to}` : ''}</div>
                    </div>
                    <button onClick={() => void removeSender(s.id)} disabled={senderBusy}
                      style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: senderBusy ? 'default' : 'pointer' }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <div>
                <label style={label}>From Name</label>
                <input value={newSender.from_name} onChange={(e) => setNewSender((v) => ({ ...v, from_name: e.target.value }))} placeholder="EVOne Charger Registry" style={field} />
              </div>
              <div>
                <label style={label}>From Email</label>
                <input type="email" value={newSender.from_email} onChange={(e) => setNewSender((v) => ({ ...v, from_email: e.target.value }))} placeholder="registry@yourdomain.com" style={field} />
              </div>
            </div>
            <div>
              <label style={label}>Reply-To</label>
              <input type="email" value={newSender.reply_to} onChange={(e) => setNewSender((v) => ({ ...v, reply_to: e.target.value }))} placeholder="replies@yourdomain.com" style={field} />
            </div>
            <button onClick={() => void addSender()} disabled={senderBusy || !newSender.from_name.trim() || !newSender.from_email.trim()}
              style={{ alignSelf: 'flex-start', padding: '9px 20px', borderRadius: 10, border: 'none', background: (senderBusy || !newSender.from_name.trim() || !newSender.from_email.trim()) ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + Add sender identity
            </button>
          </div>
        )}
      </div>

      {/* Live preview */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10, position: 'sticky', top: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Preview · Form {formType}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{previewSubject || <span style={{ color: C.slate }}>No subject</span>}</div>
        <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, padding: 16, background: '#FFFFFF', maxHeight: '70vh', overflowY: 'auto' }}
          dangerouslySetInnerHTML={{ __html: previewHtml }} />
      </div>
    </div>
  );
}

// ── Audit ─────────────────────────────────────────────────────────

interface LtaEmailLogRow {
  id: string;
  charger_tag: string | null;
  form_type: string | null;
  site_name: string | null;
  customer_name: string | null;
  to_email: string | null;
  status: 'sent' | 'failed';
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

const LOG_STATUS_COLORS: Record<'sent' | 'failed', { bg: string; color: string }> = {
  sent:   { bg: '#E4F3E3', color: '#1B512D' },
  failed: { bg: '#FDEAEA', color: '#C0321A' },
};

function EmailAuditTab() {
  const [rows, setRows] = useState<LtaEmailLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('lta_email_log').select('*').order('created_at', { ascending: false }).limit(300);
      setRows((data ?? []) as LtaEmailLogRow[]);
      setLoading(false);
    })();
  }, []);

  const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: '#1a1a1a', borderBottom: '1px solid #F3F3F3', verticalAlign: 'top' };

  const sentCount = rows.filter((r) => r.status === 'sent').length;
  const failedCount = rows.length - sentCount;

  if (loading) return <div style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading send history…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>
        {rows.length} send{rows.length === 1 ? '' : 's'} · {sentCount} delivered · {failedCount} failed
      </div>
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.seasalt }}>
                {['When', 'Charger', 'Form', 'Customer / Site', 'To', 'Status'].map((h) => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No emails sent yet.</td></tr>
              ) : rows.map((r) => {
                const tone = LOG_STATUS_COLORS[r.status];
                return (
                  <tr key={r.id}>
                    <td style={{ ...td, color: C.slate, whiteSpace: 'nowrap' }}>{fmtDateTime(r.sent_at ?? r.created_at)}</td>
                    <td style={{ ...td, fontWeight: 700, color: C.green }}>{r.charger_tag ?? '—'}</td>
                    <td style={td}>{r.form_type ? `Form ${r.form_type}` : '—'}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{r.customer_name ?? '—'}</div>
                      <div style={{ fontSize: 11, color: C.slate }}>{r.site_name ?? ''}</div>
                    </td>
                    <td style={{ ...td, color: C.slate }}>{r.to_email ?? '—'}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: tone.bg, color: tone.color, textTransform: 'capitalize' }}>{r.status}</span>
                      {r.status === 'failed' && r.error && (
                        <div style={{ fontSize: 11, color: '#C0321A', marginTop: 4, maxWidth: 280 }}>{r.error}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
