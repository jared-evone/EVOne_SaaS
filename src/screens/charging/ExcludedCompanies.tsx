import { useEffect, useMemo, useState } from 'react';
import { C } from '../../theme';
import { supabase } from '../../lib/supabase';
import { clearExcludedVehiclesCache, normalizePlate, getCachedChargingRows } from './LocationTrends';

interface Company { id: string; name: string; }
interface Vehicle { vehicle_plate: string | null; company_id: string | null; }

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ExcludedCompanies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [excluded, setExcluded] = useState<{ company_id: string; created_at: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [{ data: co }, { data: ve }, { data: ex, error: exErr }] = await Promise.all([
      supabase.from('crm_companies').select('id, name').order('name'),
      supabase.from('crm_vehicles').select('vehicle_plate, company_id'),
      supabase.from('charging_excluded_companies').select('company_id, created_at').order('created_at', { ascending: false }),
    ]);
    if (exErr) setError(exErr.message);
    setCompanies((co as Company[]) ?? []);
    setVehicles((ve as Vehicle[]) ?? []);
    setExcluded((ex as { company_id: string; created_at: string }[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);

  const vehiclesByCompany = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of vehicles) {
      if (!v.company_id) continue;
      const p = normalizePlate(v.vehicle_plate);
      if (!p) continue;
      const arr = m.get(v.company_id);
      if (arr) arr.push(p);
      else m.set(v.company_id, [p]);
    }
    return m;
  }, [vehicles]);

  // Records per plate from the shared cache (if warmed) → records excluded per company.
  const recordCounts = useMemo(() => {
    const rows = getCachedChargingRows();
    if (!rows) return null;
    const m = new Map<string, number>();
    for (const r of rows) {
      const p = normalizePlate(r.vehicle_plate_number);
      if (p) m.set(p, (m.get(p) ?? 0) + 1);
    }
    return m;
  }, [excluded]);

  const recordsForCompany = (companyId: string): number | null => {
    if (!recordCounts) return null;
    let n = 0;
    for (const p of vehiclesByCompany.get(companyId) ?? []) n += recordCounts.get(p) ?? 0;
    return n;
  };

  const excludedIds = useMemo(() => new Set(excluded.map((e) => e.company_id)), [excluded]);

  const addable = useMemo(
    () => companies.filter((c) => !excludedIds.has(c.id) && (vehiclesByCompany.get(c.id)?.length ?? 0) > 0),
    [companies, excludedIds, vehiclesByCompany],
  );

  const add = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('charging_excluded_companies').insert({ company_id: selected });
    if (err) setError(/duplicate|unique|primary key/i.test(err.message) ? 'That company is already excluded.' : err.message);
    else { setSelected(''); clearExcludedVehiclesCache(); await load(); }
    setBusy(false);
  };

  const remove = async (companyId: string) => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('charging_excluded_companies').delete().eq('company_id', companyId);
    if (err) setError(err.message);
    else { clearExcludedVehiclesCache(); await load(); }
    setBusy(false);
  };

  const totalExcludedVehicles = excluded.reduce((s, e) => s + (vehiclesByCompany.get(e.company_id)?.length ?? 0), 0);

  const th: React.CSSProperties = {
    padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate,
    letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, borderBottom: '1px solid #F3F3F3' };
  const selectStyle: React.CSSProperties = {
    padding: '9px 14px', borderRadius: 10, border: '1px solid #EBEBEB', fontFamily: 'Figtree',
    fontSize: 13, outline: 'none', background: C.white, cursor: 'pointer', minWidth: 280,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {/* Add form */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Excluded Companies</div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
            Select a company from the corporate CRM to exclude. All of its vehicles are removed from the Overview, Energy (kWh) and Sessions tabs when the “Exclude Vehicles” toggle is on.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Company</label>
            <select value={selected} onChange={(e) => setSelected(e.target.value)} style={selectStyle}>
              <option value="">— Select a company —</option>
              {addable.map((c) => {
                const n = vehiclesByCompany.get(c.id)?.length ?? 0;
                return <option key={c.id} value={c.id}>{c.name} ({n} vehicle{n === 1 ? '' : 's'})</option>;
              })}
            </select>
          </div>
          <button onClick={add} disabled={busy || !selected}
            style={{ padding: '9px 22px', borderRadius: 10, border: 'none',
              background: busy || !selected ? '#ccc' : C.green, color: C.white,
              fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: busy || !selected ? 'default' : 'pointer' }}>
            + Exclude Company
          </button>
          {addable.length === 0 && !loading && (
            <span style={{ fontSize: 12, color: C.slate, paddingBottom: 9 }}>All companies with vehicles are already excluded.</span>
          )}
        </div>
      </div>

      {/* Summary */}
      <div style={{ fontSize: 13, color: C.slate, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span><strong style={{ color: '#1a1a1a' }}>{excluded.length}</strong> compan{excluded.length === 1 ? 'y' : 'ies'} excluded</span>
        <span><strong style={{ color: '#1a1a1a' }}>{totalExcludedVehicles}</strong> vehicle{totalExcludedVehicles === 1 ? '' : 's'} affected</span>
      </div>

      {/* List */}
      <div style={{ background: C.white, borderRadius: 16, border: '1px solid #EBEBEB', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr style={{ background: C.seasalt }}>
              <th style={th}>Company</th>
              <th style={th}>Vehicles</th>
              <th style={th}>Records</th>
              <th style={th}>Excluded On</th>
              <th style={{ ...th, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: C.slate, padding: '40px 16px' }}>Loading…</td></tr>
            ) : excluded.length === 0 ? (
              <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: C.slate, padding: '40px 16px' }}>
                No companies excluded yet. Select one above.
              </td></tr>
            ) : (
              excluded.map((e) => {
                const recs = recordsForCompany(e.company_id);
                const vn = vehiclesByCompany.get(e.company_id)?.length ?? 0;
                return (
                  <tr key={e.company_id}
                    onMouseEnter={(ev) => { ev.currentTarget.style.background = '#FAFAFA'; }}
                    onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent'; }}>
                    <td style={{ ...td, fontWeight: 700, color: C.green }}>{companyById.get(e.company_id) ?? '(unknown company)'}</td>
                    <td style={{ ...td, color: '#1a1a1a' }}>{vn}</td>
                    <td style={{ ...td, color: C.slate }}>{recs != null ? recs.toLocaleString() : '—'}</td>
                    <td style={{ ...td, color: C.slate, whiteSpace: 'nowrap' }}>{fmtDate(e.created_at)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={() => remove(e.company_id)} disabled={busy}
                        style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #FDEAEA', background: C.white, color: '#C0321A', fontFamily: 'Figtree', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
                        Remove
                      </button>
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
