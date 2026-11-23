import { Document, Page, View, Text, Image as PdfImage, pdf } from '@react-pdf/renderer';
import logoSrc from '../../assets/evone-logo.png';
import { C } from '../../theme';
import {
  buildChecklist, chargerLabel, chargerCount, totalLoad, lewGrade, ltaFeeTotal, ltaFeePer, ampsOf, isDc, sitesOf, installLists,
  paymentStatus, SCOPE_LABEL, FLOOR_LABEL, SECTION_TITLES, LANDLORD_DOCS, onPlatform, cableText, noteLines,
  type HandoverState, type CheckItem, type CheckSection,
} from './handoverRules';

export interface HandoverPdfInput {
  company: string;
  status: string;
  state: HandoverState;
  checks: Record<string, boolean>;
  /** The EVOne quotation(s) attached to the linked sale in the Sales Pipeline. */
  evoneQuotes?: string[];
}

const slate = C.slate;
const line = '#DDE3E8';
const bold = 'Helvetica-Bold';

function Heading({ children }: { children: string }) {
  return (
    <View style={{ backgroundColor: C.green, paddingVertical: 4, paddingHorizontal: 8, marginTop: 12, marginBottom: 6 }} wrap={false}>
      <Text style={{ fontFamily: bold, fontSize: 10, color: '#FFFFFF' }}>{children}</Text>
    </View>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 3 }} wrap={false}>
      <Text style={{ width: 120, fontSize: 8.5, color: slate }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 9, color: '#1a1a1a' }}>{value || '—'}</Text>
    </View>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <View style={{ width: 10, height: 10, borderWidth: 1, borderColor: on ? C.green : '#8A97A3', backgroundColor: on ? C.green : '#FFFFFF', marginRight: 6, marginTop: 1, alignItems: 'center', justifyContent: 'center' }}>
      {on && <Text style={{ fontFamily: bold, fontSize: 7, color: '#FFFFFF', lineHeight: 1 }}>X</Text>}
    </View>
  );
}

function Checklist({ items, checks, showOwner }: { items: CheckItem[]; checks: Record<string, boolean>; showOwner?: boolean }) {
  return (
    <View>
      {items.map((i) => (
        <View key={i.id} style={{ flexDirection: 'row', marginBottom: 4 }} wrap={false}>
          <Tick on={!!checks[i.id]} />
          <Text style={{ flex: 1, fontSize: 9, color: '#1a1a1a', lineHeight: 1.35 }}>{i.text}</Text>
          {showOwner && <Text style={{ width: 52, fontSize: 7.5, color: slate, textAlign: 'right' }}>{i.owner}</Text>}
        </View>
      ))}
      {items.length === 0 && <Text style={{ fontSize: 9, color: slate }}>Nothing applies.</Text>}
    </View>
  );
}

function SignBox({ label, name, date }: { label: string; name?: string; date?: string }) {
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: line, padding: 8 }} wrap={false}>
      <Text style={{ fontFamily: bold, fontSize: 8.5, color: slate, marginBottom: 22 }}>{label}</Text>
      <View style={{ borderTopWidth: 1, borderTopColor: '#8A97A3', paddingTop: 3 }}>
        <Text style={{ fontSize: 8.5, color: '#1a1a1a' }}>Name: {name || ''}</Text>
        <Text style={{ fontSize: 8.5, color: '#1a1a1a', marginTop: 2 }}>Date: {date || ''}</Text>
      </View>
    </View>
  );
}

function HandoverDoc({ company, status, state, checks, evoneQuotes }: HandoverPdfInput) {
  const { info } = state;
  const list = buildChecklist(state);
  const of = (sec: CheckSection) => list.filter((i) => i.section === sec);
  const sites = sitesOf(state);
  const grade = lewGrade(state);
  const pay = paymentStatus(state, checks);
  const lists = state.scope === 'install' ? installLists(state) : null;
  const flags = [
    state.c.msb && 'MSB modification', state.c.plinth && 'Plinth', state.c.bollard && `Bollards${info.bollards ? ` × ${info.bollards}` : ''}`,
    state.c.paint && `Lot painting${info.lots ? ` × ${info.lots}` : ''}`, state.c.excavation && 'Excavation', state.c.traffic && 'Traffic management',
    state.c.cctv && 'CCTV', state.c.lightbox && 'Lightbox', state.c.extraLight && 'Extra lighting', state.c.shutdown && 'Power shutdown',
  ].filter(Boolean).join(', ');
  const docs = [...LANDLORD_DOCS.filter((d) => state.d[d.key]).map((d) => d.key), ...(info.otherDocs.trim() ? [info.otherDocs.trim()] : [])].join(', ');
  const done = list.filter((i) => checks[i.id]).length;

  return (
    <Document title={`Project Handover - ${company}`}>
      <Page size="A4" style={{ fontFamily: 'Helvetica', paddingTop: 32, paddingBottom: 44, paddingHorizontal: 36, backgroundColor: '#FFFFFF' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 2, borderBottomColor: C.green, paddingBottom: 8 }}>
          <PdfImage src={logoSrc} style={{ height: 30 }} />
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: bold, fontSize: 14, color: C.green }}>Project Handover Form</Text>
            <Text style={{ fontSize: 8.5, color: slate, marginTop: 2 }}>Sales to Project Manager · {status} · {done}/{list.length} checked</Text>
          </View>
        </View>

        <Heading>A · Project summary</Heading>
        <Pair label="Company / project" value={company || info.project} />
        <Pair label="Quotation" value={info.quote} />
        {!!evoneQuotes?.length && <Pair label="EVOne quotation" value={evoneQuotes.join(', ')} />}
        {state.ehvcg && <Pair label="EHVCG project" value={`Yes — EHVCG quotation: ${state.ehvcgSame
          ? 'same as the EVOne quotation'
          : state.files.filter((f) => f.kind === 'EHVCG quotation').map((f) => f.name).join(', ') || 'not attached yet'}`} />}
        {sites.map((a, i) => (a.trim() ? <Pair key={i} label={`Site ${i + 1}`} value={a} /> : null))}
        <Pair label="Site contact(s)" value={state.contacts.filter((c) => c.name.trim() || c.phone.trim()).map((c) => [c.name, c.phone].filter(Boolean).join(' ')).join('; ')} />
        <Pair label="Sales" value={info.sales} />
        <Pair label="Project Manager" value={info.pm} />
        <Pair label="Handover date" value={info.hdate} />
        <Pair label="Ownership" value={state.ownership === 'cpo' ? 'CPO site (EVOne-owned)' : 'Customer-owned'} />
        <Pair label="Job scope" value={`${SCOPE_LABEL[state.scope]}${state.scope === 'half' ? ` — ${state.halfProt === 'mccb' ? 'BLEW confirms MCCB protection (no DB)' : 'customer adds a DB before the isolator'}` : ''}`} />
        <Pair label="Floor" value={FLOOR_LABEL[state.floor]} />
        <Pair label="Chargers" value={`${state.chargerStatus}${info.ddate ? ` · delivery ${info.ddate}` : ''}${info.logistics ? ` · ${info.logistics}` : ''}`} />
        <Pair label="Platform" value={`${onPlatform(state) ? info.platformName || 'Yes' : state.platform === 'maybe' ? `Maybe${info.platformName ? ` (${info.platformName})` : ''}` : 'No'}${info.platformNotes.trim() ? ` — ${info.platformNotes.trim()}` : ''}`} />
        <Pair label="Site works" value={flags} />
        <Pair label="Landlord documents" value={docs} />
        {cableText(info) !== '' && <Pair label="Cable" value={cableText(info)} />}
        {noteLines(state, 'pm').length > 0 && <Pair label="Notes" value={noteLines(state, 'pm').join('\n')} />}
        {noteLines(state, 'status').length > 0 && <Pair label="Status notes" value={noteLines(state, 'status').join('\n')} />}

        <View style={{ borderWidth: 1, borderColor: line, marginTop: 6 }}>
          <View style={{ flexDirection: 'row', backgroundColor: C.seasalt, borderBottomWidth: 1, borderBottomColor: line }}>
            {['Charger', 'Site', 'Qty', 'Amps each', 'LTA fee each'].map((h, i) => (
              <Text key={h} style={{ flex: i === 0 ? 3 : 1, fontFamily: bold, fontSize: 8, color: slate, padding: 4, textAlign: i === 0 ? 'left' : 'right' }}>{h}</Text>
            ))}
          </View>
          {state.chargers.filter((c) => Number(c.qty) > 0).map((c, i) => (
            <View key={i} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: line }} wrap={false}>
              <Text style={{ flex: 3, fontSize: 9, padding: 4 }}>{chargerLabel(c)}</Text>
              <Text style={{ flex: 1, fontSize: 9, padding: 4, textAlign: 'right' }}>{c.site}</Text>
              <Text style={{ flex: 1, fontSize: 9, padding: 4, textAlign: 'right' }}>{c.qty}</Text>
              <Text style={{ flex: 1, fontSize: 9, padding: 4, textAlign: 'right' }}>{ampsOf(c.kw)} A {isDc(c.kw) ? 'DC' : 'AC'}</Text>
              <Text style={{ flex: 1, fontSize: 9, padding: 4, textAlign: 'right' }}>S${ltaFeePer(c.kw, state.ltaAccess)}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', backgroundColor: C.honeydew }} wrap={false}>
            <Text style={{ flex: 1, fontFamily: bold, fontSize: 9, padding: 5, color: C.green }}>
              {chargerCount(state)} charger(s) · total load {totalLoad(state)} A · LEW Grade {grade ?? '—'} · LTA fee S${ltaFeeTotal(state).toLocaleString()} ({state.ltaAccess === 'restricted' ? 'restricted' : 'non-restricted'}), borne by {state.ltaPayer}
            </Text>
          </View>
        </View>

        {lists && (
          <View style={{ marginTop: 8 }}>
            {([["EVOne LEW work scope (per charger)", lists.evone], ["Customer's electrical contractor to provide", lists.customer], ['Not inclusive', lists.notInclusive]] as const).map(([t, rows]) => (
              <View key={t} style={{ marginBottom: 5 }} wrap={false}>
                <Text style={{ fontFamily: bold, fontSize: 8.5, color: C.opal, marginBottom: 2 }}>{t}</Text>
                {rows.length ? rows.map((r) => <Text key={r} style={{ fontSize: 9, marginLeft: 8, marginBottom: 1.5 }}>- {r}</Text>) : <Text style={{ fontSize: 9, marginLeft: 8, color: slate }}>-</Text>}
              </View>
            ))}
          </View>
        )}

        <Heading>{SECTION_TITLES.B}</Heading>
        <Checklist items={of('B')} checks={checks} showOwner />

        <Heading>{SECTION_TITLES.C}</Heading>
        <Text style={{ fontSize: 8.5, color: slate, marginBottom: 5 }}>Briefing given before work starts. Contractor: {info.contractor || '—'}</Text>
        <Checklist items={of('C')} checks={checks} />
        <View style={{ flexDirection: 'row', marginTop: 8 }}>
          <SignBox label="Contractor acknowledgement — briefed on every item above" />
        </View>

        <Heading>D · Turn-on day and commissioning</Heading>
        <Text style={{ fontFamily: bold, fontSize: 8.5, color: C.opal, marginBottom: 3 }}>PE to prepare</Text>
        <Checklist items={of('D1')} checks={checks} />
        <Text style={{ fontFamily: bold, fontSize: 8.5, color: C.opal, marginTop: 5, marginBottom: 3 }}>On turn-on day</Text>
        <Checklist items={of('D2')} checks={checks} />

        <Heading>E · Pending items</Heading>
        <View style={{ borderWidth: 1, borderColor: line }}>
          <View style={{ flexDirection: 'row', backgroundColor: C.seasalt, borderBottomWidth: 1, borderBottomColor: line }}>
            {[['Item', 3], ['Solution', 3], ['Owner', 1.2], ['Target', 1.2], ['Closed', 0.8]].map(([h, f]) => (
              <Text key={h as string} style={{ flex: f as number, fontFamily: bold, fontSize: 8, color: slate, padding: 4 }}>{h}</Text>
            ))}
          </View>
          {state.pending.filter((p) => p.item.trim()).map((p, i) => (
            <View key={i} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: line }} wrap={false}>
              <Text style={{ flex: 3, fontSize: 9, padding: 4 }}>{p.item}</Text>
              <Text style={{ flex: 3, fontSize: 9, padding: 4 }}>{p.solution}</Text>
              <Text style={{ flex: 1.2, fontSize: 9, padding: 4 }}>{p.owner}</Text>
              <Text style={{ flex: 1.2, fontSize: 9, padding: 4 }}>{p.due}</Text>
              <Text style={{ flex: 0.8, fontSize: 9, padding: 4, color: p.closed ? C.green : C.yellow }}>{p.closed ? 'Yes' : 'Open'}</Text>
            </View>
          ))}
          {state.pending.filter((p) => p.item.trim()).length === 0 && <Text style={{ fontSize: 9, color: slate, padding: 5 }}>No pending items.</Text>}
        </View>

        <View wrap={false}>
          <Heading>F · Contractor completion & payment</Heading>
          <Pair label="Contractor" value={info.contractor} />
          <Pair label="Agreed price" value={info.contractorPrice ? `S$${info.contractorPrice} (excl. GST)${info.contractorQuote ? ` · quote ${info.contractorQuote}` : ''}` : ''} />
          <View style={{ backgroundColor: pay.cleared ? C.honeydew : '#FFF0E0', padding: 6, marginTop: 3 }} wrap={false}>
            <Text style={{ fontFamily: bold, fontSize: 9.5, color: pay.cleared ? C.green : '#B45309' }}>{pay.cleared ? 'Cleared for payment' : 'Payment on hold'}</Text>
            <Text style={{ fontSize: 8.5, color: '#1a1a1a', marginTop: 2 }}>
              Section C fully ticked: {pay.briefingDone ? 'yes' : 'no'} · open contractor pending items: {pay.openPending} · signed completion form uploaded: {pay.formUploaded ? 'yes' : 'no'}
            </Text>
          </View>
        </View>

        <View wrap={false}>
          <Heading>G · Sign-off</Heading>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <SignBox label="Sales" name={state.signoff?.sales?.by ?? info.sales} date={state.signoff?.sales?.at?.slice(0, 10)} />
            <SignBox label="Project Manager" name={state.signoff?.pm?.by ?? info.pm} date={state.signoff?.pm?.at?.slice(0, 10)} />
          </View>
        </View>

        <Text fixed style={{ position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 7.5, color: slate, textAlign: 'center' }}
          render={({ pageNumber, totalPages }) => `EVOne Charging Pte. Ltd. · Project Handover · ${company} · page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  );
}

export const handoverPdfBlob = (input: HandoverPdfInput) => pdf(<HandoverDoc {...input} />).toBlob();
