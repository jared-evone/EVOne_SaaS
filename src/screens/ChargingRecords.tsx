import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';
import { CarparksTab, type ManagedCarpark, type CpoLocationLite, type CarparkAgg } from './charging/CarparksTab';
import { Search, Download as DownloadIcon } from 'lucide-react';
import { FileText } from 'lucide-react';
// CsvImportTab is archived in src/screens/charging/CsvImportTab.tsx — left on disk
// in case we want to re-enable the temporary preview tab later.

const PREVIEW_LIMIT = 1000;

const PER_PAGE = 15;
const BATCH_SIZE = 500;

// ── Types ─────────────────────────────────────────────────────────

interface ChargingRecord {
  id: string;
  source: 'goparkin' | 'sp';
  carpark_code: string | null;
  charger_id: string | null;
  connector_id: string | null;
  charge_type: string | null;
  vehicle_plate_number: string | null;
  start_date_time: string | null;
  end_date_time: string | null;
  total_charging_time_minutes: number | null;
  total_energy_supplied_kwh: number | null;
  transaction_amount: number | null;
  payment_amount: number | null;
  payment_status: string | null;
  mode_of_payment: string | null;
  payment_date: string | null;
  transaction_type: string | null;
  discount_rate: number | null;
}

type ChargingRow = Omit<ChargingRecord, 'id' | 'source'>;

interface SpCarparkPrice {
  id: string;
  carpark_code: string;
  price_per_kwh: number;
  updated_at: string;
}

// ── Constants ─────────────────────────────────────────────────────

const SOURCE_LABELS: Record<'goparkin' | 'sp', string> = { goparkin: 'GoParkin', sp: 'SP' };
const SOURCE_COLORS: Record<'goparkin' | 'sp', { bg: string; color: string }> = {
  goparkin: { bg: '#E3F0FF', color: '#1A62C0' },
  sp:       { bg: '#FFF0E0', color: '#B45309' },
};
const PAYMENT_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  completed: { bg: '#E4F3E3', color: '#1B512D' },
  paid:      { bg: '#E4F3E3', color: '#1B512D' },
  success:   { bg: '#E4F3E3', color: '#1B512D' },
  pending:   { bg: '#FFF8E1', color: '#B07D00' },
  failed:    { bg: '#FDEAEA', color: '#C0321A' },
};

// ── Helpers ───────────────────────────────────────────────────────

function fmtDT(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour12: false, year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-SG');
}

function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/[\s\-\/\(\)]+/g, '_').replace(/_+/g, '_').replace(/_$/, '');
}

const KEY_ALIASES: Record<string, string> = {
  carpark:          'carpark_code',
  charger:          'charger_id',
  connector:        'connector_id',
  plate:            'vehicle_plate_number',
  vehicle_plate:    'vehicle_plate_number',
  start:            'start_date_time',
  end:              'end_date_time',
  duration:         'total_charging_time_minutes',
  duration_min:     'total_charging_time_minutes',
  duration_minutes: 'total_charging_time_minutes',
  energy:           'total_energy_supplied_kwh',
  energy_kwh:       'total_energy_supplied_kwh',
  kwh:              'total_energy_supplied_kwh',
  amount:           'transaction_amount',
  payment:          'payment_amount',
  status:           'payment_status',
  mode:             'mode_of_payment',
  payment_mode:     'mode_of_payment',
  date:             'payment_date',
  type:             'transaction_type',
  discount:         'discount_rate',
  charger_type:     'charge_type',
  charging_type:    'charge_type',
  chargetype:       'charge_type',
};

function resolveKey(raw: string): string {
  const k = normalizeKey(raw);
  return KEY_ALIASES[k] ?? k;
}

function mapRow(raw: Record<string, string>): ChargingRow {
  const get = (k: string): string | null => {
    const v = raw[k];
    return !v || v === 'null' || v === 'NULL' ? null : v.trim();
  };
  const num = (k: string): number | null => {
    const v = get(k);
    if (v === null) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };
  return {
    carpark_code:                get('carpark_code'),
    charger_id:                  get('charger_id'),
    connector_id:                get('connector_id'),
    charge_type:                 get('charge_type'),
    vehicle_plate_number:        get('vehicle_plate_number'),
    start_date_time:             get('start_date_time'),
    end_date_time:               get('end_date_time'),
    total_charging_time_minutes: num('total_charging_time_minutes'),
    total_energy_supplied_kwh:   num('total_energy_supplied_kwh'),
    transaction_amount:          num('transaction_amount'),
    payment_amount:              num('payment_amount'),
    payment_status:              get('payment_status'),
    mode_of_payment:             get('mode_of_payment'),
    payment_date:                get('payment_date'),
    transaction_type:            get('transaction_type'),
    discount_rate:               num('discount_rate'),
  };
}

// ── SP CSV Parser ─────────────────────────────────────────────────

function splitCSVLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { fields.push(cur); cur = ''; }
      else cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function parseSpDateTime(dateStr: string, timeStr: string): string | null {
  if (!dateStr || !timeStr) return null;
  const d = dateStr.trim().split('/');
  if (d.length !== 3) return null;
  const [day, month, year] = d;
  const t = timeStr.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!t) return null;
  let h = parseInt(t[1]);
  const m = parseInt(t[2]);
  const s = parseInt(t[3]);
  if (t[4].toUpperCase() === 'AM' && h === 12) h = 0;
  else if (t[4].toUpperCase() === 'PM' && h !== 12) h += 12;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}+08:00`;
}

function parseSpDuration(dur: string): number | null {
  const m = dur.trim().match(/^(\d+)h\s+(\d+)m\s+([\d.]+)s$/);
  if (!m) return null;
  const total = parseInt(m[1]) * 60 + parseInt(m[2]) + parseFloat(m[3]) / 60;
  return Math.round(total * 10) / 10;
}

function parseSpConnector(raw: string): { chargerId: string | null; connectorId: string | null } {
  const m = raw.trim().match(/^(.+)-(\d+):\d+$/);
  if (!m) return { chargerId: raw.trim() || null, connectorId: null };
  return { chargerId: m[1], connectorId: m[2] };
}

function parseSpCSV(text: string): { rows: ChargingRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length < 2) {
    warnings.push('File appears empty or header-only.');
    return { rows: [], warnings };
  }

  const rawHeaders = splitCSVLine(nonEmpty[0]).map((h) => h.trim());
  const col = (name: string) => rawHeaders.indexOf(name);

  const iLocationName = col('Location Name');
  const iConnector    = col('Connector');
  const iVolume       = col('Volume (kWh)');
  const iStartDate    = col('Start Date');
  const iStartTime    = col('Start Time');
  const iEndDate      = col('End Date');
  const iEndTime      = col('End Time');
  const iDuration     = col('Charging Duration');

  const rows: ChargingRow[] = [];

  for (let i = 1; i < nonEmpty.length; i++) {
    const cols = splitCSVLine(nonEmpty[i]);
    if (cols.every((c) => !c.trim())) continue;

    const g = (idx: number) => (idx >= 0 ? (cols[idx] ?? '').trim() : '');
    const { chargerId, connectorId } = parseSpConnector(g(iConnector));
    const endDateStr = g(iEndDate);

    rows.push({
      carpark_code:                g(iLocationName) || null,
      charger_id:                  chargerId,
      connector_id:                connectorId,
      charge_type:                 'DC',
      vehicle_plate_number:        'SP Vehicles',
      start_date_time:             parseSpDateTime(g(iStartDate), g(iStartTime)),
      end_date_time:               parseSpDateTime(endDateStr, g(iEndTime)),
      total_charging_time_minutes: parseSpDuration(g(iDuration)),
      total_energy_supplied_kwh:   g(iVolume) ? (Number(g(iVolume)) || null) : null,
      transaction_amount:          null,
      payment_amount:              null,
      payment_status:              'Success',
      mode_of_payment:             'SP Payment',
      payment_date:                endDateStr ? (() => {
        const p = endDateStr.split('/');
        return p.length === 3 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : null;
      })() : null,
      transaction_type:            'SP Payment',
      discount_rate:               0,
    });
  }

  return { rows, warnings };
}

// ── GoParkin XLSX Parser ──────────────────────────────────────────

async function parseXLSXFile(file: File): Promise<{ rows: ChargingRow[]; warnings: string[] }> {
  const warnings: string[] = [];
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });

  if (raw.length === 0) {
    warnings.push('Spreadsheet appears empty.');
    return { rows: [], warnings };
  }

  const rows: ChargingRow[] = raw.map((r) => {
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      normalized[resolveKey(k)] = String(v ?? '');
    }
    return mapRow(normalized);
  });

  return { rows, warnings };
}

// ── Price Application ─────────────────────────────────────────────

function applySpPrices(rows: ChargingRow[], prices: SpCarparkPrice[]): ChargingRow[] {
  const priceMap = new Map(prices.map((p) => [p.carpark_code, Number(p.price_per_kwh)]));
  return rows.map((r) => {
    const price = r.carpark_code ? (priceMap.get(r.carpark_code) ?? null) : null;
    const txn = price != null && r.total_energy_supplied_kwh != null
      ? Math.round(r.total_energy_supplied_kwh * price * 100) / 100
      : null;
    return { ...r, transaction_amount: txn, payment_amount: txn };
  });
}

// ── Duplicate Detection ───────────────────────────────────────────

function makeDupeKey(r: { charger_id?: string | null; connector_id?: string | null; start_date_time?: string | null }): string | null {
  if (!r.charger_id || !r.start_date_time) return null;
  // Normalize to ISO format and force UTC when no timezone offset is present.
  // Supabase (PostgreSQL) treats timezone-less inserts as UTC, so strings like
  // "2026-05-10 07:59:00" from GoParkin XLSX are stored as 07:59 UTC.
  // The browser parses the same string as local time (SGT +8) → wrong epoch.
  // Appending Z makes the browser agree with what Postgres stored.
  const s = r.start_date_time.trim().replace(' ', 'T');
  const hasOffset = /[Zz]|[+\-]\d{2}:\d{2}$/.test(s);
  const t = new Date(hasOffset ? s : s + 'Z').getTime();
  if (isNaN(t)) return null;
  return `${r.charger_id}|${r.connector_id ?? ''}|${t}`;
}

async function fetchExistingKeys(chargerIds: string[]): Promise<Set<string>> {
  if (chargerIds.length === 0) return new Set();
  const keys = new Set<string>();
  const ID_CHUNK = 100;
  const PAGE = 1000;
  for (let i = 0; i < chargerIds.length; i += ID_CHUNK) {
    const chunk = chargerIds.slice(i, i + ID_CHUNK);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('crm_charging_records')
        .select('charger_id, connector_id, start_date_time')
        .in('charger_id', chunk)
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      for (const r of data) {
        const key = makeDupeKey(r);
        if (key) keys.add(key);
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  return keys;
}

function filterDupes(incoming: ChargingRow[], existingKeys: Set<string>): { clean: ChargingRow[]; dupeCount: number } {
  const clean: ChargingRow[] = [];
  let dupeCount = 0;
  for (const row of incoming) {
    const key = makeDupeKey(row);
    if (key !== null && existingKeys.has(key)) {
      dupeCount++;
    } else {
      clean.push(row);
    }
  }
  return { clean, dupeCount };
}

// ── Freshness pill ────────────────────────────────────────────────

function FreshnessPill({ source, at }: { source: 'goparkin' | 'sp'; at: string | null }) {
  const label = source === 'goparkin' ? 'GoParkin' : 'SP';
  const srcStyle = SOURCE_COLORS[source];

  if (!at) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 99, background: '#F3F3F3', color: '#767B77', fontSize: 12, fontWeight: 600 }}>
        <span style={{ background: srcStyle.bg, color: srcStyle.color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99 }}>{label}</span>
        no records yet
      </span>
    );
  }

  const iso = at.includes(' ') ? at.replace(' ', 'T') : at;
  const ms = new Date(iso).getTime();
  const ageMs   = Date.now() - ms;
  const ageDays = Math.floor(ageMs / 86_400_000);
  const ageHrs  = Math.floor(ageMs / 3_600_000);
  const ageLabel =
    ageDays >= 1 ? `${ageDays} day${ageDays === 1 ? '' : 's'} ago` :
    ageHrs  >= 1 ? `${ageHrs} hour${ageHrs === 1 ? '' : 's'} ago`  :
                   '<1 hour ago';
  const tone =
    ageDays >= 7 ? { bg: '#FDEAEA', fg: '#C0321A' } :
    ageDays >= 2 ? { bg: '#FFF8E1', fg: '#B07D00' } :
                   { bg: C.honeydew, fg: C.green };
  const fmt = new Date(ms).toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  return (
    <span title={`Latest ${label} record · ${fmt}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 99,
        background: tone.bg, color: tone.fg, fontSize: 12, fontWeight: 700 }}>
      <span style={{ background: srcStyle.bg, color: srcStyle.color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, letterSpacing: '0.02em' }}>{label}</span>
      {fmt} <span style={{ opacity: 0.75, fontWeight: 500 }}>· {ageLabel}</span>
    </span>
  );
}

// ── Paginator ─────────────────────────────────────────────────────

function Paginator({ page, totalPages, total, from, to, onPrev, onNext }: {
  page: number; totalPages: number; total: number; from: number; to: number;
  onPrev: () => void; onNext: () => void;
}) {
  const btn = (disabled: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid #EBEBEB',
    background: disabled ? C.seasalt : C.white, color: disabled ? '#ccc' : C.slate,
    fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
  });
  return (
    <div style={{ padding: '10px 16px', borderTop: '1px solid #F3F3F3', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 12, color: C.slate }}>{total === 0 ? 'No results' : `Showing ${from}–${to} of ${total}`}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onPrev} disabled={page === 1} style={btn(page === 1)}>← Prev</button>
        <span style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>Page {page} of {totalPages}</span>
        <button onClick={onNext} disabled={page >= totalPages} style={btn(page >= totalPages)}>Next →</button>
      </div>
    </div>
  );
}

// ── New Carpark Prices Modal ──────────────────────────────────────

interface NewCarparkPricesModalProps {
  carparks: string[];
  onSave: (prices: Record<string, number>) => Promise<void>;
  onClose: () => void;
}

function NewCarparkPricesModal({ carparks, onSave, onClose }: NewCarparkPricesModalProps) {
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(carparks.map((c) => [c, '']))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const priceMap: Record<string, number> = {};
    for (const c of carparks) {
      const v = parseFloat(inputs[c] ?? '');
      if (isNaN(v) || v < 0) {
        setError(`Enter a valid price for "${c}"`);
        return;
      }
      priceMap[c] = v;
    }
    setSaving(true);
    await onSave(priceMap);
    setSaving(false);
  };

  return (
    <div
     
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 500, maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>New Carpark Prices</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>
              {carparks.length} new carpark{carparks.length !== 1 ? 's' : ''} found — set the price per kWh before importing.
            </div>
          </div>
          {!saving && (
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree', flexShrink: 0 }}>×</button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {carparks.map((c) => (
            <div key={c} style={{ background: C.seasalt, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#1a1a1a', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: C.slate }}>$/kWh</span>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={inputs[c] ?? ''}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [c]: e.target.value }))}
                  placeholder="0.000"
                  style={{ width: 96, padding: '7px 10px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', textAlign: 'right' }}
                />
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div style={{ background: '#FDEAEA', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#C0321A' }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {!saving && (
            <button onClick={onClose}
              style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: saving ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save & Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SP Price Tab ──────────────────────────────────────────────────

interface SpPriceTabProps {
  prices: SpCarparkPrice[];
  onRefresh: () => Promise<void>;
}

function SpPriceTab({ prices, onRefresh }: SpPriceTabProps) {
  const [editId, setEditId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const startEdit = (p: SpCarparkPrice) => {
    setEditId(p.id);
    setEditPrice(String(p.price_per_kwh));
  };

  const cancelEdit = () => { setEditId(null); setEditPrice(''); };

  const saveEdit = async () => {
    const v = parseFloat(editPrice);
    if (isNaN(v) || v < 0) return;
    setSaving(true);
    await supabase.from('sp_carpark_prices')
      .update({ price_per_kwh: v, updated_at: new Date().toISOString() })
      .eq('id', editId!);
    await onRefresh();
    setSaving(false);
    setEditId(null);
  };

  const saveAdd = async () => {
    setAddError(null);
    const code = newCode.trim();
    const v = parseFloat(newPrice);
    if (!code) { setAddError('Carpark code is required.'); return; }
    if (isNaN(v) || v < 0) { setAddError('Enter a valid price.'); return; }
    if (prices.some((p) => p.carpark_code === code)) { setAddError('This carpark already exists.'); return; }
    setSaving(true);
    await supabase.from('sp_carpark_prices').insert({ carpark_code: code, price_per_kwh: v });
    await onRefresh();
    setSaving(false);
    setAddMode(false);
    setNewCode('');
    setNewPrice('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>SP Carpark Prices</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 3 }}>
            Prices are baked into records at import time — editing here only affects future uploads.
          </div>
        </div>
        {!addMode && (
          <button onClick={() => setAddMode(true)}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
            + Add Carpark
          </button>
        )}
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        {addMode && (
          <div style={{ borderBottom: `2px solid ${C.green}`, padding: '16px 20px', background: C.honeydew, display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Carpark Code</label>
              <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="e.g. Suntec City"
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', width: 220 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Price ($/kWh)</label>
              <input type="number" min="0" step="0.001" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0.000"
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', width: 120, textAlign: 'right' }} />
            </div>
            {addError && <div style={{ fontSize: 12, color: '#C0321A', alignSelf: 'center' }}>{addError}</div>}
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <button onClick={() => { setAddMode(false); setNewCode(''); setNewPrice(''); setAddError(null); }}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveAdd} disabled={saving}
                style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: saving ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['Carpark Code', 'Price / kWh (SGD)', 'Last Updated', ''].map((h) => (
                <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #F3F3F3' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 700, color: C.green }}>{p.carpark_code}</td>
                <td style={{ padding: '14px 20px' }}>
                  {editId === p.id
                    ? (
                      <input type="number" min="0" step="0.001" value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)} autoFocus
                        style={{ width: 110, padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.green}`, fontFamily: 'Figtree', fontSize: 13, outline: 'none', textAlign: 'right' }} />
                    )
                    : <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>${Number(p.price_per_kwh).toFixed(4)}</span>
                  }
                </td>
                <td style={{ padding: '14px 20px', fontSize: 12, color: C.slate }}>
                  {new Date(p.updated_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                </td>
                <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                  {editId === p.id
                    ? (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={cancelEdit}
                          style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          Cancel
                        </button>
                        <button onClick={saveEdit} disabled={saving}
                          style={{ padding: '5px 14px', borderRadius: 8, border: 'none', background: saving ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    )
                    : (
                      <button onClick={() => startEdit(p)}
                        style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        Edit
                      </button>
                    )}
                </td>
              </tr>
            ))}
            {prices.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '48px 20px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                  No carpark prices configured yet. Add one above, or upload an SP CSV and you'll be prompted.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Upload Modal ──────────────────────────────────────────────────

interface UploadModalProps {
  source: 'goparkin' | 'sp';
  fileName: string;
  rows: ChargingRow[];
  warnings: string[];
  dupeCount: number;
  uploaderEmail: string;
  uploaderDepartment: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function UploadModal({ source, fileName, rows, warnings, dupeCount, uploaderEmail, uploaderDepartment, onConfirm, onClose }: UploadModalProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const srcColor = SOURCE_COLORS[source];

  const handleUpload = async () => {
    setUploading(true);
    setUploadError(null);
    setProgress({ done: 0, total: rows.length });

    // 1) Create the upload-history row first so we can stamp upload_id on every batch.
    const { data: upload, error: upErr } = await supabase
      .from('crm_charging_record_uploads')
      .insert({
        source,
        file_label:  fileName,
        row_count:   rows.length,
        uploaded_by: uploaderEmail,
        department:  uploaderDepartment,
      })
      .select('id')
      .single();
    if (upErr || !upload) {
      setUploadError(upErr?.message ?? 'Could not start upload tracking.');
      setUploading(false);
      return;
    }
    const uploadId = upload.id as string;

    // 2) Insert records in batches, every row carries upload_id for later revert.
    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({ ...r, source, upload_id: uploadId }));
      const { error: insErr } = await supabase.from('crm_charging_records').insert(batch);
      if (insErr) {
        setUploadError(`Inserted ${done.toLocaleString()} rows before failing: ${insErr.message}. Use Upload History to revert this partial upload.`);
        setUploading(false);
        return;
      }
      done += batch.length;
      setProgress({ done, total: rows.length });
    }
    await onConfirm();
    setUploading(false);
    onClose();
  };

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 500, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ background: srcColor.bg, color: srcColor.color, fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99 }}>
              {SOURCE_LABELS[source]} CSMS
            </span>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Import Records</div>
          </div>
          {!uploading && (
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
          )}
        </div>

        <div style={{ background: C.seasalt, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <FileText size={16} strokeWidth={1.75} style={{display:"inline-flex",color:"#5B6B7A",flexShrink:0}}/>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div title={fileName} style={{
                fontSize: 13, fontWeight: 600, color: '#1a1a1a',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden', wordBreak: 'break-word', lineHeight: 1.35,
              }}>{fileName}</div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                {rows.length > 0
                  ? <span><strong style={{ color: C.green }}>{rows.length.toLocaleString()}</strong> records ready to import</span>
                  : <span style={{ color: '#C0321A' }}>No valid records found in file</span>}
              </div>
            </div>
          </div>
        </div>

        {dupeCount > 0 && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#C0321A' }}>
                {dupeCount.toLocaleString()} duplicate record{dupeCount !== 1 ? 's' : ''} skipped
              </div>
              <div style={{ fontSize: 12, color: '#C0321A', marginTop: 2 }}>
                These entries already exist in the table (matched by charger ID, connector, and start time) and will not be re-imported.
              </div>
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div style={{ background: '#FFF8E1', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#B07D00', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {warnings.length} Warning{warnings.length !== 1 ? 's' : ''}
            </div>
            {warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 12, color: '#7A5800' }}>{w}</div>
            ))}
          </div>
        )}

        {uploadError && (
          <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', color: '#C0321A', fontSize: 12, fontWeight: 600 }}>{uploadError}</div>
        )}

        {uploading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ background: '#EBEBEB', borderRadius: 99, height: 8, overflow: 'hidden' }}>
              <div style={{ background: C.green, height: '100%', width: `${pct}%`, transition: 'width 0.3s ease' }} />
            </div>
            <div style={{ fontSize: 12, color: C.slate, textAlign: 'center' }}>
              Uploading {progress.done.toLocaleString()} / {progress.total.toLocaleString()} records ({pct}%)
            </div>
          </div>
        )}

        {!uploading && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={onClose}
              style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleUpload} disabled={rows.length === 0}
              style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: rows.length > 0 ? C.green : '#ccc', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: rows.length > 0 ? 'pointer' : 'default' }}>
              Upload {rows.length.toLocaleString()} Records
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────

interface SummaryRow {
  total_count: number;
  goparkin_count: number;
  sp_count: number;
  total_energy: number;
  total_revenue: number;
  latest_goparkin_at: string | null;
  latest_sp_at:       string | null;
}

interface CarparkAggRow {
  carpark_name: string;
  has_goparkin: boolean;
  has_sp: boolean;
  record_count: number;
  total_kwh: number;
  total_revenue: number;
}

// ── Download Modal (filter + CSV export, available to view-only users) ───

function csvCell(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const DOWNLOAD_COLUMNS: { key: keyof ChargingRecord; label: string }[] = [
  { key: 'source',                      label: 'Source' },
  { key: 'carpark_code',                label: 'Carpark' },
  { key: 'charger_id',                  label: 'Charger' },
  { key: 'connector_id',                label: 'Connector' },
  { key: 'charge_type',                 label: 'Charge Type' },
  { key: 'vehicle_plate_number',        label: 'Vehicle Plate' },
  { key: 'start_date_time',             label: 'Start' },
  { key: 'end_date_time',               label: 'End' },
  { key: 'total_charging_time_minutes', label: 'Duration (min)' },
  { key: 'total_energy_supplied_kwh',   label: 'Energy (kWh)' },
  { key: 'transaction_amount',          label: 'Transaction Amount' },
  { key: 'payment_amount',              label: 'Payment Amount' },
  { key: 'payment_status',              label: 'Status' },
  { key: 'mode_of_payment',             label: 'Payment Mode' },
  { key: 'payment_date',                label: 'Payment Date' },
  { key: 'transaction_type',            label: 'Transaction Type' },
  { key: 'discount_rate',               label: 'Discount Rate (%)' },
];

interface DownloadModalProps {
  carparks: string[]; // distinct carpark names, pre-fetched
  onClose: () => void;
}

function DownloadModal({ carparks, onClose }: DownloadModalProps) {
  // Default range: last 30 days, ending today (SGT calendar).
  const today = new Date();
  const monthAgo = new Date();
  monthAgo.setDate(today.getDate() - 30);
  const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const [startDate, setStartDate] = useState(toISO(monthAgo));
  const [endDate,   setEndDate]   = useState(toISO(today));
  const [source,    setSource]    = useState<'all' | 'goparkin' | 'sp'>('all');
  const [carparkSearch, setCarparkSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(carparks));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const filteredCarparks = useMemo(() => {
    const q = carparkSearch.trim().toLowerCase();
    if (!q) return carparks;
    return carparks.filter((c) => c.toLowerCase().includes(q));
  }, [carparks, carparkSearch]);

  const allSelected = selected.size === carparks.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(carparks));
  };
  const toggleOne = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const handleDownload = async () => {
    setError(null);
    if (selected.size === 0) { setError('Pick at least one carpark.'); return; }
    if (!startDate || !endDate) { setError('Pick a start and end date.'); return; }
    if (startDate > endDate)   { setError('Start date must be before end date.'); return; }

    setBusy(true);
    setProgress({ done: 0, total: 0 });

    // Inclusive end of day → use the day AFTER endDate as the exclusive upper bound.
    const endExclusive = new Date(endDate);
    endExclusive.setDate(endExclusive.getDate() + 1);
    const endISO = toISO(endExclusive);

    // First, get the row count for progress (with the same filters).
    let countQ = supabase
      .from('crm_charging_records')
      .select('id', { count: 'exact', head: true })
      .gte('end_date_time', startDate)
      .lt('end_date_time',  endISO);
    if (source !== 'all') countQ = countQ.eq('source', source);
    if (!allSelected)     countQ = countQ.in('carpark_code', [...selected]);

    const { count, error: countErr } = await countQ;
    if (countErr) { setError(countErr.message); setBusy(false); return; }
    const total = count ?? 0;
    setProgress({ done: 0, total });

    if (total === 0) {
      setError('No records matched the filter.');
      setBusy(false);
      return;
    }

    // Page through results in 1000-row batches.
    const PAGE = 1000;
    const rows: ChargingRecord[] = [];
    let from = 0;
    while (from < total) {
      let q = supabase
        .from('crm_charging_records')
        .select('*')
        .gte('end_date_time', startDate)
        .lt('end_date_time',  endISO)
        .order('end_date_time', { ascending: false })
        .range(from, from + PAGE - 1);
      if (source !== 'all') q = q.eq('source', source);
      if (!allSelected)     q = q.in('carpark_code', [...selected]);

      const { data, error: dataErr } = await q;
      if (dataErr) { setError(dataErr.message); setBusy(false); return; }
      if (!data || data.length === 0) break;
      rows.push(...(data as ChargingRecord[]));
      from += PAGE;
      setProgress({ done: Math.min(from, total), total });
    }

    // Build CSV
    const header = DOWNLOAD_COLUMNS.map((c) => c.label).join(',');
    const body = rows.map((r) =>
      DOWNLOAD_COLUMNS.map((c) => csvCell(r[c.key] as string | number | null)).join(','),
    ).join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `charging_records_${startDate}_to_${endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setBusy(false);
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 560, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Download Charging Records</div>
          {!busy && (
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Source</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'goparkin', 'sp'] as const).map((s) => (
              <button key={s} onClick={() => setSource(s)}
                style={{ flex: 1, padding: '7px 12px', borderRadius: 99,
                  border: source === s ? 'none' : '1px solid #EBEBEB',
                  background: source === s ? C.green : C.white,
                  color: source === s ? C.white : C.slate,
                  fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {s === 'all' ? 'All Sources' : s === 'goparkin' ? 'GoParkin' : 'SP'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Carparks · {selected.size}/{carparks.length}
            </label>
            <button onClick={toggleAll}
              style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, border: '1px solid #EBEBEB', background: C.white, color: C.slate, cursor: 'pointer', fontFamily: 'Figtree' }}>
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <input value={carparkSearch} onChange={(e) => setCarparkSearch(e.target.value)} placeholder="Search carparks…"
              style={{ width: '100%', padding: '7px 12px 7px 30px', borderRadius: 8, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 12, outline: 'none', background: C.seasalt, boxSizing: 'border-box' }} />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 13 }}><Search size={14} /></span>
          </div>
          <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', border: '1px solid #EBEBEB', borderRadius: 10, background: C.white }}>
            {filteredCarparks.length === 0 && (
              <div style={{ padding: '12px 14px', fontSize: 12, color: C.slate, textAlign: 'center' }}>No carparks match.</div>
            )}
            {filteredCarparks.map((name) => {
              const checked = selected.has(name);
              return (
                <label key={name} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', cursor: 'pointer',
                  borderBottom: '1px solid #F3F3F3',
                  background: checked ? C.honeydew : 'transparent',
                }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleOne(name)}
                    style={{ width: 14, height: 14, accentColor: C.green, cursor: 'pointer' }} />
                  <span style={{ fontSize: 12, color: checked ? C.green : '#1a1a1a', fontWeight: checked ? 700 : 500 }}>{name}</span>
                </label>
              );
            })}
          </div>
        </div>

        {error && (
          <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>
        )}

        {busy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ background: '#EBEBEB', borderRadius: 99, height: 6, overflow: 'hidden' }}>
              <div style={{ background: C.green, height: '100%', width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`, transition: 'width .2s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: C.slate, textAlign: 'center' }}>
              {progress.total > 0
                ? `Fetched ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} records`
                : 'Counting matching records…'}
            </div>
          </div>
        )}

        {!busy && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 11, color: C.slate }}>
              {someSelected ? `${selected.size} of ${carparks.length} carparks selected.` : allSelected ? 'All carparks included.' : 'No carparks selected.'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose}
                style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleDownload}
                style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <DownloadIcon size={12} strokeWidth={2.25} style={{display:"inline",verticalAlign:"-2px",marginRight:4}}/> Download CSV
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Upload History Tab ────────────────────────────────────────────

interface UploadRow {
  id:          string;
  source:      'goparkin' | 'sp';
  file_label:  string;
  row_count:   number;
  uploaded_by: string | null;
  uploaded_at: string;
  department:  string | null;
  live_count?: number; // computed on the fly: how many of those rows are still in the table
}

function UploadHistoryTab({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchUploads = async () => {
    setLoading(true);
    const { data, error: e } = await supabase
      .from('crm_charging_record_uploads')
      .select('*')
      .order('uploaded_at', { ascending: false });
    if (e) { setError(e.message); setLoading(false); return; }
    const rows = (data as UploadRow[]) ?? [];

    // For each upload, get the current live row count (may be < row_count if records were partially deleted).
    const withCounts = await Promise.all(rows.map(async (r) => {
      const { count } = await supabase
        .from('crm_charging_records')
        .select('id', { count: 'exact', head: true })
        .eq('upload_id', r.id);
      return { ...r, live_count: count ?? 0 };
    }));
    setUploads(withCounts);
    setLoading(false);
  };

  useEffect(() => { fetchUploads(); }, []);

  const revert = async (uploadId: string) => {
    setReverting(uploadId);
    setError(null);
    // CASCADE on the FK means deleting the upload row deletes all its records.
    const { error: e } = await supabase
      .from('crm_charging_record_uploads')
      .delete()
      .eq('id', uploadId);
    if (e) { setError(e.message); setReverting(null); return; }
    await fetchUploads();
    await onRefresh();
    setReverting(null);
    setConfirmId(null);
  };

  const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Upload History</div>
        <div style={{ fontSize: 12, color: C.slate, marginTop: 3 }}>
          Every CSMS upload is recorded here. Click <strong>Revert</strong> to delete all records inserted by that upload — the operation cascades and cannot be undone.
        </div>
      </div>

      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{error}</div>
      )}

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              {['When', 'Source', 'File(s)', 'Records', 'By', ''].map((h) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && uploads.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading…</td></tr>
            ) : uploads.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                No tracked uploads yet. Future GoParkin / SP imports will appear here automatically.
              </td></tr>
            ) : (
              uploads.map((u) => {
                const sStyle = SOURCE_COLORS[u.source];
                const isConfirming = confirmId === u.id;
                const isReverting  = reverting === u.id;
                const live = u.live_count ?? 0;
                const partial = live > 0 && live < u.row_count;
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid #F3F3F3', background: isConfirming ? '#FFF8F8' : 'transparent' }}>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{fmtWhen(u.uploaded_at)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ background: sStyle.bg, color: sStyle.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>
                        {SOURCE_LABELS[u.source]}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#1a1a1a', maxWidth: 360 }}>
                      <div title={u.file_label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.file_label}</div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>
                      {live === 0 && u.row_count > 0
                        ? <span style={{ color: C.slate, fontWeight: 600 }}>Reverted</span>
                        : (
                          <>
                            {live.toLocaleString()}
                            {partial && <span style={{ color: C.slate, fontWeight: 500 }}> / {u.row_count.toLocaleString()}</span>}
                          </>
                        )}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: C.slate }}>{u.uploaded_by ?? '—'}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {live === 0
                        ? <span style={{ fontSize: 11, color: C.slate }}>—</span>
                        : isConfirming
                          ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#FDEAEA', borderRadius: 10, padding: '6px 10px' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#C0321A' }}>Delete {live.toLocaleString()} rows?</span>
                              <button onClick={() => setConfirmId(null)} disabled={isReverting}
                                style={{ padding: '3px 10px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                                Cancel
                              </button>
                              <button onClick={() => revert(u.id)} disabled={isReverting}
                                style={{ padding: '3px 10px', borderRadius: 8, border: 'none', background: '#C0321A', color: C.white, fontFamily: 'Figtree', fontSize: 11, fontWeight: 700, cursor: isReverting ? 'default' : 'pointer' }}>
                                {isReverting ? 'Reverting…' : 'Yes, revert'}
                              </button>
                            </div>
                          )
                          : (
                            <button onClick={() => setConfirmId(u.id)}
                              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #FDEAEA', background: '#FDEAEA', color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                              ↺ Revert
                            </button>
                          )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ScreenChargingRecords() {
  const { can, user } = usePermissions();
  const canEdit       = can('charging', 'can_edit');
  const canDelete     = can('charging', 'can_delete');
  const canSeeCarparks = can('charging_cpo_carparks', 'can_view');
  const canSeeSpPrice  = can('charging_sp_price',     'can_view');

  const [tab, setTab] = useState<'records' | 'sp_price' | 'carparks' | 'upload_history'>('records');
  const [records, setRecords] = useState<ChargingRecord[]>([]);
  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [carparkAgg, setCarparkAgg] = useState<CarparkAgg[]>([]);
  const [carparkPrices, setCarparkPrices] = useState<SpCarparkPrice[]>([]);
  const [managedCarparks, setManagedCarparks] = useState<ManagedCarpark[]>([]);
  const [cpoLocations, setCpoLocations] = useState<CpoLocationLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'goparkin' | 'sp'>('all');
  const [cpoOnly, setCpoOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [uploadModal, setUploadModal] = useState<{
    source: 'goparkin' | 'sp';
    fileName: string;
    rows: ChargingRow[];
    warnings: string[];
    dupeCount: number;
  } | null>(null);

  const [pendingSpUpload, setPendingSpUpload] = useState<{
    fileName: string;
    rows: ChargingRow[];
    warnings: string[];
    missingCarparks: string[];
  } | null>(null);

  const [downloadOpen, setDownloadOpen] = useState(false);

  const gpRef = useRef<HTMLInputElement>(null);
  const spRef = useRef<HTMLInputElement>(null);

  const fetchRecords = async () => {
    const { data } = await supabase
      .from('crm_charging_records')
      .select('*')
      .order('start_date_time', { ascending: false })
      .range(0, PREVIEW_LIMIT - 1);
    setRecords((data as ChargingRecord[]) ?? []);
    setLoading(false);
  };

  const fetchSummary = async () => {
    const { data, error } = await supabase.rpc('charging_records_summary');
    if (error || !data) { setSummary(null); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) { setSummary(null); return; }
    setSummary({
      total_count:    Number(row.total_count) || 0,
      goparkin_count: Number(row.goparkin_count) || 0,
      sp_count:       Number(row.sp_count) || 0,
      total_energy:   Number(row.total_energy) || 0,
      total_revenue:  Number(row.total_revenue) || 0,
      latest_goparkin_at: row.latest_goparkin_at ?? null,
      latest_sp_at:       row.latest_sp_at ?? null,
    });
  };

  const fetchCarparkAgg = async () => {
    const { data, error } = await supabase.rpc('charging_records_by_carpark');
    if (error || !data) { setCarparkAgg([]); return; }
    const rows = (data as CarparkAggRow[]).map((r) => {
      const sources = new Set<'goparkin' | 'sp'>();
      if (r.has_goparkin) sources.add('goparkin');
      if (r.has_sp)       sources.add('sp');
      return {
        carpark_name: r.carpark_name,
        sources,
        records: Number(r.record_count) || 0,
        kwh:     Number(r.total_kwh) || 0,
        revenue: Number(r.total_revenue) || 0,
      };
    });
    setCarparkAgg(rows);
  };

  const fetchCarparkPrices = async () => {
    const { data } = await supabase
      .from('sp_carpark_prices')
      .select('*')
      .order('carpark_code');
    setCarparkPrices((data as SpCarparkPrice[]) ?? []);
  };

  const fetchManagedCarparks = async () => {
    const { data } = await supabase.from('cpo_managed_carparks').select('*');
    setManagedCarparks((data as ManagedCarpark[]) ?? []);
  };

  const fetchCpoLocations = async () => {
    const { data } = await supabase.from('cpo_locations').select('id, name').order('name');
    setCpoLocations((data as CpoLocationLite[]) ?? []);
  };

  const refreshAll = async () => {
    await Promise.all([fetchRecords(), fetchSummary(), fetchCarparkAgg()]);
  };

  useEffect(() => {
    refreshAll();
    fetchCarparkPrices();
    fetchManagedCarparks();
    fetchCpoLocations();
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, source: 'goparkin' | 'sp') => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = '';

    if (source === 'sp') {
      // Bulk: parse every selected CSV, merge rows, accumulate warnings (prefixed with file name).
      const allRows: ChargingRow[] = [];
      const allWarnings: string[] = [];
      for (const f of files) {
        const text = await f.text();
        const { rows, warnings } = parseSpCSV(text);
        allRows.push(...rows);
        for (const w of warnings) allWarnings.push(`${f.name}: ${w}`);
      }
      const fileLabel = files.length === 1
        ? files[0].name
        : `${files.length} SP files (${files.map((f) => f.name).join(', ')})`;

      const uniqueCarparks = [...new Set(
        allRows.map((r) => r.carpark_code).filter((c): c is string => !!c)
      )];
      const knownCodes = new Set(carparkPrices.map((p) => p.carpark_code));
      const missing = uniqueCarparks.filter((c) => !knownCodes.has(c));

      if (missing.length > 0) {
        setPendingSpUpload({ fileName: fileLabel, rows: allRows, warnings: allWarnings, missingCarparks: missing });
        return;
      }

      const priced = applySpPrices(allRows, carparkPrices);
      const chargerIds = [...new Set(priced.map((r) => r.charger_id).filter((c): c is string => !!c))];
      const existingKeys = await fetchExistingKeys(chargerIds);
      const { clean, dupeCount } = filterDupes(priced, existingKeys);
      setUploadModal({ source: 'sp', fileName: fileLabel, rows: clean, warnings: allWarnings, dupeCount });
    } else {
      const file = files[0];
      const { rows, warnings } = await parseXLSXFile(file);
      const chargerIds = [...new Set(rows.map((r) => r.charger_id).filter((c): c is string => !!c))];
      const existingKeys = await fetchExistingKeys(chargerIds);
      const { clean, dupeCount } = filterDupes(rows, existingKeys);
      setUploadModal({ source, fileName: file.name, rows: clean, warnings, dupeCount });
    }
  };

  const handleNewPricesSave = async (priceMap: Record<string, number>) => {
    const inserts = Object.entries(priceMap).map(([carpark_code, price_per_kwh]) => ({ carpark_code, price_per_kwh }));
    await supabase.from('sp_carpark_prices').insert(inserts);

    const newEntries: SpCarparkPrice[] = inserts.map((i) => ({
      id: '',
      carpark_code: i.carpark_code,
      price_per_kwh: i.price_per_kwh,
      updated_at: new Date().toISOString(),
    }));
    const allPrices = [...carparkPrices, ...newEntries];
    setCarparkPrices(allPrices);

    if (pendingSpUpload) {
      const priced = applySpPrices(pendingSpUpload.rows, allPrices);
      const chargerIds = [...new Set(priced.map((r) => r.charger_id).filter((c): c is string => !!c))];
      const existingKeys = await fetchExistingKeys(chargerIds);
      const { clean, dupeCount } = filterDupes(priced, existingKeys);
      setUploadModal({
        source: 'sp',
        fileName: pendingSpUpload.fileName,
        rows: clean,
        warnings: pendingSpUpload.warnings,
        dupeCount,
      });
      setPendingSpUpload(null);
    }
  };

  const totalCount   = summary?.total_count    ?? records.length;
  const gpCount      = summary?.goparkin_count ?? records.filter((r) => r.source === 'goparkin').length;
  const spCount      = summary?.sp_count       ?? records.filter((r) => r.source === 'sp').length;
  const totalEnergy  = summary?.total_energy   ?? records.reduce((s, r) => s + Number(r.total_energy_supplied_kwh ?? 0), 0);
  const totalRevenue = summary?.total_revenue  ?? records.reduce((s, r) => s + Number(r.payment_amount ?? 0), 0);

  const managedSet = new Set(managedCarparks.map((m) => m.carpark_name));
  const visible = records.filter((r) => {
    const q = search.toLowerCase();
    const matchSource = sourceFilter === 'all' || r.source === sourceFilter;
    const matchCpo = !cpoOnly || (r.carpark_code !== null && managedSet.has(r.carpark_code));
    const matchSearch = !q
      || (r.vehicle_plate_number ?? '').toLowerCase().includes(q)
      || (r.charger_id ?? '').toLowerCase().includes(q)
      || (r.carpark_code ?? '').toLowerCase().includes(q);
    return matchSource && matchCpo && matchSearch;
  });

  const totalPages = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paged = visible.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const sourcePills: { id: 'all' | 'goparkin' | 'sp'; label: string }[] = [
    { id: 'all',      label: 'All Records' },
    { id: 'goparkin', label: 'GoParkin CSMS' },
    { id: 'sp',       label: 'SP CSMS' },
  ];

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: C.slate, fontSize: 13 }}>Loading…</div>;
  }

  const tabs: { id: 'records' | 'sp_price' | 'carparks' | 'upload_history'; label: string }[] = [
    { id: 'records',  label: 'Charging Records' },
    ...(canSeeCarparks ? [{ id: 'carparks' as const, label: '◉ CPO Carparks' }] : []),
    ...(canSeeSpPrice  ? [{ id: 'sp_price' as const, label: '⚡ SP Price'     }] : []),
    ...(canDelete      ? [{ id: 'upload_history' as const, label: '↺ Upload History' }] : []),
  ];

  // If the currently-selected tab is no longer visible, fall back to Records.
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'records';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Data freshness panel — two pills, one per CSMS source. */}
      {summary && (summary.latest_goparkin_at || summary.latest_sp_at) && (
        <div style={{ background: C.white, borderRadius: 12, padding: '12px 16px', border: '1px solid #EBEBEB',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Latest Records
          </span>
          <FreshnessPill source="goparkin" at={summary.latest_goparkin_at} />
          <FreshnessPill source="sp"       at={summary.latest_sp_at} />
          <span style={{ marginLeft: 'auto', fontSize: 11, color: C.slate, fontWeight: 500 }}>
            Upload fresh CSMS files to keep these up to date.
          </span>
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Total Records"  value={totalCount.toLocaleString()}     sub="charging transactions" accent />
        <KPICard label="Total Energy"   value={`${totalEnergy.toFixed(1)} kWh`} sub="energy supplied" />
        <KPICard label="Total Revenue"  value={`$${totalRevenue.toFixed(2)}`}   sub="payment collected" />
        <KPICard label="CSMS Sources"   value={`${gpCount.toLocaleString()} / ${spCount.toLocaleString()}`} sub="GoParkin / SP records" />
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #EBEBEB', paddingBottom: 0 }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '9px 20px', border: 'none', background: 'transparent',
              fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              color: activeTab === t.id ? C.green : C.slate,
              borderBottom: activeTab === t.id ? `2px solid ${C.green}` : '2px solid transparent',
              marginBottom: -2,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* SP Price tab */}
      {activeTab === 'sp_price' && (
        <SpPriceTab prices={carparkPrices} onRefresh={fetchCarparkPrices} />
      )}

      {/* CPO Carparks tab */}
      {activeTab === 'carparks' && (
        <CarparksTab
          agg={carparkAgg}
          managed={managedCarparks}
          locations={cpoLocations}
          onRefresh={fetchManagedCarparks}
        />
      )}

      {/* Upload History tab */}
      {activeTab === 'upload_history' && (
        <UploadHistoryTab onRefresh={refreshAll} />
      )}

      {/* Records tab */}
      {activeTab === 'records' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* Source filter pills */}
            <div style={{ display: 'flex', gap: 6 }}>
              {sourcePills.map((p) => (
                <button key={p.id} onClick={() => { setSourceFilter(p.id); setPage(1); }}
                  style={{ padding: '7px 16px', borderRadius: 99, border: sourceFilter === p.id ? 'none' : '1px solid #EBEBEB',
                    background: sourceFilter === p.id ? C.green : C.white, color: sourceFilter === p.id ? C.white : C.slate,
                    fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* CPO-only toggle */}
            <button onClick={() => { setCpoOnly((v) => !v); setPage(1); }}
              title={managedCarparks.length === 0 ? 'No carparks marked as CPO yet — go to the CPO Carparks tab to tag them.' : ''}
              style={{ padding: '7px 14px', borderRadius: 99,
                border: `1px solid ${cpoOnly ? C.green : '#EBEBEB'}`,
                background: cpoOnly ? C.honeydew : C.white,
                color: cpoOnly ? C.green : C.slate,
                fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {cpoOnly ? '✓ ' : ''}CPO Only <span style={{ opacity: 0.6, fontWeight: 600 }}>· {managedCarparks.length}</span>
            </button>

            {/* Search */}
            <div style={{ position: 'relative', width: 260 }}>
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search plate, charger, carpark…"
                style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white, boxSizing: 'border-box' }} />
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.slate, fontSize: 15 }}><Search size={14} /></span>
            </div>

            {/* Import + Refresh */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {canEdit && (
                <button onClick={() => gpRef.current?.click()}
                  style={{ padding: '9px 18px', borderRadius: 10, border: `1px solid ${SOURCE_COLORS.goparkin.color}`, background: SOURCE_COLORS.goparkin.bg,
                    color: SOURCE_COLORS.goparkin.color, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  ⬆ GoParkin (.xlsx)
                </button>
              )}
              {canEdit && (
                <button onClick={() => spRef.current?.click()}
                  title="Select one or more SP CSVs to upload in bulk"
                  style={{ padding: '9px 18px', borderRadius: 10, border: `1px solid ${SOURCE_COLORS.sp.color}`, background: SOURCE_COLORS.sp.bg,
                    color: SOURCE_COLORS.sp.color, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  ⬆ SP (.csv · bulk)
                </button>
              )}
              <button onClick={() => setDownloadOpen(true)}
                title="Download a filtered CSV (carpark + date range)"
                style={{ padding: '9px 18px', borderRadius: 10, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <DownloadIcon size={12} strokeWidth={2.25} style={{display:"inline",verticalAlign:"-2px",marginRight:4}}/> Download CSV
              </button>
            </div>

            {/* Hidden file inputs */}
            <input ref={gpRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={(e) => handleFileSelect(e, 'goparkin')} />
            <input ref={spRef} type="file" accept=".csv" multiple style={{ display: 'none' }}
              onChange={(e) => handleFileSelect(e, 'sp')} />
          </div>

          {summary && summary.total_count > records.length && (
            <div style={{ background: C.honeydew, color: C.green, borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 600 }}>
              Preview showing the most recent {records.length.toLocaleString()} of {summary.total_count.toLocaleString()} records. KPI totals above reflect the full table.
            </div>
          )}

          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1500 }}>
                <thead>
                  <tr style={{ background: C.seasalt }}>
                    {['#', 'Source', 'Carpark', 'Charger', 'Connector', 'Charge Type', 'Vehicle Plate', 'Start', 'End', 'Duration', 'Energy (kWh)', 'Txn Amt', 'Pay Amt', 'Status', 'Payment Mode', 'Pay Date', 'Txn Type', 'Discount'].map((h) => (
                      <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r, i) => {
                    const statusKey = (r.payment_status ?? '').toLowerCase();
                    const statusStyle = PAYMENT_STATUS_COLORS[statusKey] ?? { bg: '#F3F3F3', color: '#767B77' };
                    const srcStyle = SOURCE_COLORS[r.source];
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid #F3F3F3' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: C.slate }}>{(safePage - 1) * PER_PAGE + i + 1}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ background: srcStyle.bg, color: srcStyle.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>
                            {SOURCE_LABELS[r.source]}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 13, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{r.carpark_code ?? '—'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>{r.charger_id ?? '—'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: C.slate }}>{r.connector_id ?? '—'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: '#1a1a1a' }}>{r.charge_type ?? '—'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: C.green, fontFamily: 'monospace', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{r.vehicle_plate_number ?? '—'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{fmtDT(r.start_date_time)}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{fmtDT(r.end_date_time)}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: '#1a1a1a' }}>{r.total_charging_time_minutes != null ? `${r.total_charging_time_minutes} min` : '—'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: C.green }}>{r.total_energy_supplied_kwh != null ? Number(r.total_energy_supplied_kwh).toFixed(3) : '—'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{r.transaction_amount != null ? `$${Number(r.transaction_amount).toFixed(2)}` : '—'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: C.green }}>{r.payment_amount != null ? `$${Number(r.payment_amount).toFixed(2)}` : '—'}</td>
                        <td style={{ padding: '10px 14px' }}>
                          {r.payment_status
                            ? <span style={{ background: statusStyle.bg, color: statusStyle.color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>{r.payment_status}</span>
                            : <span style={{ color: C.slate, fontSize: 12 }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: '#1a1a1a' }}>{r.mode_of_payment ?? '—'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{fmtDate(r.payment_date)}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: '#1a1a1a' }}>{r.transaction_type ?? '—'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: r.discount_rate ? C.green : C.slate }}>
                          {r.discount_rate != null ? `${Number(r.discount_rate)}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr><td colSpan={18} style={{ padding: '60px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                      {records.length === 0 ? 'No charging records yet. Use the import buttons above to upload from GoParkin or SP.' : 'No records match your filter.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Paginator page={safePage} totalPages={totalPages} total={visible.length}
              from={visible.length ? (safePage - 1) * PER_PAGE + 1 : 0} to={Math.min(safePage * PER_PAGE, visible.length)}
              onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => Math.min(totalPages, p + 1))} />
          </div>
        </>
      )}

      {uploadModal && (
        <UploadModal
          source={uploadModal.source}
          fileName={uploadModal.fileName}
          rows={uploadModal.rows}
          warnings={uploadModal.warnings}
          dupeCount={uploadModal.dupeCount}
          uploaderEmail={user.email}
          uploaderDepartment={user.department}
          onConfirm={refreshAll}
          onClose={() => setUploadModal(null)}
        />
      )}

      {pendingSpUpload && (
        <NewCarparkPricesModal
          carparks={pendingSpUpload.missingCarparks}
          onSave={handleNewPricesSave}
          onClose={() => setPendingSpUpload(null)}
        />
      )}

      {downloadOpen && (
        <DownloadModal
          carparks={[...carparkAgg.map((c) => c.carpark_name)].sort((a, b) => a.localeCompare(b))}
          onClose={() => setDownloadOpen(false)}
        />
      )}
    </div>
  );
}
