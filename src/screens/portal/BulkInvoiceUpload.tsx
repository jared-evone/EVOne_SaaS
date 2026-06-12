import { useState } from 'react';
import { C } from '../../theme';
import { Upload as UploadIcon } from 'lucide-react';
import { blobToBase64, uploadInvoiceForCompany } from './portalDb';
import { analyzeInvoicePdf, type Confidence } from './bulkInvoice';

interface Company { id: string; name: string; }

interface Row {
  id: string;
  fileName: string;
  base64: string;
  companyId: string;
  billingMonth: string;
  invoiceNumber: string;
  amount: string;
  confidence: Confidence;
  errored: boolean;
}

interface BulkInvoiceUploadProps {
  companies: Company[];
  onClose: () => void;
  onUploaded: () => void;
}

const CONF_STYLE: Record<Confidence, { bg: string; color: string; label: string }> = {
  high:   { bg: '#E4F3E3', color: '#1B512D', label: 'High match' },
  medium: { bg: '#FFF8E1', color: '#B07D00', label: 'Check match' },
  low:    { bg: '#FDEAEA', color: '#C0321A', label: 'No match' },
};

export function BulkInvoiceUpload({ companies, onClose, onUploaded }: BulkInvoiceUploadProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [parsing, setParsing] = useState<{ done: number; total: number } | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setError(null);
    setResult(null);
    setParsing({ done: 0, total: files.length });
    const out: Row[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base64 = await blobToBase64(file);
      let row: Row;
      try {
        const ex = await analyzeInvoicePdf(base64, companies);
        row = {
          id: `${Date.now()}-${i}-${file.name}`,
          fileName: file.name,
          base64,
          companyId: ex.companyId ?? '',
          billingMonth: ex.billingMonth,
          invoiceNumber: ex.invoiceNumber,
          amount: ex.amount,
          confidence: ex.confidence,
          errored: false,
        };
      } catch (err) {
        setError(`Some files could not be analysed: ${(err as Error).message ?? 'unknown error'}`);
        row = {
          id: `${Date.now()}-${i}-${file.name}`,
          fileName: file.name,
          base64,
          companyId: '', billingMonth: '', invoiceNumber: '', amount: '',
          confidence: 'low', errored: true,
        };
      }
      out.push(row);
      setParsing({ done: i + 1, total: files.length });
    }
    setRows((prev) => [...prev, ...out]);
    setParsing(null);
  };

  const patch = (id: string, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));

  const isComplete = (r: Row) => !!r.companyId && !!r.billingMonth && !!r.invoiceNumber.trim();
  const completeRows = rows.filter(isComplete);

  const doUpload = async () => {
    if (completeRows.length === 0) return;
    setError(null);
    setResult(null);
    setUploading({ done: 0, total: completeRows.length });
    let ok = 0;
    try {
      for (let i = 0; i < completeRows.length; i++) {
        const r = completeRows[i];
        await uploadInvoiceForCompany({
          company_id: r.companyId,
          billing_month: r.billingMonth,
          invoice_number: r.invoiceNumber.trim(),
          pdf_base64: r.base64,
          total_amount_override: r.amount.trim() ? parseFloat(r.amount) : undefined,
        });
        ok++;
        setUploading({ done: i + 1, total: completeRows.length });
      }
      setResult(`Uploaded ${ok} invoice${ok !== 1 ? 's' : ''}.`);
      const uploadedIds = new Set(completeRows.map((r) => r.id));
      setRows((rs) => rs.filter((r) => !uploadedIds.has(r.id)));
      onUploaded();
    } catch (e) {
      setError(`Upload failed after ${ok} invoice${ok !== 1 ? 's' : ''}: ${(e as Error).message ?? 'unknown error'}`);
    } finally {
      setUploading(null);
    }
  };

  const incompleteCount = rows.length - completeRows.length;

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #EBEBEB',
    fontFamily: 'Figtree', fontSize: 12, outline: 'none', boxSizing: 'border-box', background: C.white,
  };
  const th: React.CSSProperties = {
    padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.slate,
    letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12, borderBottom: '1px solid #F3F3F3', verticalAlign: 'middle' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 28, width: 1040, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>Bulk Upload Invoices</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
              Drop in a batch of invoice PDFs — Claude reads each one and auto-fills the company, billing month, invoice number and amount. Review and fix any flagged rows before uploading.
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F3F3', cursor: 'pointer', fontSize: 18, fontFamily: 'Figtree' }}>×</button>
        </div>

        {/* File picker */}
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px', borderRadius: 12, border: `1.5px dashed ${C.green}`, background: C.honeydew, color: C.green, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <UploadIcon size={16} strokeWidth={2.25} />
          {rows.length > 0 ? 'Add more invoice PDFs' : 'Select invoice PDFs (you can pick many)'}
          <input type="file" accept="application/pdf,.pdf" multiple style={{ display: 'none' }} onChange={handleFiles} />
        </label>

        {parsing && (
          <div style={{ background: C.seasalt, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: C.slate, fontWeight: 600 }}>
            Reading PDFs with Claude… {parsing.done} / {parsing.total}
          </div>
        )}
        {error && <div style={{ background: '#FDEAEA', color: '#C0321A', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{error}</div>}
        {result && <div style={{ background: C.honeydew, color: C.green, borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>✓ {result}</div>}

        {rows.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: C.slate, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span><strong style={{ color: '#1a1a1a' }}>{rows.length}</strong> file{rows.length !== 1 ? 's' : ''}</span>
              <span><strong style={{ color: C.green }}>{completeRows.length}</strong> ready</span>
              {incompleteCount > 0 && <span style={{ color: '#B07D00', fontWeight: 700 }}>{incompleteCount} need a company, month or invoice no.</span>}
            </div>

            <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, overflow: 'auto', maxHeight: '50vh' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 770 }}>
                <thead>
                  <tr style={{ background: C.seasalt, position: 'sticky', top: 0, zIndex: 1 }}>
                    <th style={th}>File</th>
                    <th style={th}>Match</th>
                    <th style={{ ...th, minWidth: 220 }}>Company</th>
                    <th style={th}>Billing Month</th>
                    <th style={th}>Invoice No.</th>
                    <th style={th}>Amount</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const conf = CONF_STYLE[r.confidence];
                    const complete = isComplete(r);
                    return (
                      <tr key={r.id} style={{ background: complete ? 'transparent' : '#FFFCF5' }}>
                        <td style={{ ...td, maxWidth: 200 }}>
                          <div title={r.fileName} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1a1a1a' }}>{r.fileName}</div>
                          {r.errored && <div style={{ fontSize: 10, color: '#C0321A', marginTop: 2 }}>Analysis failed — fill manually</div>}
                        </td>
                        <td style={td}>
                          <span style={{ background: conf.bg, color: conf.color, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>{conf.label}</span>
                        </td>
                        <td style={td}>
                          <select value={r.companyId} onChange={(e) => patch(r.id, { companyId: e.target.value })}
                            style={{ ...inputStyle, cursor: 'pointer' }}>
                            <option value="">— Select company —</option>
                            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </td>
                        <td style={td}>
                          <input type="month" value={r.billingMonth} onChange={(e) => patch(r.id, { billingMonth: e.target.value })}
                            style={{ ...inputStyle, cursor: 'pointer', minWidth: 130 }} />
                        </td>
                        <td style={td}>
                          <input value={r.invoiceNumber} onChange={(e) => patch(r.id, { invoiceNumber: e.target.value })} placeholder="Invoice no."
                            style={{ ...inputStyle, minWidth: 120 }} />
                        </td>
                        <td style={td}>
                          <input type="number" step="0.01" value={r.amount} onChange={(e) => patch(r.id, { amount: e.target.value })} placeholder="Optional"
                            style={{ ...inputStyle, minWidth: 90 }} />
                        </td>
                        <td style={td}>
                          <button onClick={() => removeRow(r.id)}
                            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #EBEBEB', background: C.white, color: C.slate, fontFamily: 'Figtree', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
          {uploading && (
            <span style={{ marginRight: 'auto', fontSize: 13, color: C.green, fontWeight: 700 }}>Uploading {uploading.done} / {uploading.total}…</span>
          )}
          <button onClick={onClose}
            style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: 'transparent', color: C.slate, fontFamily: 'Figtree', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Close
          </button>
          <button onClick={doUpload} disabled={!!uploading || !!parsing || completeRows.length === 0}
            style={{ padding: '9px 24px', borderRadius: 10, border: 'none',
              background: (!!uploading || !!parsing || completeRows.length === 0) ? '#ccc' : C.green,
              color: C.white, fontFamily: 'Figtree', fontSize: 13, fontWeight: 700,
              cursor: (!!uploading || !!parsing || completeRows.length === 0) ? 'default' : 'pointer' }}>
            {uploading ? 'Uploading…' : `Upload ${completeRows.length} Invoice${completeRows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
