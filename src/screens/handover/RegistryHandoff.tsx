import { useEffect, useState } from 'react';
import { Plus, X, FileUp, Paperclip, Check, ArrowRight } from 'lucide-react';
import { C } from '../../theme';
import { SearchSelect } from '../../components/SearchSelect';
import { supabase } from '../../lib/supabase';
import { CHARGER_FORMS_BUCKET, composeChargerFilename, pathSafe, ltaNextDates } from '../Projects';
import {
  chargerCount, sitesOf, registryMissing, guessBrandModel, addYearsYmd,
  type HandoverState, type HandoverCharger, type RegistryUnit,
} from './handoverRules';

// Charger Registry details on a Project Handover: one entry per physical
// charger with what the registry needs (serial number, brand & model,
// registration date, LTA code, warranty, Form 1), and the step that creates
// those chargers in the registry. It only ever ADDS registry rows — a project
// and a site when asked to, and one site_chargers row per unit, stored exactly
// as the registry's own charger form stores them. A unit that has gone across
// is marked and locked here; from then on it is edited in the registry.

interface RegProject { id: string; name: string; customer_id: string | null }
interface RegSite { id: string; project_id: string; name: string; address: string | null }
const NEW = '__new';

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: C.white };
const ghostBtn: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };
const fmtDate = (s: string) => { const d = new Date(s.length === 10 ? `${s}T00:00:00` : s); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const uid = () => `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.slate, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

export function RegistryHandoff({ state: s, setState, ro, me, company, customerId, isResidential, warrantyYearsFor, onNote }: {
  state: HandoverState;
  setState: (fn: (s: HandoverState) => HandoverState) => void;
  ro: boolean;
  me: string;
  company: string;
  customerId: string | null;
  isResidential: boolean;
  /** Years of warranty sold with a charger line on the sale ('' when not set or mixed). */
  warrantyYearsFor: (c: HandoverCharger) => string;
  onNote: (text: string) => void;
}) {
  const [refs, setRefs] = useState<{ models: string[]; projects: RegProject[]; sites: RegSite[] } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const load = async () => {
    const [m, p, st] = await Promise.all([
      supabase.from('charger_brand_models').select('label, position').order('position').order('label'),
      supabase.from('projects').select('id, name, customer_id').order('name'),
      supabase.from('project_sites').select('id, project_id, name, address').order('position').order('name'),
    ]);
    const err = m.error ?? p.error ?? st.error;
    if (err) { setLoadErr(err.message); return; }
    setLoadErr(null);
    setRefs({
      models: ((m.data ?? []) as { label: string }[]).map((x) => x.label),
      projects: (p.data ?? []) as RegProject[],
      sites: (st.data ?? []) as RegSite[],
    });
  };
  useEffect(() => { void load(); }, []);

  const units = s.registry;
  const setUnit = (id: string, patch: Partial<RegistryUnit>) => setState((x) => ({ ...x, registry: x.registry.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
  const siteList = sitesOf(s).map((a, i) => ({ n: String(i + 1) as RegistryUnit['site'], address: a.trim() })).filter((x) => x.address || x.n === '1');
  const jobTotal = chargerCount(s);
  // One slot per physical charger, in the order of the job's charger lines.
  const slots = s.chargers.flatMap((c) => Array.from({ length: Math.max(0, Math.floor(Number(c.qty) || 0)) }, () => c));
  const newUnit = (c?: HandoverCharger): RegistryUnit => ({
    id: uid(), site: c?.site ?? '1', brandModel: c ? guessBrandModel(c, refs?.models ?? []) : '', serial: '', regCode: '',
    turnOn: '', procured: '', warrantyYears: c ? warrantyYearsFor(c) : '', form1: null, notes: '', moved: null,
  });
  const addFromJob = () => setState((x) => ({ ...x, registry: [...x.registry, ...slots.slice(x.registry.length).map((c) => newUnit(c))] }));

  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const uploadForm1 = async (u: RegistryUnit, file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setErr('Form 1 must be a PDF.'); return; }
    setErr(null);
    setBusyId(u.id);
    const path = `form-1/${crypto.randomUUID()}/${pathSafe(composeChargerFilename('Form 1', u.serial, u.turnOn || null, company))}`;
    const { error } = await supabase.storage.from(CHARGER_FORMS_BUCKET).upload(path, file, { contentType: 'application/pdf' });
    setBusyId(null);
    if (error) { setErr(`Form 1 was not uploaded: ${error.message}`); return; }
    // A replaced Form 1 is left in storage rather than deleted.
    setUnit(u.id, { form1: { path, name: file.name } });
  };
  const openForm1 = async (path: string) => {
    const { data, error } = await supabase.storage.from(CHARGER_FORMS_BUCKET).createSignedUrl(path, 60);
    if (error || !data) { setErr(`Could not open the Form 1: ${error?.message ?? 'unknown error'}`); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  // ── Adding to the registry ──
  const pending = units.filter((u) => !u.moved);
  const ready = pending.filter((u) => registryMissing(u).length === 0);
  const movedCount = units.length - pending.length;
  const earlier = units.find((u) => u.moved)?.moved ?? null;
  const [projectPick, setProjectPick] = useState('');
  const [sitePick, setSitePick] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);
  const clientProjects = refs ? refs.projects.filter((p) => !!customerId && p.customer_id === customerId) : [];
  // Default to where this job's chargers already went, else the client's registry when there is exactly one.
  const projectId = projectPick || earlier?.projectId || (clientProjects.length === 1 ? clientProjects[0].id : '');
  // The site always belongs to the chosen project: a new project (or one with no
  // sites yet) gets a new site; otherwise where this job's chargers already went.
  const projectSites = (refs?.sites ?? []).filter((x) => x.project_id === projectId);
  const siteOf = (n: string): string => {
    const pick = sitePick[n];
    if (pick && (pick === NEW || projectSites.some((x) => x.id === pick))) return pick;
    if (!projectId) return '';
    if (projectId === NEW || projectSites.length === 0) return NEW;
    const prev = units.find((u) => u.moved && u.site === n)?.moved;
    if (prev && projectSites.some((x) => x.id === prev.siteId)) return prev.siteId;
    return '';
  };
  const readySites = [...new Set(ready.map((u) => u.site))];
  const canMove = ready.length > 0 && !!projectId && readySites.every((n) => !!siteOf(n));
  const newSiteName = (n: string) => `${company.trim() || 'Site'}${n === '1' ? '' : ` — Site ${n}`}`;
  const noForm1 = ready.filter((u) => !u.form1).length;

  const move = async () => {
    if (!canMove || working) return;
    setWorking(true);
    setErr(null);
    const done: Record<string, NonNullable<RegistryUnit['moved']>> = {};
    try {
      const batch = ready;
      const serials = batch.map((u) => u.serial.trim());
      const twice = serials.find((x, i) => serials.indexOf(x) !== i);
      if (twice) throw new Error(`Serial number ${twice} is entered on two chargers.`);
      const clash = await supabase.from('site_chargers').select('asset_tag').in('asset_tag', serials);
      if (clash.error) throw new Error(clash.error.message);
      if (clash.data?.length) throw new Error(`Already in the Charger Registry: ${[...new Set((clash.data as { asset_tag: string }[]).map((c) => c.asset_tag))].join(', ')}. Check there before adding again.`);

      let pid = projectId;
      if (pid === NEW) {
        const made = await supabase.from('projects').insert({ name: company.trim() || 'Untitled', status: 'active', notes: null, customer_id: customerId }).select('id').single();
        if (made.error || !made.data) throw new Error(made.error?.message ?? 'Could not create the registry project.');
        pid = (made.data as { id: string }).id;
        setProjectPick(pid);
      }
      const siteIds: Record<string, string> = {};
      const siteNames: Record<string, string> = {};
      for (const n of readySites) {
        let sid = siteOf(n);
        if (sid === NEW) {
          const name = newSiteName(n);
          const made = await supabase.from('project_sites').insert({
            project_id: pid, name, address: siteList.find((x) => x.n === n)?.address || null, latitude: null, longitude: null, notes: null,
          }).select('id').single();
          if (made.error || !made.data) throw new Error(made.error?.message ?? 'Could not create the registry site.');
          sid = (made.data as { id: string }).id;
          siteNames[n] = name;
          setSitePick((p) => ({ ...p, [n]: sid }));
        } else {
          siteNames[n] = refs?.sites.find((x) => x.id === sid)?.name ?? '';
        }
        siteIds[n] = sid;
      }

      let failed: string | null = null;
      for (const u of batch) {
        const turnOn = u.turnOn || null;
        const procured = u.procured || null;
        const years = Number(u.warrantyYears);
        const made = await supabase.from('site_chargers').insert({
          site_id: siteIds[u.site],
          asset_tag: u.serial.trim(),
          brand_model: u.brandModel.trim() || null,
          registration_code: u.regCode.trim() || null,
          procurement_date: procured,
          turn_on_date: turnOn,
          lta_letter_date: null,
          lta_letter_forms: null,
          ...ltaNextDates({ turn_on_date: turnOn, procurement_date: procured }, isResidential),
          warranty_start_date: turnOn,
          warranty_end_date: turnOn && years > 0 ? addYearsYmd(turnOn, years) || null : null,
          form_1_path: u.form1?.path ?? null,
          form_1_filename: u.form1 ? composeChargerFilename('Form 1', u.serial.trim(), turnOn, siteNames[u.site]) : null,
          form_1_invoice_path: null,
          form_1_invoice_filename: null,
          notes: u.notes.trim() || null,
        }).select('id').single();
        if (made.error || !made.data) { failed = `${u.serial.trim()}: ${made.error?.message ?? 'not saved'}`; break; }
        done[u.id] = { chargerId: (made.data as { id: string }).id, siteId: siteIds[u.site], projectId: pid, at: new Date().toISOString(), by: me };
      }
      if (failed) throw new Error(`Stopped at ${failed}. ${Object.keys(done).length ? 'The chargers before it were added.' : 'Nothing was added.'}`);
      onNote(`${batch.length} charger${batch.length === 1 ? '' : 's'} added to the Charger Registry.`);
      setConfirm(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      // Mark what did go across even if a later one failed, so it is never added twice.
      if (Object.keys(done).length) setState((x) => ({ ...x, registry: x.registry.map((u) => (done[u.id] ? { ...u, moved: done[u.id] } : u)) }));
      setWorking(false);
      void load();
    }
  };

  const projectName = (id: string) => (id === NEW ? `New registry project “${company.trim() || 'Untitled'}”` : refs?.projects.find((p) => p.id === id)?.name ?? 'the chosen project');
  const pill = (bg: string, color: string, text: string) => <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: bg, color, whiteSpace: 'nowrap' }}>{text}</span>;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Charger Registry details</div>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.slate }}>{movedCount}/{Math.max(units.length, jobTotal)} in the registry</span>
      </div>
      <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.5 }}>
        After turn-on, fill in each charger here and add it to the Charger Registry in one step — no retyping. A charger needs its serial number, brand &amp; model and registration date; the LTA registration code, warranty and Form 1 can go in now or later in the registry.
      </div>
      {loadErr && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Could not read the Charger Registry: {loadErr}</div>}
      {err && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{err}</div>}

      {units.map((u, i) => {
        const missing = registryMissing(u);
        const locked = ro || !!u.moved;
        const end = u.turnOn && Number(u.warrantyYears) > 0 ? addYearsYmd(u.turnOn, Number(u.warrantyYears)) : '';
        const txt = (k: 'serial' | 'regCode' | 'warrantyYears' | 'notes', placeholder: string, mode?: 'decimal') => (
          <input value={u[k]} disabled={locked} placeholder={placeholder} inputMode={mode} onChange={(e) => setUnit(u.id, { [k]: mode ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value })}
            style={{ ...inputStyle, background: locked ? C.seasalt : C.white }} />
        );
        const date = (k: 'turnOn' | 'procured') => (
          <input type="date" value={u[k]} disabled={locked} onChange={(e) => setUnit(u.id, { [k]: e.target.value })} style={{ ...inputStyle, background: locked ? C.seasalt : C.white }} />
        );
        return (
          <div key={u.id} style={{ background: u.moved ? C.honeydew : C.seasalt, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>Charger {i + 1}</span>
              {u.moved
                ? pill('#E4F3E3', '#1B512D', `In the Charger Registry · ${fmtDate(u.moved.at)}${u.moved.by ? ` · ${u.moved.by}` : ''}`)
                : missing.length ? pill('#FFF0E0', '#B45309', `Needs ${missing.join(', ')}`) : pill('#E3F0FF', '#1A62C0', 'Ready for the registry')}
              {!locked && (
                <button type="button" title="Remove this charger from the list" onClick={() => setState((x) => ({ ...x, registry: x.registry.filter((y) => y.id !== u.id) }))}
                  style={{ ...ghostBtn, marginLeft: 'auto', padding: '5px 10px', borderColor: '#FDEAEA', color: '#C0321A' }}><X size={12} /> Remove</button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
              <Field label="Serial number *">{txt('serial', 'From the charger nameplate')}</Field>
              <Field label="Brand & model *">
                <SearchSelect value={u.brandModel} disabled={locked} placeholder="Select the model…" emptyText="No models match" onChange={(v) => setUnit(u.id, { brandModel: v })}
                  options={[...new Set([...(refs?.models ?? []), ...(u.brandModel ? [u.brandModel] : [])])].map((m) => ({ value: m, label: m }))} />
              </Field>
              {siteList.length > 1 && (
                <Field label="Site">
                  <SearchSelect value={u.site} disabled={locked} onChange={(v) => setUnit(u.id, { site: v as RegistryUnit['site'] })}
                    options={siteList.map((x) => ({ value: x.n, label: `Site ${x.n}`, sub: x.address || undefined }))} />
                </Field>
              )}
              <Field label="Registration date *" hint="Turn-on / LTA registration — the warranty starts here">{date('turnOn')}</Field>
              <Field label="LTA registration code">{txt('regCode', 'e.g. R105552H')}</Field>
              <Field label="Procurement date">{date('procured')}</Field>
              <Field label="Warranty (years)" hint={end ? `Ends ${fmtDate(end)}` : 'From the sale when it was set there'}>{txt('warrantyYears', 'e.g. 2', 'decimal')}</Field>
              <Field label="Form 1 (PDF)">
                <div style={{ minHeight: 38, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {u.form1 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', padding: '5px 6px 5px 10px', borderRadius: 99, border: `1px solid ${C.green}`, background: C.white }}>
                      <button type="button" onClick={() => void openForm1(u.form1!.path)}
                        style={{ border: 'none', background: 'none', padding: 0, color: C.green, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <Paperclip size={12} style={{ flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{u.form1.name}</span>
                      </button>
                      {!locked && <button type="button" title="Take this Form 1 off the charger" onClick={() => setUnit(u.id, { form1: null })} style={{ width: 20, height: 20, borderRadius: 99, border: 'none', background: C.seasalt, color: C.slate, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={11} strokeWidth={3} /></button>}
                    </span>
                  )}
                  {!locked && (
                    <label style={{ ...ghostBtn, padding: '7px 12px', borderRadius: 99, borderStyle: 'dashed', borderColor: C.green, color: C.green, cursor: busyId === u.id ? 'default' : 'pointer' }}>
                      <FileUp size={12} /> {busyId === u.id ? 'Uploading…' : u.form1 ? 'Replace' : 'Attach Form 1'}
                      <input type="file" accept="application/pdf" disabled={busyId === u.id} style={{ display: 'none' }} onChange={(e) => { void uploadForm1(u, e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  )}
                  {locked && !u.form1 && <span style={{ fontSize: 12, color: C.slate }}>Not attached</span>}
                </div>
              </Field>
              <Field label="Notes">{txt('notes', 'Optional')}</Field>
            </div>
          </div>
        );
      })}
      {units.length === 0 && <div style={{ fontSize: 13, color: C.slate }}>No chargers listed yet{jobTotal ? ` — this job has ${jobTotal}.` : '.'}</div>}

      {!ro && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {slots.length > units.length && (
            <button type="button" onClick={addFromJob} style={{ ...ghostBtn, borderColor: C.green, color: C.green }}>
              <Plus size={13} /> {units.length ? `Add the other ${slots.length - units.length} from this job` : `List this job's ${slots.length} charger${slots.length === 1 ? '' : 's'}`}
            </button>
          )}
          <button type="button" onClick={() => setState((x) => ({ ...x, registry: [...x.registry, newUnit()] }))} style={ghostBtn}><Plus size={13} /> Add a charger</button>
        </div>
      )}

      {!ro && pending.length > 0 && (
        <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Add to the Charger Registry</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <Field label="Registry project" hint={clientProjects.length ? `${clientProjects.length} existing for this client` : 'This client has none yet'}>
              <SearchSelect value={projectId} placeholder="Choose where the chargers go…" emptyText="No registry projects match"
                onChange={(v) => { setProjectPick(v); setSitePick({}); setConfirm(false); }}
                options={[
                  { value: NEW, label: `Create a new one: ${company.trim() || 'Untitled'}` },
                  ...clientProjects.map((p) => ({ value: p.id, label: p.name, sub: 'This client' })),
                  ...(refs?.projects ?? []).filter((p) => !clientProjects.includes(p)).map((p) => ({ value: p.id, label: p.name })),
                ]} />
            </Field>
            {projectId && readySites.map((n) => (
              <Field key={n} label={siteList.length > 1 ? `Registry site for Site ${n}` : 'Registry site'} hint={siteList.find((x) => x.n === n)?.address || undefined}>
                <SearchSelect value={siteOf(n)} placeholder="Choose the site…" emptyText="No sites match"
                  onChange={(v) => { setSitePick((p) => ({ ...p, [n]: v })); setConfirm(false); }}
                  options={[
                    { value: NEW, label: `Create a new site: ${newSiteName(n)}` },
                    ...projectSites.map((x) => ({ value: x.id, label: x.name, sub: x.address ?? undefined })),
                  ]} />
              </Field>
            ))}
          </div>
          {!confirm ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" disabled={!canMove} onClick={() => setConfirm(true)}
                style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: canMove ? C.green : '#A5D6A7', color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: canMove ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ArrowRight size={14} /> Add {ready.length || ''} charger{ready.length === 1 ? '' : 's'} to the registry
              </button>
              <span style={{ fontSize: 12, color: C.slate }}>
                {ready.length === 0 ? 'No charger is ready yet — see what each one still needs above.'
                  : !canMove ? 'Choose the registry project and site.'
                    : pending.length > ready.length ? `${pending.length - ready.length} more will wait until complete.` : ''}
              </span>
            </div>
          ) : (
            <div style={{ background: '#E3F0FF', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 220, fontSize: 12, fontWeight: 600, color: '#1A62C0', lineHeight: 1.5 }}>
                Create {ready.length} charger{ready.length === 1 ? '' : 's'} in the Charger Registry under {projectName(projectId)}?
                {noForm1 ? ` ${noForm1} ${noForm1 === 1 ? 'has' : 'have'} no Form 1 yet — it can be added in the registry later.` : ''} After this they are edited in the registry, not here.
              </span>
              <button type="button" onClick={() => setConfirm(false)} disabled={working} style={ghostBtn}>Cancel</button>
              <button type="button" onClick={() => void move()} disabled={working}
                style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: '#1A62C0', color: C.white, fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: working ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Check size={13} /> {working ? 'Adding…' : 'Yes, add them'}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
