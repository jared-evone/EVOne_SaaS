export interface PortalAccount {
  id: string;
  company_id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  crm_companies?: { name: string } | null;
}

export type DocType = 'statement' | 'invoice';

export interface PortalDocument {
  id: string;
  company_id: string;
  billing_month: string;
  doc_type: DocType;
  invoice_number: string | null;
  statement_data: PortalStatementData;
  pdf_base64: string;
  total_kwh: number;
  total_amount: number;
  applied_rate: number;
  issued_at: string;
  issued_by: string | null;
}

// Mirror of CompanyStatement from CorporateInvoicing.tsx — kept here so the portal
// is decoupled from the screen's internal types when persisting to JSONB.
export interface PortalStatementData {
  company: {
    id: string;
    name: string;
    base_rate: number;
    threshold_kwh: number;
    discounted_rate: number;
  };
  goparkinRows: Array<{ plate: string; location: string; start: string; end: string; kwh: number }>;
  spRows: Array<{ driverEmail: string; location: string; startDateTime: string; endDateTime: string; energyKwh: number }>;
  totalKwh: number;
  appliedRate: number;
  totalAmount: number;
}
