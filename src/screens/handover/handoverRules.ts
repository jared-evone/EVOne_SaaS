// Project Handover (Sales → Project Manager): the rules the form applies and the
// checklist it builds from the options Sales picks. Pure functions — the screen
// and the PDF both read from here so they can never disagree.
//
// The state shape (keys and values) matches the original shared register, so
// handovers exported from it can be loaded as they are.

export type Brand = 'Hiconics' | 'Hici' | 'NEG' | 'Sinexcel' | 'Other';
export const BRANDS: Brand[] = ['Hiconics', 'Hici', 'NEG', 'Sinexcel', 'Other'];

export const KW_TABLE: { kw: string; amps: number }[] = [
  { kw: '7', amps: 32 }, { kw: '22', amps: 32 }, { kw: '30', amps: 50 }, { kw: '60', amps: 100 },
  { kw: '80', amps: 120 }, { kw: '120', amps: 200 }, { kw: '180', amps: 300 }, { kw: '240', amps: 400 },
];
/** Sinexcel offers 60 / 80 / 120 kW only; 80 kW exists only for Sinexcel. */
export const kwOptionsFor = (brand: Brand): string[] =>
  (brand === 'Sinexcel' ? ['60', '80', '120'] : KW_TABLE.map((k) => k.kw).filter((k) => k !== '80'));
export const ampsOf = (kw: string) => KW_TABLE.find((k) => k.kw === kw)?.amps ?? 0;
export const isDc = (kw: string) => Number(kw) >= 30;

export interface HandoverCharger {
  brand: Brand; kw: string; qty: number; other: string;
  variant: 'Standard' | 'Premium'; stand: boolean; site: '1' | '2' | '3' | '4';
}
export interface HandoverContact { name: string; phone: string }
export type PendingOwner = 'Contractor' | 'EVOne' | 'Customer' | 'Landlord';
export interface PendingItem { item: string; solution: string; owner: PendingOwner; due: string; closed: boolean }
export const FILE_KINDS = ['Quotation', 'EHVCG quotation', 'Cable routing', 'Signed completion form', 'Commissioning photos', 'Other'] as const;
export type FileKind = typeof FILE_KINDS[number];
export interface HandoverFile { path: string; name: string; kind: FileKind; at: string; by: string }
export interface SignOff { by: string; at: string }

export type FlagKey = 'msb' | 'plinth' | 'bollard' | 'paint' | 'excavation' | 'traffic' | 'cctv' | 'lightbox' | 'extraLight'
  | 'shutdown' | 'cpPlinth' | 'cpCable' | 'cpIsolator' | 'cpTrench' | 'niBlew';
export type LandlordDoc = 'RA' | 'MOS' | 'SWP' | 'PTW';
export const LANDLORD_DOCS: { key: LandlordDoc; label: string }[] = [
  { key: 'RA', label: 'Risk Assessment (RA)' }, { key: 'MOS', label: 'Method of Statement (MOS)' },
  { key: 'SWP', label: 'Safe Work Procedure (SWP)' }, { key: 'PTW', label: 'Permit to Work (PTW)' },
];
export const PLATFORMS = ['GoParkin', 'SP', "Charger's Own", 'SpectraMoon'];

export interface HandoverInfo {
  project: string; site: string; site2: string; site3: string; site4: string;
  quote: string; hdate: string; sales: string; pm: string;
  /** The Sales Pipeline quotation number `quote` last agreed with ('' = never compared). */
  quoteSynced: string;
  ddate: string; logistics: string; statusNotes: string;
  contractor: string; contractorPrice: string; contractorQuote: string; cable: string; cableLen: string;
  msbFrom: string; msbTo: string; bollards: string; lots: string; paintColour: string;
  platformName: string; platformNotes: string; blewPhone: string; otherDocs: string; notes: string;
  cpOther: string; niOther: string;
}
export interface HandoverState {
  info: HandoverInfo;
  contacts: HandoverContact[];
  chargers: HandoverCharger[];
  ownership: 'customer' | 'cpo';
  scope: 'full' | 'half' | 'install';
  halfProt: 'mccb' | 'db';
  floor: 'concrete' | 'grass' | 'asphalt';
  chargerStatus: 'Ordered' | 'In transit' | 'In warehouse';
  platform: 'no' | 'yes' | 'maybe';
  blewPayer: 'EVOne' | 'Customer';
  ltaPayer: 'EVOne' | 'Customer';
  ltaAccess: 'open' | 'restricted';
  c: Partial<Record<FlagKey, boolean>>;
  d: Partial<Record<LandlordDoc, boolean>>;
  pending: PendingItem[];
  files: HandoverFile[];
  photos: Record<string, unknown>;
  signoff?: { sales?: SignOff | null; pm?: SignOff | null };
  /** This handover's own changes to the checklist the rules build. */
  custom: ChecklistCustom;
  /** EHVCG grant job. Its quotation is either the EVOne quotation itself (ehvcgSame) or files of kind 'EHVCG quotation'. */
  ehvcg: boolean;
  ehvcgSame: boolean;
  /** Dated notes, oldest first. info.notes / info.statusNotes hold what was typed before the log existed and are still shown. */
  noteLog: NoteEntry[];
  /** One entry per physical charger, with what the Charger Registry needs to take it over. */
  registry: RegistryUnit[];
}
export interface RegistryUnit {
  id: string;
  site: HandoverCharger['site'];
  /** A Charger Registry brand & model label (charger_brand_models). */
  brandModel: string;
  serial: string;
  regCode: string;
  /** Registration (turn-on) date — the warranty starts here. */
  turnOn: string;
  procured: string;
  warrantyYears: string;
  /** Form 1 PDF, already stored in the registry's own bucket. */
  form1: { path: string; name: string } | null;
  notes: string;
  /** Set once the charger exists in the registry — from then on it is managed there. */
  moved: { chargerId: string; siteId: string; projectId: string; at: string; by: string } | null;
}
/** What a unit still needs before it can go to the registry. */
export const registryMissing = (u: RegistryUnit): string[] => [
  !u.serial.trim() && 'serial number', !u.brandModel.trim() && 'brand & model', !u.turnOn && 'registration date',
].filter((x): x is string => !!x);
/** The registry's brand & model label that best fits a handover charger line ('' when unsure). */
export function guessBrandModel(c: HandoverCharger, labels: string[]): string {
  if (c.brand === 'Other') return '';
  const kw = new RegExp(`(^|[^0-9])${c.kw}\\s*kw`, 'i');
  const fits = labels.filter((l) => l.toLowerCase().includes(c.brand.toLowerCase()) && kw.test(l));
  if (fits.length <= 1) return fits[0] ?? '';
  return fits.find((l) => l.toLowerCase().includes(c.variant.toLowerCase())) ?? '';
}
/** A date that many years on (parts of a year count in months), as YYYY-MM-DD. */
export function addYearsYmd(ymd: string, years: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime()) || !(years > 0)) return '';
  d.setMonth(d.getMonth() + Math.round(years * 12));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export type NoteKind = 'pm' | 'status';
export interface NoteEntry { id: string; kind: NoteKind; text: string; at: string; by: string }
export const NOTE_KINDS: { key: NoteKind; label: string; legacy: 'notes' | 'statusNotes' }[] = [
  { key: 'pm', label: 'Notes for the Project Manager', legacy: 'notes' },
  { key: 'status', label: 'Status notes', legacy: 'statusNotes' },
];
/** A note log as plain lines for the PDF: what was typed before the log existed, then each dated note. */
export function noteLines(s: HandoverState, kind: NoteKind): string[] {
  const legacy = s.info[NOTE_KINDS.find((k) => k.key === kind)!.legacy].trim();
  const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
  return [...(legacy ? [legacy] : []), ...s.noteLog.filter((n) => n.kind === kind && n.text.trim()).map((n) => `${day(n.at)}${n.by ? ` · ${n.by}` : ''} — ${n.text.trim()}`)];
}

export type CheckSection = 'B' | 'C' | 'D1' | 'D2';
export type CheckOwner = 'Sales' | 'PE' | 'Contractor';
export const CHECK_SECTIONS: CheckSection[] = ['B', 'C', 'D1', 'D2'];
export interface CustomCheckItem { id: string; section: CheckSection; text: string; owner: CheckOwner }
/** Removing a template item only hides it here (it can be put back); its tick is kept. */
export interface ChecklistCustom {
  /** Reworded template items, by item id. */
  text: Record<string, string>;
  /** Template items taken off this handover, by item id. */
  removed: string[];
  /** Items added to this handover only. */
  added: CustomCheckItem[];
}
export const blankCustom = (): ChecklistCustom => ({ text: {}, removed: [], added: [] });
function normaliseCustom(raw: unknown): ChecklistCustom {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ChecklistCustom>;
  const owners: CheckOwner[] = ['Sales', 'PE', 'Contractor'];
  return {
    text: r.text && typeof r.text === 'object' ? Object.fromEntries(Object.entries(r.text).filter(([, v]) => typeof v === 'string')) : {},
    removed: Array.isArray(r.removed) ? r.removed.filter((x): x is string => typeof x === 'string') : [],
    added: Array.isArray(r.added)
      ? r.added.filter((a) => a && typeof a === 'object' && typeof a.id === 'string' && CHECK_SECTIONS.includes(a.section))
        .map((a) => ({ id: a.id, section: a.section, text: typeof a.text === 'string' ? a.text : '', owner: owners.includes(a.owner) ? a.owner : 'PE' }))
      : [],
  };
}

/** New handovers go to this Project Manager unless another is picked: Wan Shahrilnizam Fadzillah (app_users.id). */
export const DEFAULT_PM_USER_ID = 'f31e5ae0-84bc-4409-bb37-c92caffc51d1';

export const BLANK_CHARGER: HandoverCharger = { brand: 'Hiconics', kw: '22', qty: 1, other: '', variant: 'Standard', stand: false, site: '1' };
export const blankInfo = (): HandoverInfo => ({
  project: '', site: '', site2: '', site3: '', site4: '', quote: '', quoteSynced: '', hdate: '', sales: '', pm: '',
  ddate: '', logistics: '', statusNotes: '', contractor: '', contractorPrice: '', contractorQuote: '', cable: '', cableLen: '',
  msbFrom: '', msbTo: '', bollards: '', lots: '', paintColour: '', platformName: '', platformNotes: '',
  blewPhone: '', otherDocs: '', notes: '', cpOther: '', niOther: '',
});
export const blankState = (): HandoverState => ({
  info: blankInfo(), contacts: [{ name: '', phone: '' }], chargers: [],
  ownership: 'customer', scope: 'full', halfProt: 'mccb', floor: 'concrete', chargerStatus: 'Ordered',
  platform: 'no', blewPayer: 'EVOne', ltaPayer: 'Customer', ltaAccess: 'open',
  c: {}, d: {}, pending: [], files: [], photos: {}, signoff: {}, custom: blankCustom(),
  ehvcg: false, ehvcgSame: false, noteLog: [], registry: [],
});
/** Fills anything missing, so a row saved by an older version (or imported) always renders. */
export function normaliseState(raw: unknown): HandoverState {
  const b = blankState();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<HandoverState>;
  return {
    ...b, ...r,
    info: { ...b.info, ...(r.info ?? {}) },
    contacts: Array.isArray(r.contacts) && r.contacts.length ? r.contacts : b.contacts,
    chargers: Array.isArray(r.chargers) ? r.chargers.map((c) => ({ ...BLANK_CHARGER, ...(c as Partial<HandoverCharger>) })) : [],
    c: r.c ?? {}, d: r.d ?? {},
    pending: Array.isArray(r.pending) ? r.pending : [],
    files: Array.isArray(r.files) ? r.files.filter((f) => f && typeof f === 'object' && 'path' in f) : [],
    photos: r.photos ?? {}, signoff: r.signoff ?? {},
    custom: normaliseCustom(r.custom),
    ehvcg: r.ehvcg === true, ehvcgSame: r.ehvcgSame === true,
    noteLog: Array.isArray(r.noteLog)
      ? r.noteLog.filter((n) => n && typeof n === 'object' && typeof n.text === 'string')
        .map((n, i) => ({ id: typeof n.id === 'string' ? n.id : `n_${i}`, kind: n.kind === 'status' ? 'status' as const : 'pm' as const, text: n.text, at: typeof n.at === 'string' ? n.at : '', by: typeof n.by === 'string' ? n.by : '' }))
      : [],
    registry: Array.isArray(r.registry)
      ? r.registry.filter((u) => u && typeof u === 'object' && typeof u.id === 'string').map((u) => {
        const str = (v: unknown) => (typeof v === 'string' ? v : '');
        return {
          id: u.id, site: (['1', '2', '3', '4'] as const).find((n) => n === u.site) ?? '1', brandModel: str(u.brandModel), serial: str(u.serial), regCode: str(u.regCode),
          turnOn: str(u.turnOn), procured: str(u.procured), warrantyYears: str(u.warrantyYears), notes: str(u.notes),
          form1: u.form1 && typeof u.form1 === 'object' && typeof u.form1.path === 'string' ? { path: u.form1.path, name: str(u.form1.name) || 'Form 1.pdf' } : null,
          moved: u.moved && typeof u.moved === 'object' && typeof u.moved.chargerId === 'string' ? u.moved : null,
        };
      })
      : [],
  };
}

// ── Calculations ──────────────────────────────────────────────────

const live = (s: HandoverState) => s.chargers.filter((c) => Number(c.qty) > 0);
export const chargerCount = (s: HandoverState) => live(s).reduce((n, c) => n + Number(c.qty), 0);
export const totalLoad = (s: HandoverState) => live(s).reduce((n, c) => n + ampsOf(c.kw) * Number(c.qty), 0);
/** All chargers AC → Grade 7 whatever the load; otherwise ≤ 32 A 7 · ≤ 200 A 8 · above 9. */
export function lewGrade(s: HandoverState): 7 | 8 | 9 | null {
  const ch = live(s);
  if (!ch.length) return null;
  if (ch.every((c) => !isDc(c.kw))) return 7;
  const load = totalLoad(s);
  return load <= 32 ? 7 : load <= 200 ? 8 : 9;
}
/** LTA EV charger registration fee per charger (OneMotoring, until 31 Mar 2027). */
export function ltaFeePer(kw: string, access: HandoverState['ltaAccess']): number {
  const n = Number(kw);
  if (n < 23) return access === 'restricted' ? 375 : 150;
  if (n <= 150) return access === 'restricted' ? 750 : 375;
  return access === 'restricted' ? 750 : 600;
}
export const ltaFeeTotal = (s: HandoverState) => live(s).reduce((n, c) => n + ltaFeePer(c.kw, s.ltaAccess) * Number(c.qty), 0);

export const DC_SPECS: Record<Exclude<Brand, 'Other'>, { clearance: string; plinth: string }> = {
  NEG:      { clearance: '1 m behind (rear maintenance door)', plinth: '800 × 700 base, 130 × 200 cable slot, 4 × Ø12 holes' },
  Hici:     { clearance: '800 mm in front', plinth: '800 × 700 plinth, Ø110 cable hole, 4 × M12 bolts' },
  Hiconics: { clearance: '500 mm both sides + 700 mm in front', plinth: '840 × 660 base, 4 × M10 embedded screws' },
  Sinexcel: { clearance: '500 mm both sides + 850 mm in front (charger 850 W × 500 D × 2030 H)', plinth: '750 mm base, 4 × Ø20×35 fixing holes; leave cables 700 mm (power), 1500 mm and 4000 mm min. above a 200 mm base' },
};

export const chargerLabel = (c: HandoverCharger) => {
  const brand = c.brand === 'Other' ? (c.other.trim() || 'Other brand') : c.brand;
  const dc = isDc(c.kw);
  return `${brand} ${c.kw} kW ${dc ? 'DC' : 'AC'}${dc ? '' : ` · ${c.variant}${c.stand ? ' · on stand' : ' · wall-mount'}`}`;
};
/** Does a quotation number typed on a handover still name the pipeline's one(s)? ("A / B" needs both.) */
export const namesQuote = (text: string, no: string) => !!no && no.split(' / ').every((part) => text.toLowerCase().includes(part.toLowerCase()));
/** How a handover's quotation number follows the Sales Pipeline. `live` is the
 *  number the sale holds now ('' while no quotation is attached to it) and
 *  `ref` the sale's own SQ ref. Returns what to change, or null to leave it:
 *  a blank, the SQ ref or the last pipeline number is replaced by the current
 *  one; a typed number that still names the pipeline's is kept and remembered;
 *  a number typed by hand that names something else (a PO, say) is never touched. */
export function followQuoteNo(info: Pick<HandoverInfo, 'quote' | 'quoteSynced'>, live: string, ref: string): Partial<Pick<HandoverInfo, 'quote' | 'quoteSynced'>> | null {
  const cur = info.quote.trim();
  const synced = info.quoteSynced;
  if (!live) return cur ? null : { quote: ref };
  if (!cur || cur === ref || cur === synced) return cur === live && synced === live ? null : { quote: live, quoteSynced: live };
  if (namesQuote(cur, live)) return synced === live ? null : { quoteSynced: live };
  if (synced && synced !== live && namesQuote(cur, synced)) return { quote: live, quoteSynced: live };
  return null;
}
/** The main cable as written on the checklist and the PDF: the size picked, plus the run length when given. */
export const cableText = (info: HandoverInfo) =>
  [info.cable.trim(), info.cableLen.trim() ? `${info.cableLen.trim()} m` : ''].filter(Boolean).join(', ');
/** The Quote Machine catalogue category the cable sizes are picked from. */
export const CABLE_CATEGORY = 'Supply & Installation of Main Cable';
export const sitesOf = (s: HandoverState) => [s.info.site, s.info.site2, s.info.site3, s.info.site4];
export const SCOPE_LABEL: Record<HandoverState['scope'], string> = {
  full: 'Full job (from Main Switch Room)', half: 'Half job (from isolator)', install: 'Installation job only (from cement plinth)',
};
export const FLOOR_LABEL: Record<HandoverState['floor'], string> = { concrete: 'Existing concrete', grass: 'Grass patch', asphalt: 'Asphalt' };
export const onPlatform = (s: HandoverState) => s.ownership === 'cpo' || s.platform === 'yes';
export const needsPlinth = (s: HandoverState) => s.floor !== 'concrete' || !!s.c.plinth;
/** BLEW takes part when power is shut down, or confirms the MCCB on a half job. */
export const blewInvolved = (s: HandoverState) => !!s.c.shutdown || (s.scope === 'half' && s.halfProt === 'mccb');

/** Installation-only jobs: the three scope lists shown to everyone. */
export function installLists(s: HandoverState) {
  const grade = lewGrade(s);
  const hasDc = live(s).some((c) => isDc(c.kw));
  const evone = [
    'Transport and installation', 'Termination and commissioning', 'Engineering, drawings and coordination',
    `Grade ${grade ?? '—'} LEW professional services – SLD and endorsement for EVDB${hasDc ? ' + CoF for DC charger' : ''}`,
    ...(s.c.paint || s.c.bollard ? [`Painting of charging lots${s.c.bollard ? ' and bollards' : ''}`] : []),
  ];
  const customer = [
    ...(s.c.cpPlinth ? ["Cement plinth (to EVOne's drawing)"] : []),
    ...(s.c.cpCable ? ['Cables up to the plinth'] : []),
    ...(s.c.cpIsolator ? ['Upstream isolator / DB protection'] : []),
    ...(s.c.cpTrench ? ['Trenching / containment'] : []),
    ...(s.info.cpOther.trim() ? [s.info.cpOther.trim()] : []),
  ];
  const notInclusive = [...(s.c.niBlew ? ['BLEW fees'] : []), ...(s.info.niOther.trim() ? [s.info.niOther.trim()] : [])];
  return { evone, customer, notInclusive };
}

// ── Checklist ─────────────────────────────────────────────────────

export interface CheckItem { id: string; section: CheckSection; text: string; owner: CheckOwner }
export const SECTION_TITLES: Record<CheckSection, string> = {
  B: 'B · Preparation', C: 'C · Contractor briefing (before work starts)',
  D1: 'D · Turn-on day — PE to prepare', D2: 'D · Turn-on day — on the day',
};

/** The checklist as the screen, the PDF and the progress count use it: the
 *  template for the options picked, minus the items taken off this handover,
 *  with its rewordings, plus its own items at the end of each section. */
export function buildChecklist(s: HandoverState): CheckItem[] {
  const base = templateChecklist(s);
  const cu = s.custom;
  if (!cu || (!cu.removed.length && !cu.added.length && !Object.keys(cu.text).length)) return base;
  const removed = new Set(cu.removed);
  const out: CheckItem[] = [];
  for (const sec of CHECK_SECTIONS) {
    for (const i of base) {
      if (i.section !== sec || removed.has(i.id)) continue;
      const reworded = cu.text[i.id]?.trim();
      out.push(reworded ? { ...i, text: reworded } : i);
    }
    for (const a of cu.added) if (a.section === sec && a.text.trim()) out.push({ ...a, text: a.text.trim() });
  }
  return out;
}

/** What the rules alone build for the options picked — before this handover's own changes. */
export function templateChecklist(s: HandoverState): CheckItem[] {
  const out: CheckItem[] = [];
  const add = (section: CheckSection, id: string, text: string, owner: CheckOwner) => out.push({ id, section, text, owner });
  const { info, c } = s;
  const ch = live(s);
  const n = chargerCount(s);
  const dcBrands = [...new Set(ch.filter((x) => isDc(x.kw)).map((x) => x.brand))];
  const cpo = s.ownership === 'cpo';
  const grade = lewGrade(s);
  const plinth = needsPlinth(s);
  const platform = onPlatform(s);
  const docs = LANDLORD_DOCS.filter((d) => s.d[d.key]);
  const tail = (v: string, pre = ' — ') => (v.trim() ? `${pre}${v.trim()}` : '');

  // B · Preparation
  add('B', 'b_quote', `Quotation${tail(info.quote, ' ')} signed by the customer and uploaded`, 'Sales');
  add('B', 'b_contacts', 'Customer site contact told that the Project Manager is taking over', 'Sales');
  add('B', 'b_site', 'Site visit done — charger position confirmed with the customer', 'PE');
  add('B', 'b_chargers', `Chargers ${s.chargerStatus.toLowerCase()} — delivery date and logistics confirmed${tail(info.ddate)}`, 'PE');
  if (grade) add('B', 'b_lew', `Grade ${grade} LEW engaged (total load ${totalLoad(s)} A)`, 'PE');
  add('B', 'b_contractor', `Contractor${tail(info.contractor, ' ')} appointed — price and quotation recorded in Section F`, 'PE');
  if (s.scope === 'full') {
    add('B', 'b_msr', `Cable route from the Main Switch Room confirmed${tail(cableText(info))}`, 'PE');
    if (c.msb) add('B', 'b_msb', `MSB modification planned${info.msbFrom || info.msbTo ? ` (from ${info.msbFrom || '—'} A to ${info.msbTo || '—'} A)` : ''}`, 'PE');
  } else if (s.scope === 'half') {
    add('B', 'b_half', s.halfProt === 'mccb'
      ? 'BLEW has confirmed MCCB protection (no DB) — do not start until confirmed'
      : 'Customer has added a DB before the isolator — do not start until confirmed', 'PE');
  } else {
    add('B', 'b_install', "Customer's electrical contractor has EVOne's plinth drawing and the list of what they provide", 'PE');
  }
  if (s.floor !== 'concrete') add('B', 'b_floor', `Cement plinth required (${FLOOR_LABEL[s.floor].toLowerCase()}) — the DB goes on the plinth with the charger`, 'PE');
  else if (c.plinth) add('B', 'b_floor', 'Customer prefers a plinth on the existing concrete — the DB goes on the plinth with the charger', 'PE');
  for (const b of dcBrands) {
    if (b === 'Other') add('B', 'b_draw_Other', 'Other-brand DC charger — contractor to upload a photo of the cable opening', 'PE');
    else add('B', `b_draw_${b}`, `${b} plinth / cable-opening drawing sent to the contractor`, 'PE');
  }
  if (c.shutdown) add('B', 'b_shutdown', `Power shutdown arranged with the BLEW${tail(info.blewPhone, ' (')}${info.blewPhone.trim() ? ')' : ''} — BLEW fee borne by ${s.blewPayer}`, 'PE');
  for (const d of docs) add('B', `b_doc_${d.key}`, `${d.label} submitted to the landlord`, 'PE');
  if (info.otherDocs.trim()) add('B', 'b_doc_other', `Other landlord documents submitted: ${info.otherDocs.trim()}`, 'PE');
  if (c.excavation) add('B', 'b_excavation', 'Excavation / trenching approved — underground services checked', 'PE');
  if (c.traffic) add('B', 'b_traffic', 'Traffic management / lot closure arranged for the works', 'PE');
  if (c.cctv) add('B', 'b_cctv', 'CCTV bought (at least 2 weeks before installation)', 'PE');
  if (cpo) add('B', 'b_cpo', 'CPO site materials ready: 800 mm acrylic board with spotlight, cable hooks, charger wrap and charger ID QR code', 'PE');
  if (cpo && c.lightbox) add('B', 'b_lightbox', 'Lightbox ordered', 'PE');
  if (cpo && c.extraLight) add('B', 'b_extralight', 'Extra lighting ordered (STRIP-LIGHT-PION-3000K-MZ + PS-PION-12V-200W-YD)', 'PE');
  if (n) add('B', 'b_lta', `LTA registration fee confirmed: S$${ltaFeeTotal(s).toLocaleString()} for ${n} charger${n === 1 ? '' : 's'}, borne by ${s.ltaPayer}`, 'Sales');

  // C · Contractor briefing
  add('C', 'c_position', 'Charger at least 1.3 m behind the wheel stopper (lorry overhang)', 'Contractor');
  if (s.scope !== 'install') {
    add('C', 'c_floor', plinth
      ? "Build the cement plinth to EVOne's drawing — the DB goes on the plinth with the charger"
      : 'Existing concrete floor — fix the charger directly, no plinth', 'Contractor');
  } else {
    add('C', 'c_install', "Install on the cement plinth provided by the customer's electrical contractor; terminate and commission", 'Contractor');
  }
  for (const b of dcBrands) {
    if (b === 'Other') { add('C', 'c_photo_Other', 'Other-brand DC charger: upload a photo of the cable opening', 'Contractor'); continue; }
    add('C', `c_clear_${b}`, `${b} door clearance: ${DC_SPECS[b].clearance}`, 'Contractor');
    add('C', `c_plinth_${b}`, `${b} plinth / cable opening: ${DC_SPECS[b].plinth}`, 'Contractor');
  }
  const stands = ch.filter((x) => !isDc(x.kw) && x.stand).reduce((a, x) => a + Number(x.qty), 0);
  const acTotal = ch.filter((x) => !isDc(x.kw)).reduce((a, x) => a + Number(x.qty), 0);
  if (stands) add('C', 'c_stand', `Install ${stands} AC charger${stands === 1 ? '' : 's'} on a charger stand${acTotal > stands ? `; the other ${acTotal - stands} wall-mounted` : ''}`, 'Contractor');
  else if (acTotal) add('C', 'c_stand', `Wall-mount the ${acTotal} AC charger${acTotal === 1 ? '' : 's'} (no charger stand)`, 'Contractor');
  if (s.scope === 'full') {
    add('C', 'c_msr', `Lay the cable from the Main Switch Room${tail(cableText(info))}`, 'Contractor');
    if (c.msb) add('C', 'c_msb', `Modify the MSB${info.msbFrom || info.msbTo ? ` from ${info.msbFrom || '—'} A to ${info.msbTo || '—'} A` : ''}`, 'Contractor');
    add('C', 'c_isolator', 'Install one isolator per charger', 'Contractor');
    if (cpo) add('C', 'c_outlets', 'Provide 4 × 13A outlets in the DB (router, CCTV, maintenance, lightbox)', 'Contractor');
  } else if (s.scope === 'half') {
    add('C', 'c_half', `Connect from the existing isolator — start only once ${s.halfProt === 'mccb' ? 'the BLEW has confirmed MCCB protection' : "the customer's DB before the isolator is in"}`, 'Contractor');
  }
  add('C', 'c_estop', 'E-stop more than 3 m but less than 15 m from the charger; signage directly above it at eye level (1.3 m)', 'Contractor');
  add('C', 'c_seal', 'Seal the cable entry hole fully with silicone (pests / mice)', 'Contractor');
  if (c.bollard) add('C', 'c_bollard', `Install ${info.bollards.trim() || 'the'} bollard${info.bollards.trim() === '1' ? '' : 's'} on cement plinth — never on asphalt`, 'Contractor');
  if (c.paint) add('C', 'c_paint', `Paint ${info.lots.trim() || 'the'} charging lot${info.lots.trim() === '1' ? '' : 's'}${tail(info.paintColour, ' — colour: ')}`, 'Contractor');
  if (c.excavation) add('C', 'c_excavation', 'Excavation / trenching: reinstate the ground to its original condition', 'Contractor');
  if (c.traffic) add('C', 'c_traffic', 'Follow the agreed traffic management plan while working', 'Contractor');
  if (c.cctv) add('C', 'c_cctv', `Install the CCTV${cpo ? ' — CCTV signage at least 2 m away from the camera' : ''}`, 'Contractor');
  if (cpo) {
    add('C', 'c_board', 'Fix the 800 mm acrylic board with spotlight behind (L-bracket)', 'Contractor');
    add('C', 'c_hooks', 'Cable hooks: 1st near the charger at 1.5 m, 2nd at hand height', 'Contractor');
    add('C', 'c_wrap', 'Apply the charger wrap and the charger ID QR code', 'Contractor');
    if (c.lightbox) add('C', 'c_lightbox', 'Install the lightbox', 'Contractor');
    if (c.extraLight) add('C', 'c_extralight', 'Install the extra lighting (STRIP-LIGHT-PION-3000K-MZ + PS-PION-12V-200W-YD)', 'Contractor');
  }
  if (docs.length) add('C', 'c_docs', `Work to the landlord's ${docs.map((d) => d.key).join(' / ')} on site`, 'Contractor');
  add('C', 'c_form1', 'Hand Form 1 to EVOne at turn-on', 'Contractor');

  // D · Turn-on day and commissioning
  if (platform) add('D1', 'd_sim', `Tell Jared 2 working days ahead to activate ${n || 'the'} M1 SIM card${n === 1 ? '' : 's'} — one per charger${tail(info.platformName, ' (')}${info.platformName.trim() ? ')' : ''}`, 'PE');
  if (ch.some((x) => x.brand === 'Hiconics')) add('D1', 'd_battery', 'CR2032 button battery ready for each Hiconics charger', 'PE');
  add('D1', 'd_stickers', 'For every charger: big EVOne logo, small "Technical Hotline" sticker and the brand\'s LTA sticker', 'PE');
  add('D1', 'd_attendance', `Attendance confirmed: landlord PIC, electrical contractor, Grade ${grade ?? '—'} LEW${c.shutdown ? ', BLEW (power shutdown)' : ''}, EVOne Equipment Specialist`, 'PE');
  add('D2', 'd_form1', 'Form 1 obtained from the contractor', 'PE');
  if (blewInvolved(s)) add('D2', 'd_cs3', 'Statement of Turn-on or CS3 obtained (BLEW involved)', 'PE');
  add('D2', 'd_photos', 'All charger parameters photographed during commissioning and testing', 'PE');
  add('D2', 'd_keys', 'Charger keys taken back — or the Keys Undertaking Form signed', 'PE');
  add('D2', 'd_untrip', '1 customer PIC taught to untrip the DB; DB key handed over against a signed undertaking letter', 'PE');
  if (platform) add('D2', 'd_live', `Chargers live on ${info.platformName.trim() || 'the platform'}`, 'PE');
  add('D2', 'd_lta', 'LTA EV charger registration submitted on OneMotoring', 'PE');
  return out;
}

export function progressOf(s: HandoverState, checks: Record<string, boolean>) {
  const list = buildChecklist(s);
  return { done: list.filter((i) => checks[i.id]).length, total: list.length };
}

/** Section F: payment is on hold until all three are true. */
export function paymentStatus(s: HandoverState, checks: Record<string, boolean>) {
  const contractorItems = buildChecklist(s).filter((i) => i.section === 'C');
  const briefingDone = contractorItems.length > 0 && contractorItems.every((i) => checks[i.id]);
  const openPending = s.pending.filter((p) => p.owner === 'Contractor' && !p.closed && p.item.trim()).length;
  const formUploaded = s.files.some((f) => f.kind === 'Signed completion form');
  return { briefingDone, openPending, formUploaded, cleared: briefingDone && openPending === 0 && formUploaded };
}

/** Best guess of a register charger from a Stock Levels item name ("Hici DC - 120kW - 7m gun"). */
export function chargerFromItemName(name: string, qty: number): HandoverCharger {
  const brand: Brand = /hiconics/i.test(name) ? 'Hiconics' : /hici/i.test(name) ? 'Hici' : /\bneg\b/i.test(name) ? 'NEG' : /sinexcel/i.test(name) ? 'Sinexcel' : 'Other';
  const kws = [...name.matchAll(/(\d+(?:\.\d+)?)\s*-?\s*kw/gi)].map((m) => Number(m[1]));
  const kwNum = kws.length ? Math.max(...kws) : 22;
  const kw = kwOptionsFor(brand).includes(String(kwNum)) ? String(kwNum) : kwOptionsFor(brand)[0];
  return { brand, kw, qty, other: brand === 'Other' ? name : '', variant: /premium/i.test(name) ? 'Premium' : 'Standard', stand: false, site: '1' };
}
