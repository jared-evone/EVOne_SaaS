import { useEffect, useState } from 'react';
import { C } from '../theme';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';

// LTA inspection email designer (Charger Registry). Edits the subject + HTML body
// sent with Form A / Form D inspection + invoice.
// Placeholders: {{charger}} {{form_type}} {{site}} {{customer}} {{date}}.

interface LtaTemplate { form_type: 'A' | 'D'; subject: string; body: string; }

export function ScreenEmailDesigner() {
  const { can } = usePermissions();
  const canEdit = can('email_designer', 'can_edit');

  const [formType, setFormType] = useState<'A' | 'D'>('A');
  const [templates, setTemplates] = useState<Record<'A' | 'D', LtaTemplate>>({
    A: { form_type: 'A', subject: '', body: '' },
    D: { form_type: 'D', subject: '', body: '' },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('lta_email_templates').select('form_type, subject, body');
      setTemplates((prev) => {
        const map = { ...prev };
        for (const row of (data ?? []) as LtaTemplate[]) {
          if (row.form_type === 'A' || row.form_type === 'D') map[row.form_type] = row;
        }
        return map;
      });
      setLoading(false);
    })();
  }, []);

  const current = templates[formType];
  const patch = (p: Partial<LtaTemplate>) => { setTemplates((t) => ({ ...t, [formType]: { ...t[formType], ...p } })); setSaved(false); };

  const save = async () => {
    setSaving(true);
    await supabase.from('lta_email_templates').upsert({
      form_type: formType, subject: current.subject, body: current.body, updated_at: new Date().toISOString(),
    }, { onConflict: 'form_type' });
    setSaving(false);
    setSaved(true);
  };

  const field: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: canEdit ? C.white : '#F9F9F9' };
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };

  if (loading) return <div style={{ color: C.slate, fontSize: 13, padding: 28 }}>Loading templates…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 13, color: C.slate, lineHeight: 1.5 }}>
        Design the email sent with Form A / Form D inspection reports and their invoice from the Charger Registry.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 6, background: C.seasalt, borderRadius: 12, padding: 4, alignSelf: 'flex-start' }}>
            {(['A', 'D'] as const).map((t) => (
              <button key={t} onClick={() => { setFormType(t); setSaved(false); }}
                style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: formType === t ? C.white : 'transparent', color: formType === t ? C.green : C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: formType === t ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}>
                Form {t} {t === 'A' ? '(6-month)' : '(12-month)'}
              </button>
            ))}
          </div>
          <div>
            <label style={label}>Subject</label>
            <input value={current.subject} disabled={!canEdit} onChange={(e) => patch({ subject: e.target.value })} style={field} />
          </div>
          <div>
            <label style={label}>Body (HTML)</label>
            <textarea value={current.body} disabled={!canEdit} onChange={(e) => patch({ body: e.target.value })} rows={12}
              style={{ ...field, resize: 'vertical', lineHeight: 1.5, fontFamily: 'Figtree' }} />
          </div>
          <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.6, background: C.seasalt, borderRadius: 10, padding: '10px 12px' }}>
            Placeholders (auto-filled when sending): <strong>{'{{charger}}'}</strong> · <strong>{'{{form_type}}'}</strong> · <strong>{'{{site}}'}</strong> · <strong>{'{{customer}}'}</strong> · <strong>{'{{date}}'}</strong>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => void save()} disabled={saving}
                style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Saving…' : `Save Form ${formType} template`}
              </button>
              {saved && <span style={{ fontSize: 12, fontWeight: 600, color: C.green }}>Saved.</span>}
            </div>
          )}
        </div>

        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Preview</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{current.subject || <span style={{ color: C.slate }}>No subject</span>}</div>
          <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, padding: 16, fontSize: 13, color: '#1a1a1a', lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: current.body || '<p style="color:#5B6B7A">No body yet.</p>' }} />
        </div>
      </div>
    </div>
  );
}
