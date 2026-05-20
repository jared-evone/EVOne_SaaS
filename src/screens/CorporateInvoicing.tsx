import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { PDFDownloadLink, Document, Page, View, Text, Image as PdfImage, pdf } from '@react-pdf/renderer';
import { C } from '../theme';
import { KPICard } from '../components/KPICard';
import evoneLogoUrl from '../assets/evone-logo.png';
import {
  pdfGreen, pdfHoneydew, pdfSlate, pdfBorderW,
  bRight, bBottom, bAll,
  fmtMonthLabel, fmtDateTime, fmtKwh, fmtAmt, fmtRate,
} from './portal/pdfShared';
import { CustomerPortal } from './portal/CustomerPortal';
import { upsertDocument, blobToBase64 } from './portal/portalDb';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../permissions';

// ── Types ─────────────────────────────────────────────────────────

export interface CRMCompany {
  id: string;
  name: string;
  base_rate: number;
  threshold_kwh: number;
  discounted_rate: number;
}

interface CRMVehicle {
  id: string;
  vehicle_plate: string;
  company_id: string | null;
}

interface CRMDriver {
  id: string;
  driver_email: string;
  company_id: string | null;
}

export interface GoParkinRow {
  plate: string;
  location: string;
  start: string;
  end: string;
  kwh: number;
}

export interface SpCorpRecord {
  driverEmail: string;
  location: string;
  startDateTime: string;
  endDateTime: string;
  energyKwh: number;
}

export interface CompanyStatement {
  company: CRMCompany;
  goparkinRows: GoParkinRow[];
  spRows: SpCorpRecord[];
  totalKwh: number;
  appliedRate: number;
  totalAmount: number;
}

// ── Helpers ───────────────────────────────────────────────────────

function prevMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonthStart(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1); // month is 0-indexed; m here is 1-indexed so this gives first of next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function csvCell(val: string | number): string {
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const content = rows.map((r) => r.map(csvCell).join(',')).join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Format a JS Date (from XLSX cellDates) as wall-clock "YYYY-MM-DD HH:MM:SS".
// XLSX stores naïve datetimes (no timezone) — read via getUTC* to avoid TZ shift.
function fmtExcelDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

// Normalise an SP corporate cell to "YYYY-MM-DD HH:MM:SS".
// Accepts: a JS Date (from XLSX cellDates), DD/MM/YYYY (with optional :SS, AM/PM,
// 2-digit year), ISO `YYYY-MM-DD[T ]HH:MM[:SS]`, or an Excel date serial number.
function parseSpCorpDate(raw: unknown): string {
  if (raw == null || raw === '') return '';

  if (raw instanceof Date && !isNaN(raw.getTime())) return fmtExcelDate(raw);

  // Excel serial number (days since 1899-12-30, with fractional time-of-day)
  if (typeof raw === 'number' && isFinite(raw)) {
    const ms = Math.round((raw - 25569) * 86400 * 1000); // 25569 = 1970-01-01
    return fmtExcelDate(new Date(ms));
  }

  const s = String(raw).trim();
  if (!s) return '';

  // DD/MM/YYYY HH:MM[:SS] [AM|PM] — also tolerates D/M/YY single-digits
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m1) {
    const [, dd, mm, yRaw, hRaw, min, sec, ampm] = m1;
    let hh = parseInt(hRaw, 10);
    if (ampm) {
      const up = ampm.toUpperCase();
      if (up === 'PM' && hh < 12) hh += 12;
      if (up === 'AM' && hh === 12) hh = 0;
    }
    const yyyy = yRaw.length === 2 ? 2000 + parseInt(yRaw, 10) : parseInt(yRaw, 10);
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')} ${String(hh).padStart(2, '0')}:${min}:${(sec ?? '00').padStart(2, '0')}`;
  }

  // ISO: YYYY-MM-DD[T ]HH:MM[:SS]
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m2) {
    const [, y, mo, d, h, min, sec] = m2;
    return `${y}-${mo}-${d} ${h}:${min}:${sec ?? '00'}`;
  }

  return '';
}

// Find a column header in `row` by trimmed, case-insensitive match against any candidate
function findKey(row: Record<string, unknown>, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const target = c.trim().toLowerCase();
    const hit = keys.find((k) => k.trim().toLowerCase() === target);
    if (hit) return hit;
  }
  return undefined;
}

export function buildStatement(
  company: CRMCompany,
  goparkinRows: GoParkinRow[],
  spRows: SpCorpRecord[],
): CompanyStatement {
  const gpKwh = goparkinRows.reduce((s, r) => s + r.kwh, 0);
  const spKwh = spRows.reduce((s, r) => s + r.energyKwh, 0);
  const totalKwh = Math.round((gpKwh + spKwh) * 100) / 100;
  const appliedRate =
    totalKwh >= Number(company.threshold_kwh)
      ? Number(company.discounted_rate)
      : Number(company.base_rate);
  const totalAmount = Math.round(totalKwh * appliedRate * 100) / 100;
  return { company, goparkinRows, spRows, totalKwh, appliedRate, totalAmount };
}

// ── FieldLabel ────────────────────────────────────────────────────

function FieldLabel({ children }: { children: string }) {
  return (
    <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
      {children}
    </label>
  );
}

// ── In-app Statement View ─────────────────────────────────────────

interface StatementViewProps {
  stmt: CompanyStatement;
  billingMonth: string;
  onClose: () => void;
}

export function StatementView({ stmt, billingMonth, onClose }: StatementViewProps) {
  const { company, goparkinRows, spRows, totalKwh, appliedRate, totalAmount } = stmt;

  // Group by identifier
  const gpByPlate = goparkinRows.reduce<Record<string, GoParkinRow[]>>((acc, r) => {
    (acc[r.plate] = acc[r.plate] ?? []).push(r);
    return acc;
  }, {});
  const spByEmail = spRows.reduce<Record<string, SpCorpRecord[]>>((acc, r) => {
    (acc[r.driverEmail] = acc[r.driverEmail] ?? []).push(r);
    return acc;
  }, {});

  const breakdown: { id: string; kwh: number }[] = [
    ...Object.entries(gpByPlate).map(([id, rows]) => ({ id, kwh: Math.round(rows.reduce((s, r) => s + r.kwh, 0) * 100) / 100 })),
    ...Object.entries(spByEmail).map(([id, rows]) => ({ id, kwh: Math.round(rows.reduce((s, r) => s + r.energyKwh, 0) * 100) / 100 })),
  ].sort((a, b) => b.kwh - a.kwh);

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate,
    letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB',
    background: C.seasalt,
  };
  const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #F3F3F3' };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 24px' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 36, width: '100%', maxWidth: 860, boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 28 }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.green, letterSpacing: '-0.02em', marginBottom: 4 }}>
              Corporate Charging Statement
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13, color: '#1a1a1a' }}>
              <span><strong>Company:</strong> {company.name}</span>
              <span><strong>Billing Month:</strong> {fmtMonthLabel(billingMonth)}</span>
              <span><strong>Threshold Limit:</strong> {Number(company.threshold_kwh).toLocaleString()} kWh</span>
              <span><strong>Base Rate:</strong> {fmtRate(company.base_rate)}/kWh</span>
              <span><strong>Discounted Rate:</strong> {fmtRate(company.discounted_rate)}/kWh</span>
              <span><strong>Applied Rate:</strong> <span style={{ color: C.green, fontWeight: 700 }}>{fmtRate(appliedRate)}/kWh</span></span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <PDFDownloadLink
              document={<CorporateStatementPDF stmt={stmt} billingMonth={billingMonth} />}
              fileName={`${company.name}_${billingMonth}.pdf`}
              style={{ textDecoration: 'none' }}>
              {({ loading }) => (
                <button style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {loading ? 'Preparing…' : '⬇ Download PDF'}
                </button>
              )}
            </PDFDownloadLink>
            <button onClick={onClose}
              style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 20, fontFamily: 'Figtree' }}>×</button>
          </div>
        </div>

        {/* Section 1: Billing Summary */}
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.green, marginBottom: 12 }}>1. Billing Summary</div>
          <div style={{ borderRadius: 12, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Total Energy (kWh)', 'Threshold Limit', 'Applied Rate', 'Total Amount'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ ...tdStyle, fontWeight: 700, color: C.green }}>{fmtKwh(totalKwh)}</td>
                  <td style={tdStyle}>{Number(company.threshold_kwh).toLocaleString()} kWh</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{fmtRate(appliedRate)}/kWh</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: C.green }}>{fmtAmt(totalAmount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 2: Vehicle Breakdown */}
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.green, marginBottom: 12 }}>2. Vehicle Breakdown</div>
          <div style={{ borderRadius: 12, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Vehicle / Driver Email', 'Energy Used (kWh)'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {breakdown.map((b) => (
                  <tr key={b.id}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{b.id}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: C.green }}>{fmtKwh(b.kwh)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 3: Detailed Charging Log */}
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.green, marginBottom: 12 }}>3. Detailed Charging Log</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {breakdown.map((b) => {
              const gpRows = gpByPlate[b.id] ?? [];
              const spRowsGroup = spByEmail[b.id] ?? [];
              const rows: { location: string; start: string; end: string; kwh: number }[] = [
                ...gpRows.map((r) => ({ location: r.location, start: fmtDateTime(r.start), end: fmtDateTime(r.end), kwh: r.kwh })),
                ...spRowsGroup.map((r) => ({ location: r.location, start: fmtDateTime(r.startDateTime), end: fmtDateTime(r.endDateTime), kwh: r.energyKwh })),
              ].sort((a, z) => a.start.localeCompare(z.start));
              const subtotal = Math.round(rows.reduce((s, r) => s + r.kwh, 0) * 100) / 100;
              return (
                <div key={b.id}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>
                    Vehicle / Driver Email: <span style={{ color: C.green }}>{b.id}</span>
                  </div>
                  <div style={{ borderRadius: 12, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: '30%' }} />
                        <col style={{ width: '25%' }} />
                        <col style={{ width: '25%' }} />
                        <col style={{ width: '20%' }} />
                      </colgroup>
                      <thead>
                        <tr>
                          {['Location', 'Start Time', 'End Time', 'Energy (kWh)'].map((h) => (
                            <th key={h} style={thStyle}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i}>
                            <td style={tdStyle}>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.location}>{r.location}</div>
                            </td>
                            <td style={{ ...tdStyle, color: C.slate, fontFamily: 'monospace', fontSize: 12 }}>{r.start}</td>
                            <td style={{ ...tdStyle, color: C.slate, fontFamily: 'monospace', fontSize: 12 }}>{r.end}</td>
                            <td style={{ ...tdStyle, fontWeight: 700 }}>{fmtKwh(r.kwh)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: C.seasalt }}>
                          <td colSpan={3} style={{ ...tdStyle, fontWeight: 700, textAlign: 'right', borderBottom: 'none' }}>Total:</td>
                          <td style={{ ...tdStyle, fontWeight: 700, color: C.green, borderBottom: 'none' }}>{fmtKwh(subtotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PDF Document ──────────────────────────────────────────────────
// react-pdf style rules:
//   - all sizes are unitless numbers (pt)
//   - NO gap — use marginRight on siblings
//   - border shorthands with 'pt' units are ignored — use explicit borderWidth/Color/Style
//   - padding shorthand strings are ignored — use paddingVertical/paddingHorizontal
//   - textTransform not supported — uppercase strings manually
//   - overflow:hidden not supported — omit it
// Style tokens + helpers live in ./portal/pdfShared.ts

interface PDFProps { stmt: CompanyStatement; billingMonth: string; }

export function CorporateStatementPDF({ stmt, billingMonth }: PDFProps) {
  const { company, goparkinRows, spRows, totalKwh, appliedRate, totalAmount } = stmt;

  const gpByPlate = goparkinRows.reduce<Record<string, GoParkinRow[]>>((acc, r) => {
    (acc[r.plate] = acc[r.plate] ?? []).push(r);
    return acc;
  }, {});
  const spByEmail = spRows.reduce<Record<string, SpCorpRecord[]>>((acc, r) => {
    (acc[r.driverEmail] = acc[r.driverEmail] ?? []).push(r);
    return acc;
  }, {});

  const breakdown: { id: string; kwh: number }[] = [
    ...Object.entries(gpByPlate).map(([id, rows]) => ({ id, kwh: Math.round(rows.reduce((s, r) => s + r.kwh, 0) * 100) / 100 })),
    ...Object.entries(spByEmail).map(([id, rows]) => ({ id, kwh: Math.round(rows.reduce((s, r) => s + r.energyKwh, 0) * 100) / 100 })),
  ].sort((a, b) => b.kwh - a.kwh);

  // Table cell — flex: 1 unless an explicit width percentage is given
  const cell = (
    content: string,
    opts?: { bold?: boolean; green?: boolean; color?: string; w?: string; small?: boolean; last?: boolean; center?: boolean; truncate?: boolean },
  ) => (
    <View style={{ flex: opts?.w ? undefined : 1, width: opts?.w ?? undefined, paddingVertical: 6, paddingHorizontal: 8, ...(opts?.last ? {} : bRight) }}>
      <Text
        style={{ fontSize: opts?.small ? 8 : 10, fontWeight: opts?.bold ? 'bold' : 'normal', color: opts?.color ?? (opts?.green ? pdfGreen : '#1a1a1a'), textAlign: opts?.center ? 'center' : 'left', textOverflow: opts?.truncate ? 'ellipsis' : undefined }}
        {...(opts?.truncate ? { wrap: false } : {})}
      >
        {content}
      </Text>
    </View>
  );

  // Header cell with honeydew background
  const hCell = (content: string, opts?: { w?: string; last?: boolean; center?: boolean }) => (
    <View style={{ flex: opts?.w ? undefined : 1, width: opts?.w ?? undefined, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: pdfHoneydew, ...(opts?.last ? {} : bRight) }}>
      <Text style={{ fontSize: 8, fontWeight: 'bold', color: pdfSlate, textAlign: opts?.center ? 'center' : 'left' }}>{content.toUpperCase()}</Text>
    </View>
  );

  // Detail table uses fixed column widths (% of 515pt page)
  //   Location 30% | Start 25% | End 25% | Energy 20% — wider date cols so 19-char
  //   timestamps fit at the same 10pt body font size used elsewhere.
  const DW = { loc: '30%', dt: '25%', en: '20%' };

  return (
    <Document>
      <Page size="A4" style={{ fontFamily: 'Helvetica', padding: 40, backgroundColor: '#FFFFFF' }}>

        {/* ── Header ── */}
        <View style={{ marginBottom: 18, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: pdfGreen, borderBottomStyle: 'solid' }}>
          <PdfImage src={evoneLogoUrl} style={{ height: 44, width: 180, marginBottom: 14 }} />
          <Text style={{ fontSize: 20, fontWeight: 'bold', color: pdfGreen, marginBottom: 12 }}>Corporate Charging Statement</Text>
          {/* Two-column meta block — NO gap, use marginRight on left column */}
          <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1, marginRight: 32 }}>
              {([
                ['Company', company.name],
                ['Billing Month', fmtMonthLabel(billingMonth)],
                ['Threshold Limit', `${Number(company.threshold_kwh).toLocaleString()} kWh`],
              ] as [string, string][]).map(([k, v]) => (
                <View key={k} style={{ flexDirection: 'row', marginBottom: 4 }}>
                  <Text style={{ fontSize: 10, fontWeight: 'bold', width: 110 }}>{k}:</Text>
                  <Text style={{ fontSize: 10, flex: 1 }}>{v}</Text>
                </View>
              ))}
            </View>
            <View style={{ flex: 1 }}>
              {([
                ['Base Rate', `${fmtRate(company.base_rate)}/kWh`, false],
                ['Discounted Rate', `${fmtRate(company.discounted_rate)}/kWh`, false],
                ['Applied Rate', `${fmtRate(appliedRate)}/kWh`, true],
              ] as [string, string, boolean][]).map(([k, v, accent]) => (
                <View key={k} style={{ flexDirection: 'row', marginBottom: 4 }}>
                  <Text style={{ fontSize: 10, fontWeight: 'bold', width: 110 }}>{k}:</Text>
                  <Text style={{ fontSize: 10, flex: 1, color: accent ? pdfGreen : '#1a1a1a', fontWeight: accent ? 'bold' : 'normal' }}>{v}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── Section 1: Billing Summary ── */}
        <Text style={{ fontSize: 13, fontWeight: 'bold', color: pdfGreen, marginBottom: 6 }}>1. Billing Summary</Text>
        <View style={{ ...bAll, borderRadius: 4, marginBottom: 18 }}>
          <View style={{ flexDirection: 'row', ...bBottom }}>
            {hCell('Total Energy (kWh)')}
            {hCell('Threshold Limit')}
            {hCell('Applied Rate')}
            {hCell('Total Amount', { last: true })}
          </View>
          <View style={{ flexDirection: 'row' }}>
            {cell(fmtKwh(totalKwh), { bold: true, green: true })}
            {cell(`${Number(company.threshold_kwh).toLocaleString()} kWh`)}
            {cell(`${fmtRate(appliedRate)}/kWh`, { bold: true })}
            {cell(fmtAmt(totalAmount), { bold: true, green: true, last: true })}
          </View>
        </View>

        {/* ── Section 2: Vehicle Breakdown ── */}
        <Text style={{ fontSize: 13, fontWeight: 'bold', color: pdfGreen, marginBottom: 6 }}>2. Vehicle Breakdown</Text>
        <View style={{ ...bAll, borderRadius: 4, marginBottom: 18 }}>
          <View style={{ flexDirection: 'row', ...bBottom }}>
            {hCell('Vehicle / Driver Email')}
            {hCell('Energy Used (kWh)', { last: true })}
          </View>
          {breakdown.map((b, i) => (
            <View key={b.id} style={{ flexDirection: 'row', ...(i < breakdown.length - 1 ? bBottom : {}) }}>
              {cell(b.id, { bold: true })}
              {cell(fmtKwh(b.kwh), { green: true, bold: true, last: true })}
            </View>
          ))}
        </View>

        {/* ── Section 3: Detailed Charging Log ── */}
        <Text style={{ fontSize: 13, fontWeight: 'bold', color: pdfGreen, marginBottom: 6 }}>3. Detailed Charging Log</Text>
        {breakdown.map((b) => {
          const gpRows = gpByPlate[b.id] ?? [];
          const spRowsGroup = spByEmail[b.id] ?? [];
          const rows = [
            ...gpRows.map((r) => ({ location: r.location, start: fmtDateTime(r.start), end: fmtDateTime(r.end), kwh: r.kwh })),
            ...spRowsGroup.map((r) => ({ location: r.location, start: fmtDateTime(r.startDateTime), end: fmtDateTime(r.endDateTime), kwh: r.energyKwh })),
          ].sort((a, z) => a.start.localeCompare(z.start));
          const subtotal = Math.round(rows.reduce((s, r) => s + r.kwh, 0) * 100) / 100;

          // Every row carries its own full 4-side border so the table frame is always
          // complete on every page. marginTop: -1 collapses the adjacent borders
          // between consecutive rows back to a single 1pt line.
          const ROW = { flexDirection: 'row', ...bAll } as const;
          const ROW_NEXT = { ...ROW, marginTop: -pdfBorderW } as const;

          const dataRow = (r: { location: string; start: string; end: string; kwh: number }, style: React.ComponentProps<typeof View>['style']) => (
            <View style={style}>
              {cell(r.location, { w: DW.loc, truncate: true })}
              {cell(r.start, { color: pdfSlate, w: DW.dt, center: true })}
              {cell(r.end, { color: pdfSlate, w: DW.dt, center: true })}
              {cell(fmtKwh(r.kwh), { bold: true, last: true })}
            </View>
          );

          return (
            <View key={b.id} style={{ marginBottom: 14 }}>
              {/* Label + header row + first data row — stay together on same page */}
              <View wrap={false}>
                <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                  <Text style={{ fontSize: 10, fontWeight: 'bold' }}>Vehicle / Driver Email: </Text>
                  <Text style={{ fontSize: 10, color: pdfGreen, fontWeight: 'bold' }}>{b.id}</Text>
                </View>
                {/* Header row: full border, all 4 sides */}
                <View style={{ flexDirection: 'row', ...bAll }}>
                  {hCell('Location', { w: DW.loc })}
                  {hCell('Start Time', { w: DW.dt, center: true })}
                  {hCell('End Time', { w: DW.dt, center: true })}
                  {hCell('Energy (kWh)', { last: true })}
                </View>
                {/* First data row: marginTop:-1 collapses header's bottom + this row's top → 1pt */}
                {rows[0] && dataRow(rows[0], ROW_NEXT)}
              </View>

              {/* Remaining rows — each wrap={false} so no row is ever split mid-row.
                  Full border on every row ensures correct frame on every page. */}
              {rows.slice(1).map((r, i) => (
                <View key={i} wrap={false} style={ROW_NEXT}>
                  {cell(r.location, { w: DW.loc, truncate: true })}
                  {cell(r.start, { color: pdfSlate, w: DW.dt, center: true })}
                  {cell(r.end, { color: pdfSlate, w: DW.dt, center: true })}
                  {cell(fmtKwh(r.kwh), { bold: true, last: true })}
                </View>
              ))}

              {/* Subtotal row */}
              <View wrap={false} style={{ ...ROW_NEXT, backgroundColor: pdfHoneydew }}>
                <View style={{ flex: 1, paddingVertical: 6, paddingHorizontal: 8, ...bRight }}>
                  <Text style={{ fontSize: 10, fontWeight: 'bold', textAlign: 'right' }}>Total:</Text>
                </View>
                <View style={{ width: DW.en, paddingVertical: 6, paddingHorizontal: 8 }}>
                  <Text style={{ fontSize: 10, fontWeight: 'bold', color: pdfGreen }}>{fmtKwh(subtotal)}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </Page>
    </Document>
  );
}

// ── Root Screen ───────────────────────────────────────────────────

type ScreenTab = 'generate' | 'portal';

export function ScreenCorporateInvoicing() {
  const { can } = usePermissions();
  const canEdit = can('corporateinvoicing', 'can_edit');

  const [tab, setTab] = useState<ScreenTab>('generate');
  const [billingMonth, setBillingMonth] = useState(prevMonth);
  const [companies, setCompanies] = useState<CRMCompany[]>([]);
  const [vehicles, setVehicles] = useState<CRMVehicle[]>([]);
  const [spDrivers, setSpDrivers] = useState<CRMDriver[]>([]);
  const [goparkinRecords, setGoparkinRecords] = useState<GoParkinRow[]>([]);
  const [spCorpRecords, setSpCorpRecords] = useState<SpCorpRecord[]>([]);
  const [managedCarparks, setManagedCarparks] = useState<string[]>([]);
  const [cpoOnly, setCpoOnly] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatement, setSelectedStatement] = useState<CompanyStatement | null>(null);
  const [publishing, setPublishing] = useState<{ done: number; total: number } | null>(null);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null); // company id currently downloading/publishing
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      const [{ data: co }, { data: ve }, { data: dr }, { data: cp }] = await Promise.all([
        supabase.from('crm_companies').select('*').order('name'),
        supabase.from('crm_vehicles').select('id, vehicle_plate, company_id'),
        supabase.from('crm_sp_drivers').select('id, driver_email, company_id'),
        supabase.from('cpo_managed_carparks').select('carpark_name'),
      ]);
      setCompanies((co as CRMCompany[]) ?? []);
      setVehicles((ve as CRMVehicle[]) ?? []);
      setSpDrivers((dr as CRMDriver[]) ?? []);
      setManagedCarparks(((cp as { carpark_name: string }[]) ?? []).map((r) => r.carpark_name));
    };
    load();
  }, []);

  const pullGoParkin = async () => {
    setPulling(true);
    setError(null);
    const start = `${billingMonth}-01`;
    const end = nextMonthStart(billingMonth);
    const PAGE = 1000;
    const all: GoParkinRow[] = [];
    let from = 0;
    while (true) {
      let q = supabase
        .from('crm_charging_records')
        .select('vehicle_plate_number, carpark_code, start_date_time, end_date_time, total_energy_supplied_kwh')
        .eq('source', 'goparkin')
        .eq('transaction_type', 'Corporate')
        .eq('payment_status', 'Success')
        .gte('end_date_time', start)
        .lt('end_date_time', end);
      if (cpoOnly && managedCarparks.length > 0) {
        q = q.in('carpark_code', managedCarparks);
      }
      const { data, error: err } = await q.range(from, from + PAGE - 1);
      if (err) { setError(err.message); break; }
      if (!data || data.length === 0) break;
      for (const r of data) {
        all.push({
          plate: r.vehicle_plate_number ?? '(unknown)',
          location: r.carpark_code ?? '(unknown)',
          start: r.start_date_time ?? '',
          end: r.end_date_time ?? '',
          kwh: Number(r.total_energy_supplied_kwh ?? 0),
        });
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
    setGoparkinRecords(all);
    setPulling(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      // cellDates: true → dates come through as JS Date objects (avoids relying on
      // the workbook's display format string).
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
      const SHEET = 'EVOne Corporate fleet';
      const sheet = wb.Sheets[SHEET];
      if (!sheet) {
        setError(`Sheet "${SHEET}" not found. Available sheets: ${wb.SheetNames.join(', ')}`);
        return;
      }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
      if (rows.length === 0) {
        setError(`Sheet "${SHEET}" is empty.`);
        return;
      }

      // Resolve column headers once, tolerant of whitespace and case differences
      const sample = rows[0];
      const kDate   = findKey(sample, ['Date', 'Charging Date', 'Start Date']);
      const kLoc    = findKey(sample, ['Location Name', 'Location']);
      const kEnergy = findKey(sample, ['CDR Total Energy', 'Total Energy', 'Energy (kWh)', 'Energy']);
      const kEmail  = findKey(sample, ['Driver Email', 'Email', 'Account Email']);

      const missing: string[] = [];
      if (!kDate)   missing.push('Date');
      if (!kEnergy) missing.push('CDR Total Energy');
      if (!kEmail)  missing.push('Driver Email');
      if (missing.length > 0) {
        setError(`Could not find required columns: ${missing.join(', ')}. Headers in sheet: ${Object.keys(sample).join(', ')}`);
        return;
      }

      const parsed: SpCorpRecord[] = [];
      let skippedNoEmail = 0;
      let skippedNoEnergy = 0;
      let skippedBadDate = 0;

      for (const r of rows) {
        const email = String(r[kEmail!] ?? '').toLowerCase().trim();
        const energyRaw = r[kEnergy!];
        // parseFloat('') is NaN — empty cells get skipped; 0 kWh sessions are kept.
        const energy = typeof energyRaw === 'number'
          ? energyRaw
          : parseFloat(String(energyRaw ?? '').replace(/,/g, ''));
        const dt = parseSpCorpDate(r[kDate!]);

        if (!email)         { skippedNoEmail++; continue; }
        if (isNaN(energy))  { skippedNoEnergy++; continue; }
        if (!dt)            { skippedBadDate++; continue; }

        parsed.push({
          driverEmail: email,
          location: kLoc ? String(r[kLoc] ?? '').trim() : '',
          startDateTime: dt,
          endDateTime: dt, // SP corporate sheet only carries a single timestamp per session
          energyKwh: energy,
        });
      }

      setSpCorpRecords(parsed);

      const skippedTotal = skippedNoEmail + skippedNoEnergy + skippedBadDate;
      if (parsed.length === 0) {
        const sampleDateVal = rows[0][kDate!];
        setError(`No usable rows in "${SHEET}". Skipped: ${skippedNoEmail} no email, ${skippedNoEnergy} empty energy cell, ${skippedBadDate} unparseable date. Sample Date cell: ${JSON.stringify(sampleDateVal)}`);
      } else if (skippedTotal > 0) {
        setError(`Imported ${parsed.length} rows; skipped ${skippedTotal} (${skippedNoEmail} no email, ${skippedNoEnergy} empty energy cell, ${skippedBadDate} unparseable date).`);
      }
    } catch (err) {
      setError(`Failed to read XLSX: ${(err as Error).message ?? 'unknown error'}`);
    }
  };

  const publishAll = async (toPublish: CompanyStatement[]) => {
    setError(null);
    setPublishResult(null);
    setPublishing({ done: 0, total: toPublish.length });
    try {
      for (let i = 0; i < toPublish.length; i++) {
        const stmt = toPublish[i];
        const stmtBlob = await pdf(<CorporateStatementPDF stmt={stmt} billingMonth={billingMonth} />).toBlob();
        const stmtB64 = await blobToBase64(stmtBlob);

        await upsertDocument({
          company_id: stmt.company.id,
          billing_month: billingMonth,
          doc_type: 'statement',
          invoice_number: null,
          statement_data: stmt,
          pdf_base64: stmtB64,
          total_kwh: stmt.totalKwh,
          total_amount: stmt.totalAmount,
          applied_rate: stmt.appliedRate,
          issued_by: 'admin',
        });

        setPublishing({ done: i + 1, total: toPublish.length });
      }
      setPublishResult(`Published ${toPublish.length} statement${toPublish.length !== 1 ? 's' : ''} for ${fmtMonthLabel(billingMonth)}. Upload the matching invoices from your accounting software in the Master View.`);
    } catch (e) {
      setError(`Publish failed: ${(e as Error).message ?? 'unknown error'}`);
    } finally {
      setPublishing(null);
    }
  };

  const downloadStatementPdf = async (stmt: CompanyStatement) => {
    setRowBusyId(stmt.company.id);
    try {
      const blob = await pdf(<CorporateStatementPDF stmt={stmt} billingMonth={billingMonth} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${stmt.company.name}_${billingMonth}_statement.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Download failed: ${(e as Error).message ?? 'unknown error'}`);
    } finally {
      setRowBusyId(null);
    }
  };

  const publishOne = async (stmt: CompanyStatement) => {
    setError(null);
    setPublishResult(null);
    setRowBusyId(stmt.company.id);
    try {
      const blob = await pdf(<CorporateStatementPDF stmt={stmt} billingMonth={billingMonth} />).toBlob();
      const b64 = await blobToBase64(blob);
      await upsertDocument({
        company_id: stmt.company.id,
        billing_month: billingMonth,
        doc_type: 'statement',
        invoice_number: null,
        statement_data: stmt,
        pdf_base64: b64,
        total_kwh: stmt.totalKwh,
        total_amount: stmt.totalAmount,
        applied_rate: stmt.appliedRate,
        issued_by: 'admin',
      });
      setPublishResult(`Published statement for ${stmt.company.name} (${fmtMonthLabel(billingMonth)}).`);
    } catch (e) {
      setError(`Publish failed: ${(e as Error).message ?? 'unknown error'}`);
    } finally {
      setRowBusyId(null);
    }
  };

  // Build statements from both sources
  const plateToCompany = new Map(vehicles.map((v) => [v.vehicle_plate, v.company_id]));
  const emailToCompany = new Map(spDrivers.map((d) => [d.driver_email.toLowerCase(), d.company_id]));

  const companyGp: Record<string, GoParkinRow[]> = {};
  const unmatchedGpRows: GoParkinRow[] = [];
  for (const r of goparkinRecords) {
    const cid = plateToCompany.get(r.plate);
    if (cid) { (companyGp[cid] = companyGp[cid] ?? []).push(r); }
    else { unmatchedGpRows.push(r); }
  }

  const companySp: Record<string, SpCorpRecord[]> = {};
  const unmatchedSpRows: SpCorpRecord[] = [];
  for (const r of spCorpRecords) {
    const cid = emailToCompany.get(r.driverEmail);
    if (cid) { (companySp[cid] = companySp[cid] ?? []).push(r); }
    else { unmatchedSpRows.push(r); }
  }
  const unmatchedGp = unmatchedGpRows.length;
  const unmatchedSp = unmatchedSpRows.length;

  const statements: CompanyStatement[] = companies
    .map((c) => buildStatement(c, companyGp[c.id] ?? [], companySp[c.id] ?? []))
    .filter((s) => s.totalKwh > 0)
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const totalBillingKwh = statements.reduce((s, st) => s + st.totalKwh, 0);
  const totalBillingAmt = statements.reduce((s, st) => s + st.totalAmount, 0);
  const unmatchedTotal = unmatchedGp + unmatchedSp;

  const hasData = goparkinRecords.length > 0 || spCorpRecords.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top-level tab strip — Generate vs Customer Portal (dev nesting) */}
      <div style={{ display: 'flex', gap: 4, background: C.white, borderRadius: 12, padding: 4, border: '1px solid #EBEBEB', alignSelf: 'flex-start' }}>
        {([
          ['generate', 'Generate'],
          ['portal',   'Customer Portal'],
        ] as [ScreenTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: '8px 22px', borderRadius: 10, border: 'none', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: tab === id ? C.green : 'transparent', color: tab === id ? C.white : C.slate }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'portal' && <CustomerPortal />}

      {tab === 'generate' && <>
      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {/* Top bar */}
      <div style={{ background: C.white, borderRadius: 16, padding: '16px 20px', border: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <FieldLabel>Billing Month</FieldLabel>
          <input
            type="month"
            value={billingMonth}
            onChange={(e) => setBillingMonth(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', cursor: 'pointer' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flex: 1, flexWrap: 'wrap' }}>
          {canEdit && (
            <button
              onClick={pullGoParkin}
              disabled={pulling}
              style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: pulling ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: pulling ? 'default' : 'pointer' }}>
              {pulling ? 'Pulling…' : '⬇ Pull GoParkin Data'}
            </button>
          )}
          <label title={managedCarparks.length === 0 ? 'No carparks marked CPO yet — go to Charging Records → CPO Carparks to tag them.' : ''}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10,
              border: `1px solid ${cpoOnly ? C.green : '#EBEBEB'}`,
              background: cpoOnly ? C.honeydew : C.white,
              color: cpoOnly ? C.green : C.slate,
              fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={cpoOnly} onChange={(e) => setCpoOnly(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: C.green, cursor: 'pointer' }} />
            CPO carparks only <span style={{ opacity: 0.6, fontWeight: 600 }}>· {managedCarparks.length}</span>
          </label>
          {canEdit && (
            <button
              onClick={() => fileRef.current?.click()}
              style={{ padding: '9px 20px', borderRadius: 10, border: `1px solid ${C.green}`, background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              ⬆ Upload SP Corporate (.xlsx)
            </button>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileSelect} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {goparkinRecords.length > 0 && (
              <span style={{ background: C.honeydew, color: C.green, fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99, letterSpacing: '0.04em' }}>
                GoParkin: {goparkinRecords.length.toLocaleString()} records
              </span>
            )}
            {spCorpRecords.length > 0 && (
              <span style={{ background: '#E3F0FF', color: '#1A62C0', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99, letterSpacing: '0.04em' }}>
                SP Corp: {spCorpRecords.length.toLocaleString()} records
              </span>
            )}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Companies with Data" value={String(statements.length)} sub={`of ${companies.length} in CRM`} accent />
        <KPICard label="Total Energy" value={`${fmtKwh(totalBillingKwh)} kWh`} sub="across all companies" />
        <KPICard label="Total Billing Amount" value={fmtAmt(totalBillingAmt)} sub="combined invoices" />
        <KPICard label="Unmatched Records" value={String(unmatchedTotal)} sub="not linked to any company" />
      </div>

      {/* Unmatched records audit banner */}
      {unmatchedTotal > 0 && (
        <div style={{ background: '#FFF8E1', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', border: '1px solid #F5E6B0' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#B07D00', marginBottom: 2 }}>
              {unmatchedTotal.toLocaleString()} record{unmatchedTotal !== 1 ? 's' : ''} not linked to any company
            </div>
            <div style={{ fontSize: 12, color: '#B07D00' }}>
              Download the audit CSV to see which plates / driver emails are missing from the CRM.
            </div>
          </div>
          <button
            onClick={() => {
              const sumGp = new Map<string, { sessions: number; kwh: number; first: string; last: string }>();
              for (const r of unmatchedGpRows) {
                const cur = sumGp.get(r.plate) ?? { sessions: 0, kwh: 0, first: r.start, last: r.start };
                cur.sessions += 1;
                cur.kwh += r.kwh;
                if (r.start && r.start < cur.first) cur.first = r.start;
                if (r.start && r.start > cur.last) cur.last = r.start;
                sumGp.set(r.plate, cur);
              }
              const sumSp = new Map<string, { sessions: number; kwh: number; first: string; last: string }>();
              for (const r of unmatchedSpRows) {
                const cur = sumSp.get(r.driverEmail) ?? { sessions: 0, kwh: 0, first: r.startDateTime, last: r.startDateTime };
                cur.sessions += 1;
                cur.kwh += r.energyKwh;
                if (r.startDateTime && r.startDateTime < cur.first) cur.first = r.startDateTime;
                if (r.startDateTime && r.startDateTime > cur.last) cur.last = r.startDateTime;
                sumSp.set(r.driverEmail, cur);
              }
              const rows: (string | number)[][] = [
                ['Source', 'Identifier', 'Sessions', 'Total Energy (kWh)', 'First Seen', 'Last Seen'],
              ];
              [...sumGp.entries()]
                .sort((a, b) => b[1].kwh - a[1].kwh)
                .forEach(([plate, s]) => rows.push(['goparkin', plate, s.sessions, s.kwh.toFixed(2), fmtDateTime(s.first), fmtDateTime(s.last)]));
              [...sumSp.entries()]
                .sort((a, b) => b[1].kwh - a[1].kwh)
                .forEach(([email, s]) => rows.push(['sp', email, s.sessions, s.kwh.toFixed(2), fmtDateTime(s.first), fmtDateTime(s.last)]));
              downloadCSV(`unmatched_records_${billingMonth}.csv`, rows);
            }}
            style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #B07D00', background: C.white, color: '#B07D00', fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            ⬇ Download Audit CSV
          </button>
        </div>
      )}

      {/* Empty state */}
      {!hasData && (
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '60px 24px', textAlign: 'center', color: C.slate }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: '#1a1a1a' }}>No data loaded</div>
          <div style={{ fontSize: 13 }}>Pull GoParkin data and/or upload an SP Corporate xlsx to generate statements.</div>
        </div>
      )}

      {/* Publish progress / result banners */}
      {publishing && (
        <div style={{ background: C.honeydew, color: C.green, borderRadius: 12, padding: '12px 18px', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>Publishing {publishing.done} / {publishing.total}…</span>
          <div style={{ flex: 1, height: 6, background: C.white, borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ width: `${(publishing.done / Math.max(publishing.total, 1)) * 100}%`, height: '100%', background: C.green, transition: 'width 0.2s' }} />
          </div>
        </div>
      )}
      {publishResult && !publishing && (
        <div style={{ background: C.honeydew, color: C.green, borderRadius: 12, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, fontWeight: 600 }}>
          <span style={{ flex: 1 }}>✓ {publishResult}</span>
          <button onClick={() => { setTab('portal'); setPublishResult(null); }}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid ' + C.green, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            View in Master →
          </button>
          <button onClick={() => setPublishResult(null)}
            style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: C.green, fontFamily: 'Figtree', fontSize: 14, cursor: 'pointer' }}>×</button>
        </div>
      )}

      {/* Company table */}
      {hasData && (
        <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
          {statements.length > 0 && (
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F3F3F3', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>Ready to publish for {fmtMonthLabel(billingMonth)}</div>
                <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                  {statements.length} statement{statements.length !== 1 ? 's' : ''} will be saved to the customer portals. Invoices are uploaded separately in the Master View.
                </div>
              </div>
              <button
                onClick={() => {
                  const header = [
                    'Company',
                    'Threshold (kWh)',
                    'Base Rate (SGD/kWh)',
                    'Discounted Rate (SGD/kWh)',
                    'GoParkin kWh',
                    'SP kWh',
                    'Total kWh',
                    'Applied Rate (SGD/kWh)',
                    'Rate Tier',
                    'Total Amount (SGD)',
                  ];
                  const rows: (string | number)[][] = [header];
                  for (const stmt of statements) {
                    const gpKwh = Math.round(stmt.goparkinRows.reduce((s, r) => s + r.kwh, 0) * 100) / 100;
                    const spKwh = Math.round(stmt.spRows.reduce((s, r) => s + r.energyKwh, 0) * 100) / 100;
                    const tier = stmt.totalKwh >= Number(stmt.company.threshold_kwh) ? 'Discounted' : 'Base';
                    rows.push([
                      stmt.company.name,
                      Number(stmt.company.threshold_kwh),
                      Number(stmt.company.base_rate).toFixed(4),
                      Number(stmt.company.discounted_rate).toFixed(4),
                      gpKwh.toFixed(2),
                      spKwh.toFixed(2),
                      stmt.totalKwh.toFixed(2),
                      Number(stmt.appliedRate).toFixed(4),
                      tier,
                      stmt.totalAmount.toFixed(2),
                    ]);
                  }
                  rows.push([
                    'TOTAL',
                    '', '', '',
                    statements.reduce((s, st) => s + st.goparkinRows.reduce((a, r) => a + r.kwh, 0), 0).toFixed(2),
                    statements.reduce((s, st) => s + st.spRows.reduce((a, r) => a + r.energyKwh, 0), 0).toFixed(2),
                    totalBillingKwh.toFixed(2),
                    '', '',
                    totalBillingAmt.toFixed(2),
                  ]);
                  downloadCSV(`corporate_invoicing_master_${billingMonth}.csv`, rows);
                }}
                style={{ padding: '9px 18px', borderRadius: 10, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ⬇ Download Master CSV
              </button>
              {canEdit && (
                <button onClick={() => publishAll(statements)} disabled={!!publishing}
                  style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: publishing ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: publishing ? 'default' : 'pointer' }}>
                  {publishing ? 'Publishing…' : `↑ Publish All (${statements.length})`}
                </button>
              )}
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: C.seasalt }}>
                  {['Company', 'GoParkin kWh', 'SP kWh', 'Total kWh', 'Applied Rate', 'Total Amount', ''].map((h) => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statements.map((stmt) => {
                  const gpKwh = stmt.goparkinRows.reduce((s, r) => s + r.kwh, 0);
                  const spKwh = stmt.spRows.reduce((s, r) => s + r.energyKwh, 0);
                  const aboveThreshold = stmt.totalKwh >= Number(stmt.company.threshold_kwh);
                  return (
                    <tr key={stmt.company.id}
                      style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#FAFAFA'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      onClick={() => setSelectedStatement(stmt)}>
                      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{stmt.company.name}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: gpKwh > 0 ? '#1a1a1a' : C.slate }}>{gpKwh > 0 ? fmtKwh(gpKwh) : '—'}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: spKwh > 0 ? '#1a1a1a' : C.slate }}>{spKwh > 0 ? fmtKwh(spKwh) : '—'}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green }}>{fmtKwh(stmt.totalKwh)}</td>
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        <span style={{ background: aboveThreshold ? C.honeydew : '#FFF8E1', color: aboveThreshold ? C.green : '#B07D00', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>
                          {fmtRate(stmt.appliedRate)}{aboveThreshold ? ' (disc.)' : ' (base)'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.green }}>{fmtAmt(stmt.totalAmount)}</td>
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const busy = rowBusyId === stmt.company.id;
                          return (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => setSelectedStatement(stmt)}
                                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                View
                              </button>
                              <button
                                onClick={() => downloadStatementPdf(stmt)}
                                disabled={busy}
                                style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                                ⬇ PDF
                              </button>
                              {canEdit && (
                                <button
                                  onClick={() => publishOne(stmt)}
                                  disabled={busy}
                                  style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: busy ? '#ccc' : C.green, color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
                                  {busy ? '…' : '↑ Publish'}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
                {statements.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No companies matched the loaded records.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedStatement && (
        <StatementView
          stmt={selectedStatement}
          billingMonth={billingMonth}
          onClose={() => setSelectedStatement(null)}
        />
      )}
      </>}
    </div>
  );
}
