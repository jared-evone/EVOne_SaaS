import { useEffect, useMemo, useRef, useState } from 'react';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { BrandLogo, type Brand } from '../components/BrandLogo';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { OneMapAutocomplete } from '../components/OneMapAutocomplete';

// ── Types ─────────────────────────────────────────────────────────

type CsmsPlatform = 'goparkin' | 'sp';

const CSMS_PLATFORM_LABELS: Record<CsmsPlatform, string> = {
  goparkin: 'GoParkin',
  sp:       'SP',
};

interface Location {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  csms_platform: CsmsPlatform | null;
  notes: string | null;
}

interface Charger {
  id: string;
  charger_code: string;
  location_id: string | null;
  bay_label: string | null;
  latitude: number | null;
  longitude: number | null;
  charger_type: string | null;
  power_kw: number | null;
  num_connectors: number | null;
  brand_model: string | null;
  type_approval_id: string | null;
  registration_code: string | null;
  next_maintenance_date: string | null;
  form_a_next_date: string | null;
  form_d_next_date: string | null;
  notes: string | null;
}

interface MeterReading {
  id: string;
  charger_id: string;
  reading_kwh: number;
  reading_date: string;
  recorded_by: string | null;
  notes: string | null;
  created_at: string;
}

type MaintenanceType = 'preventive_form_a' | 'preventive_form_d' | 'preventive' | 'corrective';

interface MaintenanceRecord {
  id: string;
  charger_id: string;
  maintenance_type: MaintenanceType;
  performed_date: string;
  technician: string | null;
  summary: string | null;
  pdf_path: string | null;
  pdf_filename: string | null;
  next_due_date: string | null;
  created_at: string;
}

const MAINTENANCE_TYPE_LABEL: Record<MaintenanceType, string> = {
  preventive_form_a: 'Form A (6-mo PM)',
  preventive_form_d: 'Form D (12-mo PM)',
  preventive:        'Preventive (legacy)',
  corrective:        'Corrective',
};

function addMonthsISO(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function effectivePmDate(c: Pick<Charger, 'form_a_next_date' | 'form_d_next_date' | 'next_maintenance_date'>): string | null {
  const candidates = [c.form_a_next_date, c.form_d_next_date, c.next_maintenance_date].filter((d): d is string => !!d);
  if (candidates.length === 0) return null;
  return candidates.reduce((min, d) => (d < min ? d : min));
}

const STORAGE_BUCKET = 'cpo-maintenance-pdfs';

// ── Helpers ───────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysFromToday(s: string | null): number | null {
  if (!s) return null;
  const today = new Date(todayISO()).getTime();
  const target = new Date(s).getTime();
  return Math.round((target - today) / 86_400_000);
}

function pmUrgency(date: string | null): { label: string; bg: string; color: string } {
  const d = daysFromToday(date);
  if (d === null) return { label: 'No PM scheduled', bg: '#F3F3F3', color: '#767B77' };
  if (d < 0)      return { label: `Overdue ${Math.abs(d)}d`, bg: '#FDEAEA', color: '#C0321A' };
  if (d <= 30)    return { label: `Due in ${d}d`, bg: '#FFF0E0', color: '#B45309' };
  return { label: `OK · ${d}d left`, bg: '#E4F3E3', color: '#1B512D' };
}

function earliestPmDate(chargers: Charger[]): string | null {
  const dates = chargers.map(effectivePmDate).filter((d): d is string => !!d);
  if (!dates.length) return null;
  return dates.reduce((min, d) => (d < min ? d : min));
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

// ── Location Modal (add/edit) ─────────────────────────────────────

interface ManagedCarparkOption {
  carpark_name: string;
  location_id: string | null;
  category: 'evone_cpo' | 'eve_cpo' | 'managed_cpo';
}

interface LocationFormData {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  csms_platform: CsmsPlatform | null;
  notes: string | null;
  linked_carpark_name: string | null;
}

type LocationForm = LocationFormData;

const blankLocation: LocationForm = {
  name: '',
  address: '',
  latitude: null,
  longitude: null,
  csms_platform: 'goparkin',
  notes: '',
  linked_carpark_name: null,
};

interface LocationModalProps {
  initial: LocationForm;
  title: string;
  onSave: (data: LocationForm) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
  chargerCount?: number;
  managedCarparks: ManagedCarparkOption[];
  currentLocationId?: string | null;
}

function LocationModal({ initial, title, onSave, onDelete, onClose, chargerCount = 0, managedCarparks, currentLocationId }: LocationModalProps) {
  const [form, setForm] = useState<LocationForm>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const set = <K extends keyof LocationForm>(k: K, v: LocationForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

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

  const canSave = form.name.trim().length > 0 && !saving;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div title={title} style={{
            fontSize: 16, fontWeight: 700, color: C.green, minWidth: 0, flex: 1,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', wordBreak: 'break-word', lineHeight: 1.3,
          }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree', flexShrink: 0 }}>×</button>
        </div>

        <div>
          <FieldLabel>Location Name</FieldLabel>
          <input value={form.name} onChange={(e) => set('name', e.target.value)}
            placeholder="Marina Bay Sands" style={inputStyle()} />
        </div>
        <div>
          <FieldLabel>Address</FieldLabel>
          <OneMapAutocomplete
            value={form.address ?? ''}
            onChange={(t) => set('address', t)}
            onPick={(r) => setForm((f) => ({
              ...f, address: r.address, latitude: r.latitude, longitude: r.longitude,
            }))}
            placeholder="Start typing — pick a Singapore address to auto-fill lat/lng"
          />
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.4 }}>
            Powered by <a href="https://www.onemap.gov.sg" target="_blank" rel="noreferrer" style={{ color: C.green, textDecoration: 'none', fontWeight: 600 }}>OneMap</a> (data.gov.sg). Selecting a suggestion auto-fills latitude &amp; longitude.
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Latitude</FieldLabel>
            <input type="number" step="0.000001" value={form.latitude ?? ''}
              onChange={(e) => set('latitude', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="1.2834" style={inputStyle()} />
          </div>
          <div>
            <FieldLabel>Longitude</FieldLabel>
            <input type="number" step="0.000001" value={form.longitude ?? ''}
              onChange={(e) => set('longitude', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="103.8607" style={inputStyle()} />
          </div>
        </div>
        <div>
          <FieldLabel>CSMS Platform</FieldLabel>
          <div style={{ display: 'flex', gap: 6 }}>
            {(Object.keys(CSMS_PLATFORM_LABELS) as CsmsPlatform[]).map((p) => {
              const active = form.csms_platform === p;
              return (
                <button key={p} type="button" onClick={() => set('csms_platform', p)}
                  style={{ flex: 1, padding: '9px 4px', borderRadius: 10,
                    border: `2px solid ${active ? C.green : '#EBEBEB'}`,
                    background: active ? C.honeydew : C.white,
                    color: active ? C.green : C.slate,
                    fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {CSMS_PLATFORM_LABELS[p]}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <FieldLabel>Linked CPO Carpark</FieldLabel>
          {(() => {
            // Available = unlinked carparks + the one already linked to this location (so the edit form can keep / change it).
            const available = managedCarparks.filter(
              (m) => m.location_id === null || (currentLocationId !== undefined && m.location_id === currentLocationId),
            );
            const byCategory = {
              evone_cpo:   available.filter((m) => m.category === 'evone_cpo').sort((a, b) => a.carpark_name.localeCompare(b.carpark_name)),
              eve_cpo:     available.filter((m) => m.category === 'eve_cpo').sort((a, b) => a.carpark_name.localeCompare(b.carpark_name)),
              managed_cpo: available.filter((m) => m.category === 'managed_cpo').sort((a, b) => a.carpark_name.localeCompare(b.carpark_name)),
            };
            return (
              <select value={form.linked_carpark_name ?? ''}
                onChange={(e) => set('linked_carpark_name', e.target.value || null)}
                style={{ ...inputStyle(), background: C.white, cursor: 'pointer' }}>
                <option value="">— Not linked —</option>
                {byCategory.evone_cpo.length > 0 && (
                  <optgroup label="EVOne CPO">
                    {byCategory.evone_cpo.map((m) => (
                      <option key={m.carpark_name} value={m.carpark_name}>{m.carpark_name}</option>
                    ))}
                  </optgroup>
                )}
                {byCategory.eve_cpo.length > 0 && (
                  <optgroup label="EVE CPO">
                    {byCategory.eve_cpo.map((m) => (
                      <option key={m.carpark_name} value={m.carpark_name}>{m.carpark_name}</option>
                    ))}
                  </optgroup>
                )}
                {byCategory.managed_cpo.length > 0 && (
                  <optgroup label="Managed CPOs">
                    {byCategory.managed_cpo.map((m) => (
                      <option key={m.carpark_name} value={m.carpark_name}>{m.carpark_name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            );
          })()}
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6, lineHeight: 1.4 }}>
            Grouped by carpark category. Carparks already tagged to another location are hidden. Tag new carparks in <strong>Charging Records → CPO Carparks</strong>.
          </div>
        </div>
        <div>
          <FieldLabel>Notes</FieldLabel>
          <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={3}
            placeholder="Site contact, access instructions, opening hours…"
            style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this location?</div>
            <div style={{ fontSize: 12, color: '#C0321A' }}>
              {chargerCount > 0
                ? `${chargerCount} charger${chargerCount > 1 ? 's' : ''} will become unassigned (chargers themselves are not deleted).`
                : 'No chargers are assigned to this location.'}
            </div>
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
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={!canSave}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Charger Modal (add/edit) ──────────────────────────────────────

type ChargerForm = Omit<Charger, 'id'>;

function makeBlankCharger(locationId: string | null): ChargerForm {
  return {
    charger_code: '',
    location_id: locationId,
    bay_label: '',
    latitude: null,
    longitude: null,
    charger_type: 'AC',
    power_kw: null,
    num_connectors: 1,
    brand_model: '',
    type_approval_id: '',
    registration_code: '',
    next_maintenance_date: null,
    form_a_next_date: null,
    form_d_next_date: null,
    notes: '',
  };
}

interface ChargerModalProps {
  initial: ChargerForm;
  title: string;
  locations: Location[];
  lockLocation?: boolean;
  onSave: (data: ChargerForm) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function ChargerModal({ initial, title, locations, lockLocation, onSave, onDelete, onClose }: ChargerModalProps) {
  const [form, setForm] = useState<ChargerForm>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const set = <K extends keyof ChargerForm>(k: K, v: ChargerForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

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

  const canSave = form.charger_code.trim().length > 0 && form.location_id !== null && !saving;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 620, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        {/* Location */}
        <div>
          <FieldLabel>Location</FieldLabel>
          <select value={form.location_id ?? ''} onChange={(e) => set('location_id', e.target.value || null)}
            disabled={lockLocation}
            style={{ ...inputStyle(), background: lockLocation ? C.seasalt : C.white, cursor: lockLocation ? 'default' : 'pointer' }}>
            <option value="">— Select a location —</option>
            {locations.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
          </select>
        </div>

        {/* Identity */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Charger ID</FieldLabel>
            <input value={form.charger_code} onChange={(e) => set('charger_code', e.target.value.toUpperCase())}
              placeholder="EV-SG-001" style={{ ...inputStyle(), fontWeight: 700, letterSpacing: '0.04em' }} />
          </div>
          <div>
            <FieldLabel>Bay / Position Label</FieldLabel>
            <input value={form.bay_label ?? ''} onChange={(e) => set('bay_label', e.target.value)}
              placeholder="e.g. B2-14 or Lot 27" style={inputStyle()} />
          </div>
        </div>

        {/* Brand & approval */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Charger Brand &amp; Model</FieldLabel>
            <input value={form.brand_model ?? ''} onChange={(e) => set('brand_model', e.target.value)}
              placeholder="e.g. ABB Terra 54 CJG" style={inputStyle()} />
          </div>
          <div>
            <FieldLabel>Type-Approval ID</FieldLabel>
            <input value={form.type_approval_id ?? ''} onChange={(e) => set('type_approval_id', e.target.value)}
              placeholder="e.g. TA-2024-0123" style={inputStyle()} />
          </div>
        </div>

        <div>
          <FieldLabel>Registration Code</FieldLabel>
          <input value={form.registration_code ?? ''} onChange={(e) => set('registration_code', e.target.value)}
            placeholder="e.g. REG-2024-001" style={inputStyle()} />
        </div>

        {/* Hardware */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Charger Type</FieldLabel>
            <select value={form.charger_type ?? 'AC'} onChange={(e) => set('charger_type', e.target.value)}
              style={{ ...inputStyle(), background: C.white }}>
              <option value="AC">AC</option>
              <option value="DC">DC</option>
              <option value="Hybrid">Hybrid</option>
            </select>
          </div>
          <div>
            <FieldLabel>Power (kW)</FieldLabel>
            <input type="number" step="0.1" value={form.power_kw ?? ''}
              onChange={(e) => set('power_kw', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="22" style={inputStyle()} />
          </div>
          <div>
            <FieldLabel>Connectors</FieldLabel>
            <input type="number" min="1" value={form.num_connectors ?? 1}
              onChange={(e) => set('num_connectors', Number(e.target.value))}
              style={inputStyle()} />
          </div>
        </div>

        {/* Preventive Maintenance schedule */}
        <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>Preventive Maintenance Schedule</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <FieldLabel>Form A · Next Date (6-mo)</FieldLabel>
              <input type="date" value={form.form_a_next_date ?? ''}
                onChange={(e) => set('form_a_next_date', e.target.value || null)} style={inputStyle()} />
            </div>
            <div>
              <FieldLabel>Form D · Next Date (12-mo)</FieldLabel>
              <input type="date" value={form.form_d_next_date ?? ''}
                onChange={(e) => set('form_d_next_date', e.target.value || null)} style={inputStyle()} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.5 }}>
            "Next PM" indicators across the app use whichever of these two dates comes first. Logging a Form A or Form D in the Maintenance tab rolls the matching date forward automatically.
          </div>
        </div>

        <div>
          <FieldLabel>Notes</FieldLabel>
          <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={3}
            placeholder="Per-bay notes, quirks, access details…"
            style={{ ...inputStyle(), resize: 'vertical', lineHeight: 1.5 }} />
        </div>

        {confirmDelete && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete this charger?</div>
            <div style={{ fontSize: 12, color: '#C0321A' }}>Meter readings and maintenance records will also be removed (cascade).</div>
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
              style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={!canSave}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Meter Reading Form (inline in detail modal) ───────────────────

interface MeterReadingFormProps {
  chargerId: string;
  onAdded: () => Promise<void>;
}

function MeterReadingForm({ chargerId, onAdded }: MeterReadingFormProps) {
  const [reading, setReading] = useState('');
  const [date, setDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  const canSave = reading.trim() !== '' && !saving;

  const submit = async () => {
    setSaving(true);
    await supabase.from('cpo_meter_readings').insert({
      charger_id: chargerId,
      reading_kwh: Number(reading),
      reading_date: date,
    });
    setReading('');
    await onAdded();
    setSaving(false);
  };

  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>Log New Reading</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <FieldLabel>Reading (kWh)</FieldLabel>
          <input type="number" step="0.01" value={reading} onChange={(e) => setReading(e.target.value)}
            placeholder="12345.67" style={inputStyle()} />
        </div>
        <div>
          <FieldLabel>Reading Date</FieldLabel>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle()} />
        </div>
      </div>
      <button onClick={submit} disabled={!canSave}
        style={{ alignSelf: 'flex-end', padding: '8px 18px', borderRadius: 10, border: 'none',
          background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
        {saving ? 'Saving…' : '+ Add Reading'}
      </button>
    </div>
  );
}

// ── Maintenance Record Form (inline in detail modal) ──────────────

interface MaintenanceFormProps {
  chargerId: string;
  onAdded: () => Promise<void>;
}

function MaintenanceForm({ chargerId, onAdded }: MaintenanceFormProps) {
  const [type, setType] = useState<MaintenanceType>('preventive_form_a');
  const [date, setDate] = useState(todayISO());
  const [nextDue, setNextDue] = useState(addMonthsISO(todayISO(), 6));
  const [nextDueTouched, setNextDueTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSave = date !== '' && !saving;

  const cycleMonths = (t: MaintenanceType): number | null => {
    if (t === 'preventive_form_a') return 6;
    if (t === 'preventive_form_d') return 12;
    return null;
  };

  const updateType = (t: MaintenanceType) => {
    setType(t);
    if (!nextDueTouched) {
      const m = cycleMonths(t);
      setNextDue(m ? addMonthsISO(date, m) : '');
    }
  };

  const updateDate = (d: string) => {
    setDate(d);
    if (!nextDueTouched && d) {
      const m = cycleMonths(type);
      if (m) setNextDue(addMonthsISO(d, m));
    }
  };

  const submit = async () => {
    setSaving(true);
    let pdf_path: string | null = null;
    let pdf_filename: string | null = null;

    if (file) {
      const fileId = crypto.randomUUID();
      pdf_path = `chargers/${chargerId}/${fileId}.pdf`;
      pdf_filename = file.name;
      const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(pdf_path, file, {
        contentType: 'application/pdf',
      });
      if (upErr) {
        alert(`PDF upload failed: ${upErr.message}`);
        setSaving(false);
        return;
      }
    }

    await supabase.from('cpo_maintenance_records').insert({
      charger_id: chargerId,
      maintenance_type: type,
      performed_date: date,
      next_due_date: nextDue || null,
      pdf_path,
      pdf_filename,
    });

    if (nextDue) {
      const patch: Partial<Charger> = {};
      if (type === 'preventive_form_a') patch.form_a_next_date = nextDue;
      else if (type === 'preventive_form_d') patch.form_d_next_date = nextDue;
      else patch.next_maintenance_date = nextDue;
      await supabase.from('cpo_chargers').update(patch).eq('id', chargerId);
    }

    setType('preventive_form_a');
    setNextDue(addMonthsISO(todayISO(), 6));
    setNextDueTouched(false);
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
    await onAdded();
    setSaving(false);
  };

  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>Log Maintenance</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <FieldLabel>Type</FieldLabel>
          <select value={type} onChange={(e) => updateType(e.target.value as MaintenanceType)}
            style={{ ...inputStyle(), background: C.white }}>
            <option value="preventive_form_a">{MAINTENANCE_TYPE_LABEL.preventive_form_a}</option>
            <option value="preventive_form_d">{MAINTENANCE_TYPE_LABEL.preventive_form_d}</option>
            <option value="corrective">{MAINTENANCE_TYPE_LABEL.corrective}</option>
          </select>
        </div>
        <div>
          <FieldLabel>Performed On</FieldLabel>
          <input type="date" value={date} onChange={(e) => updateDate(e.target.value)} style={inputStyle()} />
        </div>
        <div>
          <FieldLabel>
            {type === 'preventive_form_a' ? 'Next Form A Due' :
             type === 'preventive_form_d' ? 'Next Form D Due' :
             'Next PM Due'}
          </FieldLabel>
          <input type="date" value={nextDue}
            onChange={(e) => { setNextDue(e.target.value); setNextDueTouched(true); }}
            style={inputStyle()} />
        </div>
      </div>
      <div>
        <FieldLabel>Report PDF</FieldLabel>
        <input ref={fileRef} type="file" accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ ...inputStyle(), padding: 8 }} />
        {file && (
          <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>
            Selected: <span style={{ color: '#1a1a1a', fontWeight: 600 }}>{file.name}</span> ({(file.size / 1024).toFixed(0)} KB)
          </div>
        )}
      </div>
      <button onClick={submit} disabled={!canSave}
        style={{ alignSelf: 'flex-end', padding: '8px 18px', borderRadius: 10, border: 'none',
          background: canSave ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
        {saving ? 'Saving…' : '+ Add Record'}
      </button>
    </div>
  );
}

// ── Charger Detail Modal (tabs) ───────────────────────────────────

type DetailTab = 'overview' | 'meter' | 'maintenance';

interface DetailModalProps {
  charger: Charger;
  location: Location | null;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

function DetailModal({ charger, location, canEdit, canDelete, onEdit, onClose, onChanged }: DetailModalProps) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    const [r1, r2] = await Promise.all([
      supabase.from('cpo_meter_readings').select('*').eq('charger_id', charger.id).order('reading_date', { ascending: false }),
      supabase.from('cpo_maintenance_records').select('*').eq('charger_id', charger.id).order('performed_date', { ascending: false }),
    ]);
    setReadings((r1.data as MeterReading[]) ?? []);
    setMaintenance((r2.data as MaintenanceRecord[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [charger.id]);

  const pmFormA = pmUrgency(charger.form_a_next_date);
  const pmFormD = pmUrgency(charger.form_d_next_date);
  const latestKwh = readings[0]?.reading_kwh ?? null;

  const deleteReading = async (id: string) => {
    await supabase.from('cpo_meter_readings').delete().eq('id', id);
    await fetchAll();
  };

  const deleteMaintenance = async (rec: MaintenanceRecord) => {
    if (rec.pdf_path) await supabase.storage.from(STORAGE_BUCKET).remove([rec.pdf_path]);
    await supabase.from('cpo_maintenance_records').delete().eq('id', rec.id);
    await fetchAll();
  };

  const openPdf = async (path: string) => {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, 60);
    if (error || !data) { alert(`Could not open PDF: ${error?.message ?? 'unknown'}`); return; }
    window.open(data.signedUrl, '_blank');
  };

  const refreshAndParent = async () => {
    await fetchAll();
    await onChanged();
  };

  const TABS: { id: DetailTab; label: string; count?: number }[] = [
    { id: 'overview',    label: 'Overview' },
    { id: 'meter',       label: 'Meter Readings', count: readings.length },
    { id: 'maintenance', label: 'Maintenance',    count: maintenance.length },
  ];

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 760, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: C.green, letterSpacing: '-0.02em' }}>{charger.charger_code}</span>
            </div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
              {location?.name ?? 'Unassigned'}
              {charger.bay_label && ` · ${charger.bay_label}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {canEdit && (
              <button onClick={onEdit}
                style={{ padding: '8px 16px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Edit
              </button>
            )}
            <button onClick={onClose}
              style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, background: C.seasalt, borderRadius: 12, padding: 4, alignSelf: 'flex-start' }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: '7px 16px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: tab === t.id ? C.green : 'transparent',
                color: tab === t.id ? C.white : C.slate }}>
              {t.label}{t.count !== undefined && ` · ${t.count}`}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <DetailStat label="Charger ID"  value={charger.charger_code} />
              <DetailStat label="Power"       value={charger.power_kw ? `${charger.power_kw} kW` : '—'} />
              <DetailStat label="Next Form A" value={pmFormA.label} valueColor={pmFormA.color} />
              <DetailStat label="Next Form D" value={pmFormD.label} valueColor={pmFormD.color} />
            </div>

            <InfoRow label="Type"              value={`${charger.charger_type ?? '—'}${charger.num_connectors ? ` · ${charger.num_connectors} connector${charger.num_connectors > 1 ? 's' : ''}` : ''}`} />
            <InfoRow label="Brand & Model"     value={charger.brand_model ?? '—'} />
            <InfoRow label="Type-Approval ID"  value={charger.type_approval_id ?? '—'} />
            <InfoRow label="Registration Code" value={charger.registration_code ?? '—'} />
            <InfoRow label="Bay"               value={charger.bay_label ?? '—'} />
            <InfoRow label="Coordinates"       value={charger.latitude != null && charger.longitude != null ? `${charger.latitude}, ${charger.longitude}` : '—'} />
            <InfoRow label="Latest Reading"    value={latestKwh !== null ? `${Number(latestKwh).toLocaleString()} kWh` : '—'} />
            <InfoRow label="Form A · Next"     value={fmtDate(charger.form_a_next_date)} />
            <InfoRow label="Form D · Next"     value={fmtDate(charger.form_d_next_date)} />

            {charger.notes && (
              <div style={{ background: C.seasalt, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Notes</div>
                <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5 }}>{charger.notes}</div>
              </div>
            )}
          </div>
        )}

        {tab === 'meter' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {canEdit && <MeterReadingForm chargerId={charger.id} onAdded={refreshAndParent} />}
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</div>
            ) : readings.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.slate, fontSize: 13, background: C.white, border: '1px dashed #EBEBEB', borderRadius: 12 }}>
                No meter readings yet.
              </div>
            ) : (
              <div style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: C.seasalt }}>
                      {['Date', 'Reading (kWh)', ''].map((h) => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {readings.map((r) => (
                      <tr key={r.id} style={{ borderBottom: '1px solid #F3F3F3' }}>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{fmtDate(r.reading_date)}</td>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>{Number(r.reading_kwh).toLocaleString()}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                          {canDelete && (
                            <button onClick={() => deleteReading(r.id)}
                              style={{ background: 'transparent', border: 'none', color: '#C0321A', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'maintenance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {canEdit && <MaintenanceForm chargerId={charger.id} onAdded={refreshAndParent} />}
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</div>
            ) : maintenance.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.slate, fontSize: 13, background: C.white, border: '1px dashed #EBEBEB', borderRadius: 12 }}>
                No maintenance records yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {maintenance.map((m) => (
                  <div key={m.id} style={{ background: C.white, border: '1px solid #EBEBEB', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{fmtDate(m.performed_date)}</span>
                        {(() => {
                          const palette: Record<MaintenanceType, { bg: string; color: string }> = {
                            preventive_form_a: { bg: '#E3F0FF', color: '#1A62C0' },
                            preventive_form_d: { bg: '#F0E8FF', color: '#6B21A8' },
                            preventive:        { bg: '#E4F3E3', color: '#1B512D' },
                            corrective:        { bg: '#FFF0E0', color: '#B45309' },
                          };
                          const p = palette[m.maintenance_type] ?? palette.corrective;
                          return (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                              background: p.bg, color: p.color,
                              textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              {MAINTENANCE_TYPE_LABEL[m.maintenance_type] ?? m.maintenance_type}
                            </span>
                          );
                        })()}
                        {m.next_due_date && (
                          <span style={{ fontSize: 11, color: C.slate }}>· Next: {fmtDate(m.next_due_date)}</span>
                        )}
                      </div>
                      {m.pdf_filename && (
                        <div style={{ fontSize: 11, color: C.slate }}>{m.pdf_filename}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {m.pdf_path && (
                        <button onClick={() => openPdf(m.pdf_path!)}
                          style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          ⬇ PDF
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => deleteMaintenance(m)}
                          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #FDEAEA', background: 'transparent', color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailStat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: valueColor ?? C.green }}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #F3F3F3', paddingBottom: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: '#1a1a1a', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// ── Location Card ─────────────────────────────────────────────────

interface LocationCardProps {
  location: Location;
  chargers: Charger[];
  brand: Brand | null;
  onClick: () => void;
}

function LocationCard({ location, chargers, brand, onClick }: LocationCardProps) {
  const withPm    = chargers.filter((c) => effectivePmDate(c) !== null).length;
  const missingPm = chargers.length - withPm;
  const earliest  = earliestPmDate(chargers);
  const pm        = pmUrgency(earliest);

  return (
    <div
      onClick={onClick}
      style={{ background: C.white, borderRadius: 16, padding: '18px 20px', border: '1px solid #EBEBEB', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 14, transition: 'border-color .15s, box-shadow .15s' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#C8E6C9'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#EBEBEB'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ minWidth: 0, flex: 1, maxWidth: '65%' }}>
          <div title={location.name} style={{
            fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.25,
            color: '#1a1a1a',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            wordBreak: 'break-word',
          }}>
            {location.name}
          </div>
          {location.address && (
            <div style={{ fontSize: 12, color: C.slate, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 11, flexShrink: 0 }}>📍</span>
              <span title={location.address} style={{
                minWidth: 0, flex: 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{location.address}</span>
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'flex-start', gap: 8, minWidth: 48 }}>
          {brand
            ? <BrandLogo brand={brand} height={brand === 'evone' ? 18 : 26} />
            : (
              <div style={{ background: C.honeydew, color: C.green, borderRadius: 10, padding: '6px 12px', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                {chargers.length} ⚡
              </div>
            )}
          {location.csms_platform && (
            <BrandLogo brand={location.csms_platform} height={28} />
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {chargers.length === 0 ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: C.slate, fontStyle: 'italic' }}>
            No chargers yet
          </span>
        ) : (
          <>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: '#E4F3E3', color: '#1B512D' }}>
              {withPm} PM scheduled
            </span>
            {missingPm > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: '#FFF8E1', color: '#B07D00' }}>
                {missingPm} no PM
              </span>
            )}
          </>
        )}
      </div>

      <div style={{ background: pm.bg, color: pm.color, borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Earliest PM</span>
        <span>{pm.label}</span>
      </div>
    </div>
  );
}

// ── Charger Card ──────────────────────────────────────────────────

interface ChargerCardProps {
  charger: Charger;
  latestReading: MeterReading | null;
  onClick: () => void;
}

function ChargerCard({ charger, latestReading, onClick }: ChargerCardProps) {
  const pmFormA = pmUrgency(charger.form_a_next_date);
  const pmFormD = pmUrgency(charger.form_d_next_date);

  return (
    <div
      onClick={onClick}
      style={{ background: C.white, borderRadius: 16, padding: '18px 20px', border: '1px solid #EBEBEB', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12, transition: 'border-color .15s, box-shadow .15s' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#C8E6C9'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#EBEBEB'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {charger.charger_code}
          </div>
          {charger.bay_label && (
            <div style={{ fontSize: 12, color: '#1a1a1a', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {charger.bay_label}
            </div>
          )}
          {charger.brand_model && (
            <div style={{ fontSize: 11, color: C.slate, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {charger.brand_model}
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.slate }}>
        {[
          charger.charger_type,
          charger.power_kw ? `${charger.power_kw} kW` : null,
          charger.num_connectors && charger.num_connectors > 1 ? `${charger.num_connectors} connectors` : null,
        ].filter(Boolean).join(' · ') || '—'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingTop: 4, borderTop: '1px solid #F3F3F3' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Type-Approval ID</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {charger.type_approval_id ?? '—'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Latest Reading</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a' }}>
            {latestReading ? `${Number(latestReading.reading_kwh).toLocaleString()} kWh` : '—'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ background: pmFormA.bg, color: pmFormA.color, borderRadius: 10, padding: '6px 12px', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Form A (6-mo)</span>
          <span>{pmFormA.label}</span>
        </div>
        <div style={{ background: pmFormD.bg, color: pmFormD.color, borderRadius: 10, padding: '6px 12px', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Form D (12-mo)</span>
          <span>{pmFormD.label}</span>
        </div>
      </div>
    </div>
  );
}

// ── Location Drilldown Modal ──────────────────────────────────────

type PmFilter = 'all' | 'overdue' | 'due_soon' | 'no_pm';

interface LocationDrilldownProps {
  location: Location;
  chargers: Charger[];
  latestByCharger: Map<string, MeterReading>;
  canEdit: boolean;
  onClose: () => void;
  onSelectCharger: (c: Charger) => void;
  onAddCharger: () => void;
  onEditLocation: () => void;
}

function LocationDrilldownModal({ location, chargers, latestByCharger, canEdit, onClose, onSelectCharger, onAddCharger, onEditLocation }: LocationDrilldownProps) {
  const [pmFilter, setPmFilter] = useState<PmFilter>('all');

  const pmStatus = (c: Charger): PmFilter => {
    const d = daysFromToday(effectivePmDate(c));
    if (d === null) return 'no_pm';
    if (d < 0) return 'overdue';
    if (d <= 30) return 'due_soon';
    return 'all';
  };

  const overdue   = chargers.filter((c) => pmStatus(c) === 'overdue').length;
  const dueSoon   = chargers.filter((c) => pmStatus(c) === 'due_soon').length;
  const noPm      = chargers.filter((c) => pmStatus(c) === 'no_pm').length;
  const earliest  = earliestPmDate(chargers);
  const pm        = pmUrgency(earliest);

  const visible = chargers.filter((c) => pmFilter === 'all' || pmStatus(c) === pmFilter);

  const PM_TABS: { id: PmFilter; label: string; count: number }[] = [
    { id: 'all',      label: 'All',           count: chargers.length },
    { id: 'overdue',  label: 'PM Overdue',    count: overdue },
    { id: 'due_soon', label: 'PM Due ≤ 30d',  count: dueSoon },
    { id: 'no_pm',    label: 'No PM Set',     count: noPm },
  ];

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 820, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div title={location.name} style={{
              fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.25,
              color: '#1a1a1a',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              overflow: 'hidden', wordBreak: 'break-word',
            }}>{location.name}</div>
            {location.address && (
              <div style={{ fontSize: 13, color: C.slate, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 12, flexShrink: 0 }}>📍</span>
                <span title={location.address} style={{
                  minWidth: 0, flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{location.address}</span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {canEdit && (
              <button onClick={onEditLocation}
                style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Edit Location
              </button>
            )}
            <button onClick={onClose}
              style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
          </div>
        </div>

        {/* Compact stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <DetailStat label="Chargers"     value={String(chargers.length)} />
          <DetailStat label="PM Overdue"   value={String(overdue)}  valueColor={overdue > 0 ? '#C0321A' : undefined} />
          <DetailStat label="PM Due ≤ 30d" value={String(dueSoon)}  valueColor={dueSoon > 0 ? '#B45309' : undefined} />
          <DetailStat label="Earliest PM"  value={pm.label}         valueColor={pm.color} />
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {PM_TABS.map((t) => {
              const active = pmFilter === t.id;
              return (
                <button key={t.id} onClick={() => setPmFilter(t.id)}
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
          {canEdit && (
            <button onClick={onAddCharger}
              style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + New Charger
            </button>
          )}
        </div>

        {/* Charger grid */}
        {visible.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: C.slate, fontSize: 13, background: C.seasalt, borderRadius: 12, border: '1px dashed #EBEBEB' }}>
            {chargers.length === 0
              ? 'No chargers at this location yet. Click "+ New Charger" to add the first one.'
              : 'No chargers match the current filter.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {visible.map((c) => (
              <ChargerCard
                key={c.id}
                charger={c}
                latestReading={latestByCharger.get(c.id) ?? null}
                onClick={() => onSelectCharger(c)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Screen Root ───────────────────────────────────────────────────

export function ScreenCPOChargers() {
  const { can } = usePermissions();
  const canEdit   = can('cpochargers', 'can_edit');
  const canDelete = can('cpochargers', 'can_delete');

  const [locations, setLocations] = useState<Location[]>([]);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View state
  const [viewLocationId, setViewLocationId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Modal state
  const [selectedCharger, setSelectedCharger] = useState<Charger | null>(null);
  const [editingCharger, setEditingCharger] = useState<Charger | null>(null);
  const [addingCharger, setAddingCharger] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [addingLocation, setAddingLocation] = useState(false);

  const [managedCarparks, setManagedCarparks] = useState<ManagedCarparkOption[]>([]);

  const fetchAll = async () => {
    const [l, c, r, m] = await Promise.all([
      supabase.from('cpo_locations').select('*').order('name'),
      supabase.from('cpo_chargers').select('*').order('charger_code'),
      supabase.from('cpo_meter_readings').select('*').order('reading_date', { ascending: false }),
      supabase.from('cpo_managed_carparks').select('carpark_name, location_id, category'),
    ]);
    if (l.error) { setError(l.error.message); setLoading(false); return; }
    setLocations((l.data as Location[]) ?? []);
    setChargers((c.data as Charger[]) ?? []);
    setReadings((r.data as MeterReading[]) ?? []);
    setManagedCarparks((m.data as ManagedCarparkOption[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // keep selected charger in sync after refresh
  useEffect(() => {
    if (!selectedCharger) return;
    const updated = chargers.find((c) => c.id === selectedCharger.id);
    if (updated && updated !== selectedCharger) setSelectedCharger(updated);
    if (!updated) setSelectedCharger(null);
  }, [chargers]); // eslint-disable-line react-hooks/exhaustive-deps

  const latestByCharger = useMemo(() => {
    const map = new Map<string, MeterReading>();
    for (const r of readings) {
      if (!map.has(r.charger_id)) map.set(r.charger_id, r);
    }
    return map;
  }, [readings]);

  const chargersByLocation = useMemo(() => {
    const map = new Map<string, Charger[]>();
    for (const c of chargers) {
      if (!c.location_id) continue;
      const list = map.get(c.location_id) ?? [];
      list.push(c);
      map.set(c.location_id, list);
    }
    return map;
  }, [chargers]);

  // ── Location-level data ─────────────────────────────────────────

  const currentLocation = useMemo(
    () => (viewLocationId ? locations.find((l) => l.id === viewLocationId) ?? null : null),
    [locations, viewLocationId],
  );

  // CRUD ─────────────────────────────────────────────────────────

  // Splits the modal form into the cpo_locations payload + the carpark-link UI field.
  const splitForm = (data: LocationForm) => {
    const { linked_carpark_name, ...rest } = data;
    return { row: rest, linked_carpark_name };
  };

  // After the location is saved, reconcile cpo_managed_carparks.location_id:
  //   - clear any carpark previously linked to this location that the user no longer wants linked
  //   - link the newly chosen carpark to this location
  const syncCarparkLink = async (locationId: string, newCarparkName: string | null) => {
    await supabase.from('cpo_managed_carparks')
      .update({ location_id: null, updated_at: new Date().toISOString() })
      .eq('location_id', locationId);
    if (newCarparkName) {
      await supabase.from('cpo_managed_carparks')
        .update({ location_id: locationId, updated_at: new Date().toISOString() })
        .eq('carpark_name', newCarparkName);
    }
  };

  const addLocation = async (data: LocationForm) => {
    const { row, linked_carpark_name } = splitForm(data);
    const { data: created, error } = await supabase.from('cpo_locations').insert(row).select().single();
    if (error || !created) { setError(error?.message ?? 'Could not create location'); return; }
    if (linked_carpark_name) await syncCarparkLink(created.id, linked_carpark_name);
    await fetchAll();
  };

  const updateLocation = async (id: string, data: LocationForm) => {
    const { row, linked_carpark_name } = splitForm(data);
    const { error } = await supabase.from('cpo_locations').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { setError(error.message); return; }
    await syncCarparkLink(id, linked_carpark_name);
    await fetchAll();
  };

  const deleteLocation = async (id: string) => {
    const { error } = await supabase.from('cpo_locations').delete().eq('id', id);
    if (error) { setError(error.message); return; }
    if (viewLocationId === id) setViewLocationId(null);
    await fetchAll();
  };

  const addCharger = async (data: ChargerForm) => {
    const { error } = await supabase.from('cpo_chargers').insert(data);
    if (error) { setError(error.message); return; }
    await fetchAll();
  };

  const updateCharger = async (id: string, data: ChargerForm) => {
    const { error } = await supabase.from('cpo_chargers').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { setError(error.message); return; }
    await fetchAll();
  };

  const deleteCharger = async (id: string) => {
    const { data: recs } = await supabase.from('cpo_maintenance_records').select('pdf_path').eq('charger_id', id);
    const paths = (recs ?? []).map((r: { pdf_path: string | null }) => r.pdf_path).filter((p): p is string => !!p);
    if (paths.length) await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    const { error } = await supabase.from('cpo_chargers').delete().eq('id', id);
    if (error) { setError(error.message); return; }
    setSelectedCharger(null);
    await fetchAll();
  };

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  // ── Render ──────────────────────────────────────────────────────

  const visibleLocations = locations.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return l.name.toLowerCase().includes(q) || (l.address ?? '').toLowerCase().includes(q);
  });

  const totalChargers = chargers.length;
  const pmOverdue = chargers.filter((c) => {
    const d = daysFromToday(effectivePmDate(c));
    return d !== null && d < 0;
  }).length;
  const pmDueSoon = chargers.filter((c) => {
    const d = daysFromToday(effectivePmDate(c));
    return d !== null && d >= 0 && d <= 30;
  }).length;
  const noPm = chargers.filter((c) => effectivePmDate(c) === null).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Total Locations" value={String(locations.length)} sub="across Singapore" accent />
        <KPICard label="Total Chargers"  value={String(totalChargers)} sub={`${noPm} with no PM scheduled`} />
        <KPICard label="PM Overdue"      value={String(pmOverdue)} sub="Form A or Form D past due" />
        <KPICard label="PM Due Soon"     value={String(pmDueSoon)} sub="within 30 days" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 280 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search locations…"
            style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}>⌕</span>
        </div>
        {canEdit && (
          <button onClick={() => setAddingLocation(true)}
            style={{ marginLeft: 'auto', padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + New Location
          </button>
        )}
      </div>

      {visibleLocations.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 14, background: C.white, borderRadius: 16, border: '1px dashed #EBEBEB' }}>
          {locations.length === 0
            ? 'No locations yet. Click "+ New Location" to add your first site.'
            : 'No locations match the current search.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {visibleLocations.map((l) => {
            const linkedCarpark = managedCarparks.find((m) => m.location_id === l.id);
            const brand: Brand | null =
              linkedCarpark?.category === 'evone_cpo' ? 'evone' :
              linkedCarpark?.category === 'eve_cpo'   ? 'eve'   :
              null;
            return (
              <LocationCard
                key={l.id}
                location={l}
                chargers={chargersByLocation.get(l.id) ?? []}
                brand={brand}
                onClick={() => setViewLocationId(l.id)}
              />
            );
          })}
        </div>
      )}

      {viewLocationId && currentLocation && (
        <LocationDrilldownModal
          location={currentLocation}
          chargers={chargersByLocation.get(viewLocationId) ?? []}
          latestByCharger={latestByCharger}
          canEdit={canEdit}
          onClose={() => setViewLocationId(null)}
          onSelectCharger={(c) => setSelectedCharger(c)}
          onAddCharger={() => setAddingCharger(true)}
          onEditLocation={() => setEditingLocation(currentLocation)}
        />
      )}

      {selectedCharger && (
        <DetailModal
          charger={selectedCharger}
          location={locations.find((l) => l.id === selectedCharger.location_id) ?? null}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={() => setSelectedCharger(null)}
          onEdit={() => setEditingCharger(selectedCharger)}
          onChanged={fetchAll}
        />
      )}

      {addingCharger && (
        <ChargerModal title={`New Charger at ${currentLocation?.name ?? ''}`}
          initial={makeBlankCharger(viewLocationId)}
          locations={locations} lockLocation={!!viewLocationId}
          onSave={addCharger} onClose={() => setAddingCharger(false)} />
      )}

      {editingCharger && (
        <ChargerModal key={editingCharger.id}
          title={`Edit ${editingCharger.charger_code}`}
          initial={{
            charger_code: editingCharger.charger_code,
            location_id: editingCharger.location_id,
            bay_label: editingCharger.bay_label,
            latitude: editingCharger.latitude,
            longitude: editingCharger.longitude,
            charger_type: editingCharger.charger_type,
            power_kw: editingCharger.power_kw,
            num_connectors: editingCharger.num_connectors,
            brand_model: editingCharger.brand_model,
            type_approval_id: editingCharger.type_approval_id,
            registration_code: editingCharger.registration_code,
            next_maintenance_date: editingCharger.next_maintenance_date,
            form_a_next_date: editingCharger.form_a_next_date,
            form_d_next_date: editingCharger.form_d_next_date,
            notes: editingCharger.notes,
          }}
          locations={locations}
          onSave={(data) => updateCharger(editingCharger.id, data)}
          onDelete={canDelete ? () => deleteCharger(editingCharger.id) : undefined}
          onClose={() => setEditingCharger(null)} />
      )}

      {addingLocation && (
        <LocationModal title="New Location" initial={blankLocation}
          managedCarparks={managedCarparks}
          onSave={addLocation} onClose={() => setAddingLocation(false)} />
      )}

      {editingLocation && (
        <LocationModal key={editingLocation.id} title={`Edit ${editingLocation.name}`}
          initial={{
            name: editingLocation.name,
            address: editingLocation.address,
            latitude: editingLocation.latitude,
            longitude: editingLocation.longitude,
            csms_platform: editingLocation.csms_platform,
            notes: editingLocation.notes,
            linked_carpark_name: managedCarparks.find((m) => m.location_id === editingLocation.id)?.carpark_name ?? null,
          }}
          chargerCount={(chargersByLocation.get(editingLocation.id) ?? []).length}
          managedCarparks={managedCarparks}
          currentLocationId={editingLocation.id}
          onSave={(data) => updateLocation(editingLocation.id, data)}
          onDelete={canDelete ? () => deleteLocation(editingLocation.id) : undefined}
          onClose={() => setEditingLocation(null)} />
      )}
    </div>
  );
}
