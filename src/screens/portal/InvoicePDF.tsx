import { Document, Page, View, Text, Image as PdfImage } from '@react-pdf/renderer';
import evoneLogoUrl from '../../assets/evone-logo.png';
import {
  pdfGreen, pdfHoneydew, pdfSlate, pdfBorder, pdfBorderW,
  bAll, bRight, bBottom,
  fmtMonthLabel, fmtKwh, fmtAmt, fmtRate,
} from './pdfShared';
import type { PortalStatementData } from './types';

interface Props {
  stmt: PortalStatementData;
  billingMonth: string;
  invoiceNumber: string;
  issuedAt: Date;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function InvoicePDF({ stmt, billingMonth, invoiceNumber, issuedAt }: Props) {
  const { company, totalKwh, appliedRate, totalAmount } = stmt;
  const dueDate = addDays(issuedAt, 30);

  return (
    <Document>
      <Page size="A4" style={{ fontFamily: 'Helvetica', padding: 40, backgroundColor: '#FFFFFF' }}>

        {/* ── Top header: logo left, INVOICE block right ── */}
        <View style={{ flexDirection: 'row', marginBottom: 24 }}>
          <View style={{ flex: 1 }}>
            <PdfImage src={evoneLogoUrl} style={{ height: 44, width: 180 }} />
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 24, fontWeight: 'bold', color: pdfGreen, letterSpacing: 4 }}>INVOICE</Text>
            <Text style={{ fontSize: 10, color: pdfSlate, marginTop: 8 }}>Invoice No: <Text style={{ color: '#1a1a1a', fontWeight: 'bold' }}>{invoiceNumber}</Text></Text>
            <Text style={{ fontSize: 10, color: pdfSlate, marginTop: 2 }}>Issue Date: <Text style={{ color: '#1a1a1a' }}>{fmtDate(issuedAt)}</Text></Text>
            <Text style={{ fontSize: 10, color: pdfSlate, marginTop: 2 }}>Due Date: <Text style={{ color: '#1a1a1a' }}>{fmtDate(dueDate)}</Text></Text>
          </View>
        </View>

        {/* ── From / Bill To row ── */}
        <View style={{ flexDirection: 'row', marginBottom: 24 }}>
          <View style={{ flex: 1, marginRight: 24 }}>
            <Text style={{ fontSize: 9, fontWeight: 'bold', color: pdfSlate, marginBottom: 4 }}>FROM</Text>
            <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#1a1a1a' }}>EVOne Pte Ltd</Text>
            <Text style={{ fontSize: 10, color: '#1a1a1a', marginTop: 2 }}>1 North Bridge Road</Text>
            <Text style={{ fontSize: 10, color: '#1a1a1a' }}>#08-08, High Street Centre</Text>
            <Text style={{ fontSize: 10, color: '#1a1a1a' }}>Singapore 179094</Text>
            <Text style={{ fontSize: 10, color: pdfSlate, marginTop: 4 }}>billing@evone.com.sg</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, fontWeight: 'bold', color: pdfSlate, marginBottom: 4 }}>BILL TO</Text>
            <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#1a1a1a' }}>{company.name}</Text>
            <Text style={{ fontSize: 10, color: pdfSlate, marginTop: 2 }}>Billing Period: <Text style={{ color: '#1a1a1a' }}>{fmtMonthLabel(billingMonth)}</Text></Text>
          </View>
        </View>

        {/* ── Line items table ── */}
        <View style={{ ...bAll, marginBottom: 18 }}>
          <View style={{ flexDirection: 'row', backgroundColor: pdfHoneydew, ...bBottom }}>
            <View style={{ width: '52%', paddingVertical: 8, paddingHorizontal: 10, ...bRight }}>
              <Text style={{ fontSize: 9, fontWeight: 'bold', color: pdfSlate }}>DESCRIPTION</Text>
            </View>
            <View style={{ width: '16%', paddingVertical: 8, paddingHorizontal: 10, ...bRight }}>
              <Text style={{ fontSize: 9, fontWeight: 'bold', color: pdfSlate, textAlign: 'right' }}>QTY (kWh)</Text>
            </View>
            <View style={{ width: '16%', paddingVertical: 8, paddingHorizontal: 10, ...bRight }}>
              <Text style={{ fontSize: 9, fontWeight: 'bold', color: pdfSlate, textAlign: 'right' }}>RATE</Text>
            </View>
            <View style={{ width: '16%', paddingVertical: 8, paddingHorizontal: 10 }}>
              <Text style={{ fontSize: 9, fontWeight: 'bold', color: pdfSlate, textAlign: 'right' }}>AMOUNT</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: '52%', paddingVertical: 10, paddingHorizontal: 10, ...bRight }}>
              <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#1a1a1a' }}>Corporate EV Charging</Text>
              <Text style={{ fontSize: 9, color: pdfSlate, marginTop: 2 }}>{fmtMonthLabel(billingMonth)} — combined GoParkin + SP sessions</Text>
              <Text style={{ fontSize: 9, color: pdfSlate, marginTop: 2 }}>Applied tier: {totalKwh >= Number(company.threshold_kwh) ? 'Discounted (above threshold)' : 'Base rate'}</Text>
            </View>
            <View style={{ width: '16%', paddingVertical: 10, paddingHorizontal: 10, ...bRight }}>
              <Text style={{ fontSize: 10, color: '#1a1a1a', textAlign: 'right' }}>{fmtKwh(totalKwh)}</Text>
            </View>
            <View style={{ width: '16%', paddingVertical: 10, paddingHorizontal: 10, ...bRight }}>
              <Text style={{ fontSize: 10, color: '#1a1a1a', textAlign: 'right' }}>{fmtRate(appliedRate)}</Text>
            </View>
            <View style={{ width: '16%', paddingVertical: 10, paddingHorizontal: 10 }}>
              <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#1a1a1a', textAlign: 'right' }}>{fmtAmt(totalAmount)}</Text>
            </View>
          </View>
        </View>

        {/* ── Totals box (right-aligned) ── */}
        <View style={{ flexDirection: 'row', marginBottom: 24 }}>
          <View style={{ flex: 1 }} />
          <View style={{ width: '40%' }}>
            <View style={{ flexDirection: 'row', paddingVertical: 6, ...bBottom }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 10, color: pdfSlate }}>Subtotal</Text>
              </View>
              <View>
                <Text style={{ fontSize: 10, color: '#1a1a1a' }}>{fmtAmt(totalAmount)}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', paddingVertical: 10, backgroundColor: pdfHoneydew, paddingHorizontal: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: 'bold', color: pdfGreen }}>TOTAL DUE</Text>
              </View>
              <View>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: pdfGreen }}>{fmtAmt(totalAmount)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Payment terms + bank details ── */}
        <View style={{ borderTopWidth: pdfBorderW, borderTopColor: pdfBorder, borderTopStyle: 'solid', paddingTop: 14 }}>
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: pdfGreen, marginBottom: 6 }}>Payment Terms</Text>
          <Text style={{ fontSize: 9, color: '#1a1a1a', lineHeight: 1.4 }}>
            Net 30. Payment is due within 30 days of the issue date. Please reference the invoice number ({invoiceNumber}) when making payment.
          </Text>
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: pdfGreen, marginTop: 14, marginBottom: 6 }}>Bank Details</Text>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1, marginRight: 24 }}>
              <Text style={{ fontSize: 9, color: pdfSlate }}>Bank</Text>
              <Text style={{ fontSize: 10, color: '#1a1a1a' }}>DBS Bank Singapore</Text>
              <Text style={{ fontSize: 9, color: pdfSlate, marginTop: 6 }}>Account Name</Text>
              <Text style={{ fontSize: 10, color: '#1a1a1a' }}>EVOne Pte Ltd</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 9, color: pdfSlate }}>Account Number</Text>
              <Text style={{ fontSize: 10, color: '#1a1a1a' }}>000-000000-0</Text>
              <Text style={{ fontSize: 9, color: pdfSlate, marginTop: 6 }}>Swift Code</Text>
              <Text style={{ fontSize: 10, color: '#1a1a1a' }}>DBSSSGSG</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={{ position: 'absolute', bottom: 24, left: 40, right: 40, alignItems: 'center' }}>
          <Text style={{ fontSize: 8, color: pdfSlate }}>Thank you for choosing EVOne. For questions, contact billing@evone.com.sg.</Text>
        </View>
      </Page>
    </Document>
  );
}
