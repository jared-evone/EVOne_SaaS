import { useEffect, useRef, useState } from 'react';
import { C } from '../../theme';
import { Logo } from '../../components/Logo';
import { ChargerLocationMap, type ChargerMapLocation } from '../../components/ChargerLocationMap';
import { supabase } from '../../lib/supabase';
import type { Application, ApplicationStatus, CustomField, FormTemplate } from './AccountOpening';
import { INSTRUCTION_BUCKET, RFID_CARD_PRICE_SGD, KWH_PER_VEHICLE } from './AccountOpening';
import { Download as DownloadIcon } from 'lucide-react';
import { FileText } from 'lucide-react';

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

function TariffCard({ baseRate, discountedRate, vehicleCount, onVehicleCountChange }: {
  baseRate: number;
  discountedRate: number;
  vehicleCount: number;
  onVehicleCountChange: (n: number) => void;
}) {
  const safeCount = Math.max(0, Math.floor(vehicleCount || 0));
  const thresholdKwh = safeCount * KWH_PER_VEHICLE;
  const tiered = thresholdKwh > 0 && discountedRate > 0 && discountedRate !== baseRate;
  return (
    <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>Your Tariff</div>
        <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
          The rates below are quoted in SGD per kWh, before GST. Applies at <strong>EVOne x GoParkin</strong> and <strong>EVOne x SP Mobility</strong> locations on the map above.
        </div>
      </div>
      <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', alignItems: 'center', gap: 12 }}>
          <FieldLabel>Vehicles to register</FieldLabel>
          <input type="number" min={0} step={1} value={safeCount}
            onChange={(e) => onVehicleCountChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            style={{ ...inputStyle(), maxWidth: 160 }} />
        </div>
        <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.5 }}>
          The same vehicle on different platforms counts as <strong>one</strong>. Your tier-1 allowance grows by {KWH_PER_VEHICLE.toLocaleString()} kWh per vehicle —
          {safeCount > 0
            ? <> currently <strong>{safeCount} × {KWH_PER_VEHICLE.toLocaleString()} = {thresholdKwh.toLocaleString()} kWh / billing cycle</strong>.</>
            : <> enter your fleet size above to see your threshold.</>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #EBEBEB', paddingTop: 12 }}>
          <TariffRow
            label={tiered ? `Up to ${thresholdKwh.toLocaleString()} kWh / billing cycle` : 'All charging (single rate until you add vehicles)'}
            rate={baseRate}
          />
          {tiered && (
            <TariffRow
              label={`Above ${thresholdKwh.toLocaleString()} kWh / billing cycle`}
              rate={discountedRate}
              highlight
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TariffRow({ label, rate, highlight }: { label: string; rate: number; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.4 }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: highlight ? C.green : '#1a1a1a', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
        S${Number(rate).toFixed(3)} <span style={{ fontSize: 11, fontWeight: 600, color: C.slate, letterSpacing: 0 }}>/ kWh</span>
      </span>
    </div>
  );
}

function ContractPdfBlock({ path, filename }: { path: string; filename: string }) {
  const open = async (download: boolean) => {
    const { data, error } = await supabase.storage.from(INSTRUCTION_BUCKET)
      .createSignedUrl(path, 60, download ? { download: filename } : undefined);
    if (error || !data) { alert(`Could not open PDF: ${error?.message ?? 'unknown'}`); return; }
    if (download) {
      const a = document.createElement('a');
      a.href = data.signedUrl; a.rel = 'noreferrer';
      document.body.appendChild(a); a.click(); a.remove();
    } else {
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    }
  };
  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, border: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', gap: 10 }}>
      <FileText size={18} strokeWidth={1.75} style={{display:"inline-flex",color:"#5B6B7A"}}/>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {filename}
      </div>
      <button type="button" onClick={() => open(false)}
        style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
        View
      </button>
      <button type="button" onClick={() => open(true)}
        style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
        <DownloadIcon size={12} strokeWidth={2.25} style={{display:"inline",verticalAlign:"-2px",marginRight:4}}/> Download
      </button>
    </div>
  );
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';
    ctx.strokeStyle = '#1a1a1a';
  }, []);

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const emit = () => {
    const canvas = ref.current!;
    onChange(canvas.toDataURL('image/png'));
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawing.current = true;
    lastPoint.current = pointOf(e);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const p = pointOf(e);
    if (lastPoint.current) {
      ctx.beginPath();
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    lastPoint.current = p;
    if (empty) setEmpty(false);
  };
  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    lastPoint.current = null;
    emit();
  };
  const clear = () => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div>
      <canvas ref={ref}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onPointerCancel={onUp}
        style={{ width: '100%', height: 140, background: C.white, border: `1px dashed ${empty ? '#D0D0D0' : C.green}`, borderRadius: 10, touchAction: 'none', cursor: 'crosshair', display: 'block' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 10 }}>
        <span style={{ fontSize: 11, color: empty ? '#C0321A' : C.slate, fontWeight: empty ? 700 : 500 }}>
          {empty ? 'Sign above to enable submission.' : 'Signature captured.'}
        </span>
        <button type="button" onClick={clear}
          style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Clear
        </button>
      </div>
    </div>
  );
}

function InstructionCard({ title, fallbackCopy, path, filename }: { title: string; fallbackCopy: string; path: string | null; filename: string | null }) {
  const viewPdf = async () => {
    if (!path) return;
    const { data, error: e } = await supabase.storage.from(INSTRUCTION_BUCKET).createSignedUrl(path, 60);
    if (e || !data) { alert(`Could not open PDF: ${e?.message ?? 'unknown'}`); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };
  const downloadPdf = async () => {
    if (!path) return;
    const { data, error: e } = await supabase.storage.from(INSTRUCTION_BUCKET)
      .createSignedUrl(path, 60, { download: filename ?? true });
    if (e || !data) { alert(`Could not download PDF: ${e?.message ?? 'unknown'}`); return; }
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
      <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>{fallbackCopy}</div>
      {path && filename && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
          <button type="button" onClick={viewPdf}
            style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            View Instructions
          </button>
          <button type="button" onClick={downloadPdf}
            style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            <DownloadIcon size={12} strokeWidth={2.25} style={{display:"inline",verticalAlign:"-2px",marginRight:4}}/> PDF
          </button>
        </div>
      )}
    </div>
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
  const [mapLocations, setMapLocations] = useState<ChargerMapLocation[]>([]);

  // Form state
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');
  const [ccText, setCcText] = useState('');
  const [plates, setPlates] = useState<string[]>([]);
  const [newPlate, setNewPlate] = useState('');
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [customResponses, setCustomResponses] = useState<Record<string, string>>({});
  const [rfidRequested, setRfidRequested] = useState(false);
  const [rfidQuantity, setRfidQuantity] = useState(1);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
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

      // Load CPO locations + managed-carpark links so we can colour pins by
      // EVE/EVOne brand and SP/GoParkin platform. Best-effort: a failure on
      // either query just hides the map, doesn't block the form.
      const [{ data: locs }, { data: links }] = await Promise.all([
        supabase
          .from('cpo_locations')
          .select('id, name, address, latitude, longitude, csms_platform')
          .not('latitude', 'is', null)
          .not('longitude', 'is', null),
        supabase
          .from('cpo_managed_carparks')
          .select('location_id, category'),
      ]);
      if (locs) {
        const brandByLoc = new Map<string, 'evone' | 'eve' | null>();
        for (const r of (links ?? []) as Array<{ location_id: string | null; category: string }>) {
          if (!r.location_id) continue;
          brandByLoc.set(
            r.location_id,
            r.category === 'eve_cpo' ? 'eve' : r.category === 'evone_cpo' ? 'evone' : null,
          );
        }
        setMapLocations((locs as Array<{ id: string; name: string; address: string | null; latitude: number; longitude: number; csms_platform: 'goparkin' | 'sp' | null }>).map((l) => ({
          ...l,
          brand: brandByLoc.get(l.id) ?? null,
        })));
      }
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
    if (!signatureDataUrl) return false;
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
      rfid_cards_requested: rfidRequested,
      rfid_cards_quantity:  rfidRequested ? Math.max(1, Math.floor(rfidQuantity || 0)) : 0,
      invoice_cc_emails:    ccText.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
      vehicle_count:        Math.max(0, Math.floor(vehicleCount || 0)),
      tariff_threshold_kwh: Math.max(0, Math.floor(vehicleCount || 0)) * KWH_PER_VEHICLE,
      signature_data_url:   signatureDataUrl,
      signed_at:            signatureDataUrl ? now : null,
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
    <div style={{ height: '100vh', background: C.seasalt, overflowY: 'auto', padding: '40px 20px', boxSizing: 'border-box' }}>
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
            {/* Charger network map */}
            {mapLocations.length > 0 && (
              <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>EVOne Charging Network</div>
                  <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                    {mapLocations.length} location{mapLocations.length === 1 ? '' : 's'} across Singapore — tap a marker for the address.
                  </div>
                </div>
                <ChargerLocationMap locations={mapLocations} height={320} />
              </div>
            )}

            {/* Tariff quote */}
            {data && data.application.tariff_base_rate > 0 && (
              <TariffCard
                baseRate={data.application.tariff_base_rate}
                discountedRate={data.application.tariff_discounted_rate}
                vehicleCount={vehicleCount}
                onVehicleCountChange={setVehicleCount}
              />
            )}

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
                <InstructionCard
                  title="GoParkin App"
                  fallbackCopy={'Search "GoParkin" on the App Store or Google Play. Register each vehicle plate inside.'}
                  path={template.goparkin_pdf_path}
                  filename={template.goparkin_pdf_filename}
                />
                <InstructionCard
                  title="SP Mobility App"
                  fallbackCopy={'Search "SP Utilities" / "SP Mobility". Have each driver sign in and add their account.'}
                  path={template.sp_pdf_path}
                  filename={template.sp_pdf_filename}
                />
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
              <div>
                <FieldLabel>Invoice CC Emails</FieldLabel>
                <textarea value={ccText} onChange={(e) => setCcText(e.target.value)} rows={2}
                  style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }}
                  placeholder="finance@acme.com, ops@acme.com" />
                <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>
                  Optional. Invoices will be sent to the Email above; anyone listed here will be CC'd. Separate addresses with commas, semicolons, spaces, or newlines.
                </div>
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

            {/* GoParkin RFID Cards */}
            <div style={{ background: C.white, borderRadius: 16, padding: 24, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>GoParkin RFID Cards</div>
                <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>
                  Optional. Physical RFID cards let drivers tap-to-start at GoParkin chargers. <strong>${RFID_CARD_PRICE_SGD}/card</strong> (pre-GST), invoiced with the first month's charging statement.
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, background: C.seasalt, borderRadius: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={rfidRequested} onChange={(e) => setRfidRequested(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: C.green, cursor: 'pointer' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>I'd like to purchase GoParkin RFID cards</div>
                  <div style={{ fontSize: 11, color: C.slate }}>Tick to specify how many cards your fleet needs.</div>
                </div>
              </label>
              {rfidRequested && (
                <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: 12 }}>
                    <FieldLabel>Quantity</FieldLabel>
                    <input type="number" min={1} step={1} value={rfidQuantity}
                      onChange={(e) => setRfidQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                      style={{ ...inputStyle(), maxWidth: 160 }} />
                  </div>
                  <div style={{ fontSize: 13, color: '#1a1a1a' }}>
                    <span style={{ color: C.slate }}>{rfidQuantity} card{rfidQuantity === 1 ? '' : 's'} × ${RFID_CARD_PRICE_SGD} = </span>
                    <span style={{ fontWeight: 700, color: C.green }}>S${(rfidQuantity * RFID_CARD_PRICE_SGD).toLocaleString()}</span>
                    <span style={{ color: C.slate }}> (pre-GST)</span>
                  </div>
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
              {template.contract_pdf_path && template.contract_pdf_filename ? (
                <ContractPdfBlock path={template.contract_pdf_path} filename={template.contract_pdf_filename} />
              ) : (
                <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, maxHeight: 320, overflowY: 'auto', fontSize: 13, color: '#1a1a1a', lineHeight: 1.6, whiteSpace: 'pre-wrap', border: '1px solid #EBEBEB' }}>
                  {template.contract_text ?? '(no contract text provided)'}
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', padding: 12, background: agreed ? C.honeydew : C.seasalt, borderRadius: 12, border: `1px solid ${agreed ? C.green : '#EBEBEB'}`, transition: 'background .15s, border-color .15s' }}>
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: C.green, cursor: 'pointer', marginTop: 1 }} />
                <span style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5 }}>
                  I have read and agree to the {template.contract_pdf_filename ? <strong>contract above</strong> : 'contract above'} on behalf of <strong>{companyName.trim() || 'my company'}</strong>.
                </span>
              </label>
              {agreed && (
                <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Signature</div>
                  <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>
                    Sign in the box below using your mouse, trackpad, or finger. Your signature is stored with this application.
                  </div>
                  <SignaturePad onChange={setSignatureDataUrl} />
                </div>
              )}
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
