import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { Logo } from '../../components/Logo';
import { supabase } from '../../lib/supabase';
import type { FormTemplate, FormValues } from '../../workOrderStore';
import { FieldList, FormHeader, FormPaper } from './TechApp';
import { OverlayFormRenderer, isOverlay } from './OverlayForm';

// Standalone, login-free page reached via ?formPreview=<templateId> — lets the
// builder scan a QR code and try the saved template on a real phone.
// Responses live only in local state; nothing is written anywhere.
export function FormTestPage({ templateId }: { templateId: string }) {
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<FormValues>({});

  useEffect(() => {
    let live = true;
    supabase
      .from('tsd_form_templates')
      .select('template')
      .eq('id', templateId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        setTemplate((data as { template: FormTemplate } | null)?.template ?? null);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [templateId]);

  const setField = (id: string, val: string | boolean) => setValues((v) => ({ ...v, [id]: val }));

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: C.seasalt }}>
      <div style={{ background: C.white, borderBottom: '1px solid #EBEBEB', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Logo height={26} />
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: C.honeydew, color: C.green, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Form Test
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#FFF8E1', color: '#B07D00', borderRadius: 12, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>
            Test mode — responses are not saved.
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading template…</div>
          ) : !template ? (
            <div style={{ background: C.white, borderRadius: 14, border: '1px solid #EBEBEB', padding: 32, textAlign: 'center', color: C.slate, fontSize: 13 }}>
              Template not found. Save it in the Form Builder first, then rescan the QR code.
            </div>
          ) : isOverlay(template) ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>{template.name}</div>
              <OverlayFormRenderer template={template} values={values} onChange={setField} />
            </>
          ) : (
            <FormPaper>
              <FormHeader
                template={template}
                workOrder={{ id: 'WO-TEST', scheduledDate: new Date().toISOString().slice(0, 10), assignedTo: 'Test run' }}
              />
              <FieldList fields={template.fields} values={values} onChange={setField} />
            </FormPaper>
          )}
        </div>
      </div>
    </div>
  );
}
