import { useEffect, useState } from 'react';
import { C } from '../../theme';
import { KPICard } from '../../components/KPICard';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../permissions';
import { Plus, Truck, Download, Lock, QrCode, RotateCcw } from 'lucide-react';
import { RequestLinksView } from './RequestLinks';
import { SearchSelect } from '../../components/SearchSelect';
import {
  useInvCore, insertRequest, REQ_DEPARTMENTS, REQ_META, qtyAt, usableTotal, itemLabel, fmtD, todayISO,
  Pill, Field, DeliverToField, ContactField, useCustomerDirectory, ErrorBanner, Modal, ItemSelect, LocationSelect, SearchBox, downloadCsv,
  inputStyle, primaryBtn, ghostBtn, pillBtn, thStyle, tdStyle,
  type InvItem, type InvRequest, type InvLocation, type OnHand, type CustomerOpt, type ContactOpt,
} from './invShared';

type ReqStatus = InvRequest['status'];

type Filter = 'open' | ReqStatus | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' }, { id: 'pending', label: 'Pending' }, { id: 'approved', label: 'Approved' },
  { id: 'fulfilled', label: 'Fulfilled' }, { id: 'cancelled', label: 'Cancelled' }, { id: 'legacy', label: 'Migrated' }, { id: 'all', label: 'All' },
];

export function ScreenInvRequests() {
  const { can, user } = usePermissions();
  const canEdit = can('inv_requests', 'can_edit');
  const canDelete = can('inv_requests', 'can_delete');
  const me = user.full_name || user.email;
  const { items, locations, onHand, error: coreErr, reload: reloadCore } = useInvCore();

  const [rows, setRows] = useState<InvRequest[]>([]);
  const { customers, contactsOf } = useCustomerDirectory();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const { data, error: e } = await supabase.from('inv_requests').select('*').order('submitted_on', { ascending: false }).order('pr_no', { ascending: false });
    if (e) setError(e.message);
    setRows((data as InvRequest[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  const refresh = async () => { await Promise.all([load(), reloadCore()]); };

  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'list' | 'links'>('list');

  const today = todayISO();
  const month = today.slice(0, 7);
  const isOpen = (r: InvRequest) => r.status === 'pending' || r.status === 'approved';
  const visible = rows.filter((r) => {
    if (filter === 'open' && !isOpen(r)) return false;
    if (filter !== 'open' && filter !== 'all' && r.status !== filter) return false;
    const q = search.trim().toLowerCase();
    return !q || [r.pr_no, r.do_no, r.employee, r.department, r.company_project, r.contact_name, r.delivery_address, r.item_name, r.remarks].join(' ').toLowerCase().includes(q);
  });

  const exportCsv = () => {
    downloadCsv(`requests_${today}.csv`, [
      ['PR Number', 'Submission Date', 'Employee', 'Department', 'Company / Project', 'Contact Person', 'Contact Phone', 'Delivery Address', 'Item', 'Qty', 'Required By', 'Remarks', 'Status', 'DO Number', 'Fulfilled On', 'Delivered By'],
      ...visible.map((r) => [r.pr_no, r.submitted_on, r.employee, r.department, r.company_project, r.contact_name ?? null, r.contact_phone ?? null, r.delivery_address, r.item_name, r.qty, r.required_by, r.remarks, REQ_META[r.status].label, r.do_no, r.fulfilled_on, r.delivered_by]),
    ]);
  };

  const open = openId ? rows.find((r) => r.id === openId) ?? null : null;
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontSize: 13 }}>Loading requests…</div>;
  if (view === 'links') return <RequestLinksView onBack={() => setView('list')} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <ErrorBanner text={error ?? coreErr} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <KPICard accent label="Open requests" value={rows.filter(isOpen).length} sub={`${rows.filter((r) => isOpen(r) && r.required_by && r.required_by < today).length} past their required date`} />
        <KPICard label="Fulfilled this month" value={rows.filter((r) => r.status === 'fulfilled' && (r.fulfilled_on ?? '').startsWith(month)).length} sub="Delivery orders issued" />
        <KPICard label="Migrated from Excel" value={rows.filter((r) => r.status === 'legacy').length} sub="No status was tracked — review & close" />
        <KPICard label="Item not in list" value={rows.filter((r) => !r.item_id && r.status !== 'cancelled').length} sub="Link to an item to fulfil from stock" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search PR, DO, company, item…" />
        {FILTERS.map((f) => <button key={f.id} onClick={() => setFilter(f.id)} style={pillBtn(filter === f.id)}>{f.label}</button>)}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {canDelete && <button onClick={() => setView('links')} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><QrCode size={13} /> Request link</button>}
          <button onClick={exportCsv} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={13} /> Export</button>
          {canEdit && <button onClick={() => setCreating(true)} style={{ ...primaryBtn(), display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> New request</button>}
        </div>
      </div>

      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead>
              <tr>{['PR', 'Submitted', 'Requested by', 'Company / Project', 'Item', 'Qty', 'Required by', 'Status'].map((h) => <th key={h} style={{ ...thStyle, textAlign: h === 'Qty' ? 'right' : 'left' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const meta = REQ_META[r.status];
                const late = isOpen(r) && r.required_by && r.required_by < today;
                return (
                  <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ borderBottom: '1px solid #F3F3F3', cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>
                      {r.pr_no}
                      {r.do_no && <div style={{ fontSize: 11, color: C.slate, fontWeight: 600 }}>{r.do_no}</div>}
                    </td>
                    <td style={{ ...tdStyle, color: C.slate, whiteSpace: 'nowrap' }}>{fmtD(r.submitted_on)}</td>
                    <td style={tdStyle}>{r.employee || '—'}<div style={{ fontSize: 11, color: C.slate }}>{r.department}</div></td>
                    <td style={tdStyle}>{r.company_project || '—'}<div style={{ fontSize: 11, color: C.slate, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[r.contact_name, r.delivery_address].filter(Boolean).join(' · ')}</div></td>
                    <td style={tdStyle}>
                      {r.item_name}
                      {!r.item_id && <div style={{ fontSize: 10, fontWeight: 700, color: '#B07D00', marginTop: 2 }}>NOT IN ITEM LIST</div>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{r.qty}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: late ? '#C0321A' : C.slate, fontWeight: late ? 700 : 400 }}>{fmtD(r.required_by)}</td>
                    <td style={tdStyle}><Pill bg={meta.bg} color={meta.color}>{meta.label}</Pill></td>
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center', color: C.slate, fontSize: 13 }}>No requests here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <RequestModal key={open.id} req={open} items={items} customers={customers} contactsOf={contactsOf} locations={locations} onHand={onHand} me={me}
          canEdit={canEdit} canDelete={canDelete} onClose={() => setOpenId(null)} onChanged={refresh} />
      )}
      {creating && (
        <RequestModal req={null} items={items} customers={customers} contactsOf={contactsOf} locations={locations} onHand={onHand} me={me}
          canEdit={canEdit} canDelete={false} onClose={() => setCreating(false)}
          onChanged={async () => { setCreating(false); await refresh(); }} />
      )}
    </div>
  );
}

function RequestModal({ req, items, customers, contactsOf, locations, onHand, me, canEdit, canDelete, onClose, onChanged }: {
  req: InvRequest | null; items: InvItem[]; customers: CustomerOpt[]; contactsOf: (customerId: string) => ContactOpt[];
  locations: InvLocation[]; onHand: OnHand; me: string;
  canEdit: boolean; canDelete: boolean; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const isNew = !req;
  const editable = canEdit && (isNew || req!.status === 'pending' || req!.status === 'approved' || req!.status === 'legacy');
  const [f, setF] = useState({
    submitted_on: req?.submitted_on ?? todayISO(),
    department: req?.department ?? '',
    customer_id: req?.customer_id ?? '',
    company_project: req?.company_project ?? '',
    contact_name: req?.contact_name ?? '',
    contact_phone: req?.contact_phone ?? '',
    delivery_address: req?.delivery_address ?? '',
    item_id: req?.item_id ?? '',
    item_name: req?.item_name ?? '',
    qty: String(req?.qty ?? 1),
    required_by: req?.required_by ?? '',
    remarks: req?.remarks ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | 'fulfil' | 'close' | 'delete' | 'revert'>(null);

  const item = items.find((i) => i.id === f.item_id) ?? null;
  const requester = req ? (req.employee ?? '—') : me;
  const customer = customers.find((c) => c.id === f.customer_id) ?? null;

  const pickCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    const first = contactsOf(c.id)[0];
    setF((x) => ({ ...x, customer_id: c.id, company_project: c.name, delivery_address: c.address ?? '', contact_name: first?.name ?? '', contact_phone: first?.phone ?? '' }));
  };

  const save = async (extra?: Partial<InvRequest>) => {
    const qty = Number(f.qty);
    if (!f.department) { setErr('Pick the department.'); return false; }
    if (!f.customer_id && (isNew || !f.company_project.trim())) { setErr('Pick the company from the customer list.'); return false; }
    if (!f.item_id && !f.item_name.trim()) { setErr('Pick an item, or type what is needed.'); return false; }
    if (!Number.isInteger(qty) || qty <= 0) { setErr('Quantity must be a whole number above zero.'); return false; }
    setBusy(true);
    setErr(null);
    const payload = {
      submitted_on: f.submitted_on || todayISO(),
      employee: requester === '—' ? null : requester, department: f.department || null,
      customer_id: f.customer_id || null,
      company_project: (customer ? customer.name : f.company_project).trim() || null,
      contact_name: f.contact_name.trim() || null, contact_phone: f.contact_phone.trim() || null,
      delivery_address: f.delivery_address.trim() || null,
      item_id: f.item_id || null,
      item_name: (item ? item.name : f.item_name).trim(),
      qty, required_by: f.required_by || null, remarks: f.remarks.trim() || null,
      updated_at: new Date().toISOString(),
      ...extra,
    };
    const error = isNew
      ? (await insertRequest({ ...payload, created_by: me })).error
      : (await supabase.from('inv_requests').update(payload).eq('id', req!.id)).error?.message;
    setBusy(false);
    if (error) { setErr(error); return false; }
    return true;
  };

  const setStatus = async (status: ReqStatus, extra?: Partial<InvRequest>) => {
    setBusy(true);
    const { error } = await supabase.from('inv_requests').update({ status, updated_at: new Date().toISOString(), ...extra }).eq('id', req!.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onChanged();
    onClose();
  };

  const remove = async () => {
    setBusy(true);
    const { error } = await supabase.from('inv_requests').delete().eq('id', req!.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onChanged();
    onClose();
  };

  const meta = req ? REQ_META[req.status] : null;
  const ro = !editable;

  return (
    <Modal title={isNew ? 'New stock request' : req!.pr_no} subtitle={isNew ? 'Replaces the Microsoft Forms purchase request' : `Submitted ${fmtD(req!.submitted_on)}${req!.created_by ? ` · logged by ${req!.created_by}` : ''}`}
      width={640} onClose={onClose}
      footer={editable ? (
        <>
          <button onClick={onClose} style={ghostBtn}>Close</button>
          <button onClick={async () => { if (await save()) { await onChanged(); if (!isNew) onClose(); } }} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Saving…' : isNew ? 'Submit request' : 'Save changes'}</button>
        </>
      ) : undefined}>
      <ErrorBanner text={err} />
      {meta && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Pill bg={meta.bg} color={meta.color}>{meta.label}</Pill>
          {req!.do_no && <span style={{ fontSize: 12, color: C.slate }}>Delivery order <b style={{ color: '#1a1a1a' }}>{req!.do_no}</b> · {fmtD(req!.fulfilled_on)}{req!.delivered_by ? ` · by ${req!.delivered_by}` : ''}{req!.fulfilled_location_id ? ` · from ${locations.find((l) => l.id === req!.fulfilled_location_id)?.name ?? ''}` : ''}</span>}
          {req!.void_do_nos && req!.void_do_nos.length > 0 && <span style={{ fontSize: 12, color: C.slate }}>Reverted: <s>{req!.void_do_nos.join(', ')}</s></span>}
        </div>
      )}
      {req?.delivery_note && <div style={{ fontSize: 12, color: C.slate }}>Delivery note: {req.delivery_note}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <Field label="Requested by">
          <div title="Set from the signed-in account — cannot be changed"
            style={{ ...inputStyle, background: C.seasalt, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={12} color={C.slate} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{requester}</span>
          </div>
        </Field>
        <Field label="Department">
          <SearchSelect value={f.department} disabled={ro} placeholder="Select department"
            options={REQ_DEPARTMENTS.concat(f.department && !REQ_DEPARTMENTS.includes(f.department) ? [f.department] : []).map((d) => ({ value: d, label: d }))}
            onChange={(v) => setF({ ...f, department: v })} />
        </Field>
        <Field label="Submitted"><input type="date" value={f.submitted_on} disabled={ro} onChange={(e) => setF({ ...f, submitted_on: e.target.value })} style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Company" hint={!f.customer_id && f.company_project ? `From Excel: "${f.company_project}" — pick the matching customer to link it` : undefined}>
          <SearchSelect value={f.customer_id} disabled={ro}
            options={customers.map((c) => ({ value: c.id, label: c.name, sub: c.address ?? undefined }))}
            onChange={pickCustomer} placeholder="Select customer…" emptyText="No customers match" />
        </Field>
        <ContactField value={f.contact_name} phone={f.contact_phone} contacts={customer ? contactsOf(customer.id) : []} hasCustomer={!!customer} disabled={ro}
          onChange={(name, phone) => setF({ ...f, contact_name: name, contact_phone: phone })} />
      </div>
      <DeliverToField value={f.delivery_address} disabled={ro} hasCustomer={!!customer} addressOnFile={customer?.address}
        onChange={(v) => setF({ ...f, delivery_address: v })} />
      <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 160px', gap: 12 }}>
          <Field label="Item" hint={!f.item_id && f.item_name ? `Requested as "${f.item_name}" — not in the item list yet` : item ? `${usableTotal(onHand, item.id, locations)} usable on hand` : undefined}>
            <ItemSelect items={items} value={f.item_id} onChange={(v) => setF({ ...f, item_id: v })} allowNone noneLabel={f.item_name && !f.item_id ? `${f.item_name} (not in list)` : 'Not in the item list'} disabled={ro} />
          </Field>
          <Field label="Qty"><input type="number" min="1" step="1" value={f.qty} disabled={ro} onChange={(e) => setF({ ...f, qty: e.target.value })} style={inputStyle} /></Field>
          <Field label="Required by"><input type="date" value={f.required_by} disabled={ro} onChange={(e) => setF({ ...f, required_by: e.target.value })} style={inputStyle} /></Field>
        </div>
        {!f.item_id && (
          <Field label="Describe the item"><input value={f.item_name} disabled={ro} onChange={(e) => setF({ ...f, item_name: e.target.value })} placeholder="e.g. Hici - Control Module - ZM029" style={inputStyle} /></Field>
        )}
      </div>
      <Field label="Remarks"><input value={f.remarks} disabled={ro} onChange={(e) => setF({ ...f, remarks: e.target.value })} style={inputStyle} /></Field>

      {/* Workflow actions */}
      {!isNew && canEdit && (
        <div style={{ borderTop: '1px solid #F3F3F3', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mode === null && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {req!.status === 'pending' && <button onClick={() => void setStatus('approved')} disabled={busy} style={ghostBtn}>Approve</button>}
              {(req!.status === 'pending' || req!.status === 'approved') && (
                <button onClick={() => setMode('fulfil')} disabled={busy} style={{ ...primaryBtn(busy), display: 'inline-flex', alignItems: 'center', gap: 6 }}><Truck size={14} /> Fulfil &amp; deliver</button>
              )}
              {req!.status === 'legacy' && (
                <>
                  <button onClick={() => setMode('close')} disabled={busy} style={ghostBtn}>Mark delivered (already issued)</button>
                  <button onClick={() => void setStatus('pending')} disabled={busy} style={ghostBtn}>Still needed — move to Pending</button>
                </>
              )}
              {req!.status !== 'fulfilled' && req!.status !== 'cancelled' && (
                <button onClick={() => void setStatus('cancelled')} disabled={busy} style={{ ...ghostBtn, color: '#C0321A' }}>Cancel request</button>
              )}
              {req!.status === 'cancelled' && <button onClick={() => void setStatus('pending')} disabled={busy} style={ghostBtn}>Reopen</button>}
              {canDelete && req!.status === 'fulfilled' && (
                <button onClick={() => setMode('revert')} disabled={busy} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><RotateCcw size={13} /> Revert to Pending</button>
              )}
              {canDelete && req!.status !== 'fulfilled' && <button onClick={() => setMode('delete')} style={{ ...ghostBtn, marginLeft: 'auto', color: '#C0321A' }}>Delete</button>}
            </div>
          )}
          {mode === 'fulfil' && (
            <FulfilForm req={req!} item={item} items={items} locations={locations} onHand={onHand} me={me}
              onCancel={() => setMode(null)} beforeFulfil={save}
              onDone={async () => { await onChanged(); onClose(); }} />
          )}
          {mode === 'close' && (
            <CloseLegacyForm onCancel={() => setMode(null)} busy={busy}
              onConfirm={(on, note) => void setStatus('fulfilled', { fulfilled_on: on, delivery_note: note || 'Closed during migration review — stock already issued before the move from Excel' })} />
          )}
          {mode === 'revert' && (
            <RevertForm req={req!} item={item} items={items} locations={locations} me={me}
              onCancel={() => setMode(null)} onDone={async () => { await onChanged(); onClose(); }} />
          )}
          {mode === 'delete' && (
            <div style={{ background: '#FDEAEA', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#C0321A' }}>Delete {req!.pr_no}? This can't be undone.</span>
              <button onClick={() => setMode(null)} style={ghostBtn}>Cancel</button>
              <button onClick={() => void remove()} disabled={busy} style={{ ...primaryBtn(busy), background: '#C0321A' }}>Yes, delete</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function FulfilForm({ req, item, items, locations, onHand, me, onCancel, beforeFulfil, onDone }: {
  req: InvRequest; item: InvItem | null; items: InvItem[]; locations: InvLocation[]; onHand: OnHand; me: string;
  onCancel: () => void; beforeFulfil: () => Promise<boolean>; onDone: () => Promise<void>;
}) {
  const best = item ? [...locations.filter((l) => l.usable)].sort((a, b) => qtyAt(onHand, item.id, b.id) - qtyAt(onHand, item.id, a.id))[0] : undefined;
  const [loc, setLoc] = useState(best?.id ?? '');
  const [date, setDate] = useState(todayISO());
  const [by, setBy] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const avail = item && loc ? qtyAt(onHand, item.id, loc) : 0;

  const go = async () => {
    if (!item) { setErr('Link this request to an item in the list first (Item field above), then save.'); return; }
    if (!loc) { setErr('Pick the location the stock leaves from.'); return; }
    setBusy(true);
    setErr(null);
    if (!(await beforeFulfil())) { setBusy(false); return; }
    const { error } = await supabase.rpc('inv_fulfil_request', {
      p_request: req.id, p_location: loc, p_date: date, p_delivered_by: by.trim() || null, p_note: note.trim() || null, p_by: me,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onDone();
  };

  return (
    <div style={{ background: C.honeydew, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Fulfil {req.qty} × {item ? itemLabel(item, items) : req.item_name}</div>
      <ErrorBanner text={err} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Field label="Issue from" hint={item && loc && avail < req.qty ? `Only ${avail} here — this will take the location negative` : undefined}>
          <LocationSelect locations={locations} value={loc} onChange={setLoc} itemId={item?.id} onHand={onHand} up />
        </Field>
        <Field label="Delivery / collection date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></Field>
        <Field label="Delivered by"><input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Driver / technician / self collect" style={inputStyle} /></Field>
      </div>
      <Field label="Delivery note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — received by, remarks" style={inputStyle} /></Field>
      <div style={{ fontSize: 11, color: C.slate }}>Issues the stock from the chosen location and assigns a delivery-order number.</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtn}>Back</button>
        <button onClick={() => void go()} disabled={busy} style={primaryBtn(busy)}>{busy ? 'Issuing…' : 'Confirm fulfilment'}</button>
      </div>
    </div>
  );
}

// Admin undo of a fulfilment: the stock goes back where it was issued from and
// the DO number is voided (never re-issued). Done in one RPC so it can't half-apply.
function RevertForm({ req, item, items, locations, me, onCancel, onDone }: {
  req: InvRequest; item: InvItem | null; items: InvItem[]; locations: InvLocation[]; me: string;
  onCancel: () => void; onDone: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = locations.find((l) => l.id === req.fulfilled_location_id);

  const go = async () => {
    if (!reason.trim()) { setErr('Give a reason — it is saved to the stock ledger.'); return; }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc('inv_revert_fulfilment', { p_request: req.id, p_reason: reason.trim(), p_by: me });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await onDone();
  };

  return (
    <div style={{ background: '#FFF8E1', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#B07D00' }}>Revert {req.do_no ?? req.pr_no} to Pending?</div>
      <div style={{ fontSize: 12, color: '#1a1a1a', lineHeight: 1.5 }}>
        {req.do_no && from
          ? <>{req.qty} × {item ? itemLabel(item, items) : req.item_name} goes back into <b>{from.name}</b> stock. </>
          : <>No stock was issued through the app for this request, so stock levels don't change. </>}
        {req.do_no && <>Delivery order {req.do_no} is voided and won't be reused. </>}
        The request returns to Pending and can be fulfilled again.
      </div>
      <ErrorBanner text={err} />
      <Field label="Reason (saved to the ledger)">
        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong item delivered, customer postponed" style={inputStyle} />
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        <button onClick={() => void go()} disabled={busy} style={{ ...primaryBtn(busy), background: busy ? '#ccc' : '#B07D00', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RotateCcw size={13} /> {busy ? 'Reverting…' : 'Yes, revert'}
        </button>
      </div>
    </div>
  );
}

function CloseLegacyForm({ onCancel, onConfirm, busy }: { onCancel: () => void; onConfirm: (on: string, note: string) => void; busy: boolean }) {
  const [on, setOn] = useState(todayISO());
  const [note, setNote] = useState('');
  return (
    <div style={{ background: C.seasalt, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12.5, color: '#1a1a1a' }}>
        Closes this migrated request as delivered <b>without touching stock</b> — the Excel stock figures already reflect it.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 12 }}>
        <Field label="Delivered on"><input type="date" value={on} onChange={(e) => setOn(e.target.value)} style={inputStyle} /></Field>
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtn}>Back</button>
        <button onClick={() => onConfirm(on, note.trim())} disabled={busy} style={primaryBtn(busy)}>Mark delivered</button>
      </div>
    </div>
  );
}
