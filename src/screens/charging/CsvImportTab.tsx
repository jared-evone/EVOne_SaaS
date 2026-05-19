import { useMemo, useRef, useState } from 'react';
import { C } from '../../theme';
import { supabase } from '../../lib/supabase';

const BATCH_SIZE = 500;
const PER_PAGE = 25;

// Exact column order in the GoParkin CSV — also the DB column order.
const DB_COLUMNS = [
  'carpark_code',
  'charger_id',
  'connector_id',
  'charge_type',
  'vehicle_plate_number',
  'start_date_time',
  'end_date_time',
  'total_charging_time_minutes',
  'total_energy_supplied_kwh',
  'transaction_amount',
  'payment_amount',
  'payment_status',
  'mode_of_payment',
  'payment_date',
  'transaction_type',
  'discount_rate',
] as const;
type DbColumn = (typeof DB_COLUMNS)[number];

const NUMERIC_COLUMNS: DbColumn[] = [
  'total_charging_time_minutes',
  'total_energy_supplied_kwh',
  'transaction_amount',
  'payment_amount',
  'discount_rate',
];

const TIMESTAMP_COLUMNS: DbColumn[] = ['start_date_time', 'end_date_time'];
const DATE_COLUMNS: DbColumn[] = ['payment_date'];

interface ParsedRow {
  rowNum: number;
  raw: Record<string, string>;
  mapped: Record<DbColumn, string | number | null>;
  issues: string[];
}

interface ParseResult {
  headers: string[];
  matchedCols: DbColumn[];
  missingCols: DbColumn[];
  extraCols: string[];
  rows: ParsedRow[];
}

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

function cleanCell(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  if (!t || t === 'null' || t === 'NULL') return null;
  return t;
}

function parseCSV(text: string): ParseResult {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length === 0) {
    return { headers: [], matchedCols: [], missingCols: [...DB_COLUMNS], extraCols: [], rows: [] };
  }

  const headers = splitCSVLine(lines[0]).map((h) => h.trim());
  const colIdx: Partial<Record<DbColumn, number>> = {};
  for (const col of DB_COLUMNS) {
    const i = headers.indexOf(col);
    if (i >= 0) colIdx[col] = i;
  }

  const matchedCols = (Object.keys(colIdx) as DbColumn[]);
  const missingCols = DB_COLUMNS.filter((c) => !(c in colIdx));
  const extraCols = headers.filter((h) => !(DB_COLUMNS as readonly string[]).includes(h) && h !== 'id');

  const rows: ParsedRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitCSVLine(lines[li]);
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => { raw[h] = cols[i] ?? ''; });

    const mapped: Record<DbColumn, string | number | null> = {} as Record<DbColumn, string | number | null>;
    const issues: string[] = [];

    for (const col of DB_COLUMNS) {
      const idx = colIdx[col];
      const cell = idx !== undefined ? cleanCell(cols[idx]) : null;

      if (cell === null) { mapped[col] = null; continue; }

      if (NUMERIC_COLUMNS.includes(col)) {
        const n = Number(cell);
        if (isNaN(n)) { issues.push(`${col}: "${cell}" is not numeric`); mapped[col] = null; }
        else mapped[col] = n;
      } else if (TIMESTAMP_COLUMNS.includes(col)) {
        // Accept "YYYY-MM-DD HH:mm:ss" — Supabase stores as UTC.
        const d = new Date(cell.replace(' ', 'T'));
        if (isNaN(d.getTime())) { issues.push(`${col}: "${cell}" is not a valid timestamp`); mapped[col] = null; }
        else mapped[col] = cell;
      } else if (DATE_COLUMNS.includes(col)) {
        // payment_date in CSV is a full timestamp — Postgres `date` will truncate.
        // We pass the date portion only to avoid TZ ambiguity.
        const datePart = cell.split(' ')[0].split('T')[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) { issues.push(`${col}: cannot parse date from "${cell}"`); mapped[col] = null; }
        else mapped[col] = datePart;
      } else {
        mapped[col] = cell;
      }
    }

    // Required-ish: charger_id + start_date_time drive dupe detection downstream.
    if (!mapped.charger_id) issues.push('charger_id is empty (dupe detection will skip this row)');
    if (!mapped.start_date_time) issues.push('start_date_time is empty (dupe detection will skip this row)');

    rows.push({ rowNum: li, raw, mapped, issues });
  }

  return { headers, matchedCols, missingCols, extraCols, rows };
}

function makeDupeKey(charger_id: string | null, connector_id: string | null, start_date_time: string | null): string | null {
  if (!charger_id || !start_date_time) return null;
  const s = start_date_time.trim().replace(' ', 'T');
  const hasOffset = /[Zz]|[+\-]\d{2}:\d{2}$/.test(s);
  const t = new Date(hasOffset ? s : s + 'Z').getTime();
  if (isNaN(t)) return null;
  return `${charger_id}|${connector_id ?? ''}|${t}`;
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
      for (const r of data as Array<{ charger_id: string | null; connector_id: string | null; start_date_time: string | null }>) {
        const k = makeDupeKey(r.charger_id, r.connector_id, r.start_date_time);
        if (k) keys.add(k);
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  return keys;
}

interface CsvImportTabProps {
  onUploaded: () => Promise<void> | void;
}

export function CsvImportTab({ onUploaded }: CsvImportTabProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);

  const [dupeKeys, setDupeKeys] = useState<Set<string> | null>(null);
  const [checkingDupes, setCheckingDupes] = useState(false);

  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'issues' | 'dupes' | 'clean'>('all');

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setFileName(file.name);
    setParsing(true);
    setParsed(null);
    setDupeKeys(null);
    setResult(null);
    setPage(1);

    const text = await file.text();
    const r = parseCSV(text);
    setParsed(r);
    setParsing(false);

    setCheckingDupes(true);
    const chargerIds = [...new Set(r.rows.map((row) => row.mapped.charger_id).filter((v): v is string => typeof v === 'string'))];
    const existing = await fetchExistingKeys(chargerIds);
    setDupeKeys(existing);
    setCheckingDupes(false);
  };

  const rowsWithFlags = useMemo(() => {
    if (!parsed || !dupeKeys) return [];
    return parsed.rows.map((r) => {
      const k = makeDupeKey(
        r.mapped.charger_id as string | null,
        r.mapped.connector_id as string | null,
        r.mapped.start_date_time as string | null,
      );
      const isDupe = k !== null && dupeKeys.has(k);
      return { ...r, isDupe };
    });
  }, [parsed, dupeKeys]);

  const stats = useMemo(() => {
    if (!parsed) return null;
    const total = rowsWithFlags.length;
    const dupes = rowsWithFlags.filter((r) => r.isDupe).length;
    const issues = rowsWithFlags.filter((r) => r.issues.length > 0).length;
    const ready = rowsWithFlags.filter((r) => !r.isDupe).length;
    return { total, dupes, issues, ready };
  }, [parsed, rowsWithFlags]);

  const visibleRows = useMemo(() => {
    return rowsWithFlags.filter((r) => {
      if (filter === 'issues') return r.issues.length > 0;
      if (filter === 'dupes') return r.isDupe;
      if (filter === 'clean') return !r.isDupe && r.issues.length === 0;
      return true;
    });
  }, [rowsWithFlags, filter]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = visibleRows.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const handleUpload = async () => {
    if (!parsed || !dupeKeys) return;
    const toInsert = rowsWithFlags.filter((r) => !r.isDupe).map((r) => ({ ...r.mapped, source: 'goparkin' as const }));

    setUploading(true);
    setProgress({ done: 0, total: toInsert.length });
    let done = 0;
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from('crm_charging_records').insert(batch);
      if (error) { console.error('Insert error:', error); break; }
      done += batch.length;
      setProgress({ done, total: toInsert.length });
    }
    setUploading(false);
    setResult({ inserted: done, skipped: stats?.dupes ?? 0 });
    await onUploaded();
  };

  const reset = () => {
    setFileName(null);
    setParsed(null);
    setDupeKeys(null);
    setResult(null);
    setPage(1);
    setFilter('all');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>GoParkin CSV Import (Preview)</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 3, maxWidth: 720 }}>
            Temporary tab. Upload a CSV exported from Supabase with the exact <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>crm_charging_records</code> schema. Headers are matched by name; CSV <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>id</code> is dropped (DB regenerates UUIDs). Rows are tagged <code style={{ background: C.seasalt, padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>source = 'goparkin'</code>.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={() => fileRef.current?.click()}
            style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            ⬆ Choose CSV
          </button>
          {parsed && (
            <button onClick={reset}
              style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Reset
            </button>
          )}
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
        </div>
      </div>

      {parsing && (
        <div style={{ background: C.white, borderRadius: 16, padding: '32px 24px', border: '1px solid #EBEBEB', textAlign: 'center', fontSize: 13, color: C.slate }}>
          Parsing {fileName}…
        </div>
      )}

      {parsed && (
        <>
          {/* Header mapping summary */}
          <div style={{ background: C.white, borderRadius: 14, padding: '16px 20px', border: '1px solid #EBEBEB', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>📄</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{fileName}</div>
                  <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>
                    <strong style={{ color: C.green }}>{parsed.matchedCols.length}</strong> of {DB_COLUMNS.length} DB columns matched · {parsed.rows.length.toLocaleString()} rows
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {DB_COLUMNS.map((col) => {
                const matched = parsed.matchedCols.includes(col);
                return (
                  <span key={col} title={matched ? 'Matched' : 'Missing in CSV'} style={{
                    fontSize: 11, fontWeight: 700,
                    padding: '4px 10px', borderRadius: 6,
                    background: matched ? '#E4F3E3' : '#FDEAEA',
                    color: matched ? '#1B512D' : '#C0321A',
                  }}>
                    {matched ? '✓' : '✗'} {col}
                  </span>
                );
              })}
            </div>

            {parsed.extraCols.length > 0 && (
              <div style={{ fontSize: 11, color: C.slate }}>
                <strong>Extra columns ignored:</strong> {parsed.extraCols.join(', ')}
              </div>
            )}
          </div>

          {/* Stats row */}
          {stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <StatTile label="Total Rows" value={stats.total.toLocaleString()} />
              <StatTile label="Ready to Insert" value={stats.ready.toLocaleString()} accent />
              <StatTile label="Duplicates Skipped" value={stats.dupes.toLocaleString()} sub="already in DB" />
              <StatTile label="Rows w/ Warnings" value={stats.issues.toLocaleString()} sub="hover STATUS pill to see details" />
            </div>
          )}

          {/* Filter pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {([
              { id: 'all',    label: `All (${stats?.total ?? 0})` },
              { id: 'clean',  label: `Clean (${rowsWithFlags.filter((r) => !r.isDupe && r.issues.length === 0).length})` },
              { id: 'dupes',  label: `Duplicates (${stats?.dupes ?? 0})` },
              { id: 'issues', label: `Issues (${stats?.issues ?? 0})` },
            ] as const).map((p) => (
              <button key={p.id} onClick={() => { setFilter(p.id); setPage(1); }}
                style={{ padding: '6px 14px', borderRadius: 99,
                  border: filter === p.id ? 'none' : '1px solid #EBEBEB',
                  background: filter === p.id ? C.green : C.white,
                  color: filter === p.id ? C.white : C.slate,
                  fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {p.label}
              </button>
            ))}
            {checkingDupes && <span style={{ marginLeft: 'auto', fontSize: 12, color: C.slate }}>Checking duplicates…</span>}
          </div>

          {/* Preview table */}
          <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1900 }}>
                <thead>
                  <tr style={{ background: C.seasalt }}>
                    {['#', 'Status', ...DB_COLUMNS].map((h) => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h.replace(/_/g, ' ')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((r) => {
                    const tone = r.isDupe
                      ? { bg: '#FFF8E1', color: '#B07D00', label: 'DUPE' }
                      : r.issues.length > 0
                        ? { bg: '#FFF0E0', color: '#B45309', label: 'ISSUE' }
                        : { bg: '#E4F3E3', color: '#1B512D', label: 'READY' };
                    return (
                      <tr key={r.rowNum} style={{ borderBottom: '1px solid #F3F3F3', background: r.isDupe ? 'rgba(255,248,225,0.35)' : 'transparent' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = r.isDupe ? 'rgba(255,248,225,0.35)' : 'transparent'; }}>
                        <td style={{ padding: '8px 12px', fontSize: 11, color: C.slate, whiteSpace: 'nowrap' }}>{r.rowNum}</td>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                          <span title={r.issues.join(' • ')} style={{ background: tone.bg, color: tone.color, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99 }}>
                            {tone.label}
                          </span>
                        </td>
                        {DB_COLUMNS.map((col) => {
                          const v = r.mapped[col];
                          const isNull = v === null || v === undefined || v === '';
                          return (
                            <td key={col} style={{ padding: '8px 12px', fontSize: 11, color: isNull ? '#bbb' : '#1a1a1a', whiteSpace: 'nowrap', fontFamily: NUMERIC_COLUMNS.includes(col) ? 'monospace' : 'Figtree' }}>
                              {isNull ? '—' : String(v)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={DB_COLUMNS.length + 2} style={{ padding: '48px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>
                      No rows match this filter.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 16px', borderTop: '1px solid #F3F3F3', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, color: C.slate }}>
                {visibleRows.length === 0 ? 'No results' : `Showing ${(safePage - 1) * PER_PAGE + 1}–${Math.min(safePage * PER_PAGE, visibleRows.length)} of ${visibleRows.length}`}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
                  style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: safePage === 1 ? C.seasalt : C.white, color: safePage === 1 ? '#ccc' : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: safePage === 1 ? 'default' : 'pointer' }}>
                  ← Prev
                </button>
                <span style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>Page {safePage} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                  style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: safePage >= totalPages ? C.seasalt : C.white, color: safePage >= totalPages ? '#ccc' : C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: safePage >= totalPages ? 'default' : 'pointer' }}>
                  Next →
                </button>
              </div>
            </div>
          </div>

          {/* Upload bar */}
          {!result && (
            <div style={{ background: C.honeydew, borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ fontSize: 12, color: '#1a1a1a' }}>
                {uploading
                  ? <span>Uploading <strong>{progress.done.toLocaleString()}</strong> / {progress.total.toLocaleString()}…</span>
                  : <span>
                      Ready to insert <strong style={{ color: C.green }}>{(rowsWithFlags.filter((r) => !r.isDupe).length).toLocaleString()}</strong> record(s) with source <code style={{ background: C.white, padding: '1px 6px', borderRadius: 4 }}>goparkin</code>.
                      {stats && stats.dupes > 0 && <> {stats.dupes.toLocaleString()} duplicate(s) will be skipped.</>}
                    </span>}
              </div>
              <button onClick={handleUpload} disabled={uploading || checkingDupes || rowsWithFlags.filter((r) => !r.isDupe).length === 0}
                style={{ padding: '10px 24px', borderRadius: 10, border: 'none',
                  background: uploading || checkingDupes || rowsWithFlags.filter((r) => !r.isDupe).length === 0 ? '#ccc' : C.green,
                  color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700,
                  cursor: uploading || checkingDupes || rowsWithFlags.filter((r) => !r.isDupe).length === 0 ? 'default' : 'pointer', flexShrink: 0 }}>
                {uploading ? `Uploading… ${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` : 'Confirm & Upload'}
              </button>
            </div>
          )}

          {result && (
            <div style={{ background: '#E4F3E3', borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>✓</span>
              <div style={{ fontSize: 13, color: '#1B512D', fontWeight: 600 }}>
                Inserted {result.inserted.toLocaleString()} record(s){result.skipped > 0 && <>; {result.skipped.toLocaleString()} duplicate(s) skipped</>}.
              </div>
            </div>
          )}
        </>
      )}

      {!parsed && !parsing && (
        <div style={{ background: C.white, borderRadius: 16, padding: '48px 24px', border: '1px dashed #EBEBEB', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 32 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>No CSV uploaded yet</div>
          <div style={{ fontSize: 12, color: C.slate, maxWidth: 480 }}>
            Click <strong>Choose CSV</strong> above to load a file. The expected headers are:<br />
            <code style={{ display: 'inline-block', marginTop: 6, fontSize: 11, color: C.green }}>{DB_COLUMNS.join(', ')}</code>
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? C.green : C.white,
      borderRadius: 14, padding: '14px 18px',
      border: accent ? 'none' : '1px solid #EBEBEB',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent ? 'rgba(255,255,255,0.85)' : C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ? C.white : C.green, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: accent ? 'rgba(255,255,255,0.75)' : C.slate }}>{sub}</div>}
    </div>
  );
}
