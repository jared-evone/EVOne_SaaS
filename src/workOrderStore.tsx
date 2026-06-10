import { createContext, useContext, useState, type ReactNode } from 'react';

// ── Types ─────────────────────────────────────────────────────────

export type WorkOrderStatus =
  | 'open'        // unassigned, awaiting pickup
  | 'assigned'    // picked up, not started
  | 'in_progress' // technician on-site / filling form
  | 'submitted'   // technician submitted, awaiting PIC review
  | 'reviewed'    // PIC amended, ready to approve
  | 'completed';  // approved, archived

export type FieldType = 'section' | 'text' | 'textarea' | 'checkbox' | 'photo' | 'group';

export type TemplateKind = 'structured' | 'overlay';

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  // Group-only: a checkbox question bundled with a photo + a remarks text.
  // Sub-values are stored under `${id}::photo` and `${id}::remark`.
  photoLabel?: string;
  remarkLabel?: string;
  // Overlay-only positioning (percent of form image, 0-100)
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface FormTemplate {
  id: string;
  name: string;
  description: string;
  kind?: TemplateKind;        // undefined treated as 'structured' (backwards compat)
  fields: FormField[];
  // Overlay-only
  imageSrc?: string;          // data URL (frontend-only mock)
  imageWidth?: number;
  imageHeight?: number;
}

export type FormValues = Record<string, string | boolean>;

export interface FormResponse {
  values: FormValues;
  submittedAt?: string;
  submittedBy?: string;
  editedAt?: string;
  editedBy?: string;
}

// Sentinel templateId for non-templated jobs whose report is a manually-uploaded PDF.
export const OTHER_FORM_ID = 'other';

export interface WorkOrder {
  id: string;
  title: string;
  customerId: string | null;   // link to Customer registry (preferred)
  customer: string;            // denormalised name for display + legacy
  address: string;
  product?: string;
  scheduledDate: string;
  priority: 'low' | 'normal' | 'high';
  status: WorkOrderStatus;
  assignedTo: string | null;
  templateId: string;          // a FormTemplate id, or OTHER_FORM_ID for PDF-report jobs
  // Non-templated ("Other") jobs carry a manually-uploaded PDF report instead of a form.
  reportFileName?: string;
  reportPdfBase64?: string;
  response: FormResponse | null;
}

export type CustomerType = 'Residential' | 'Commercial' | 'Enterprise';

export interface Customer {
  id: string;
  name: string;
  type: CustomerType;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

// ── Seed data ─────────────────────────────────────────────────────

const CHARGER_INSTALL_TEMPLATE: FormTemplate = {
  id: 'tpl-charger-install',
  name: 'EV Charger Installation Report',
  description: 'Standard report for residential / commercial AC charger installs.',
  fields: [
    { id: 'sec_site', type: 'section', label: 'Site & Customer Information' },
    { id: 'customer_name',   type: 'text',     label: 'Customer Name', required: true },
    { id: 'install_address', type: 'text',     label: 'Installation Address', required: true },
    { id: 'install_date',    type: 'text',     label: 'Date of Installation' },
    { id: 'serial_number',   type: 'text',     label: 'Charger Serial No.' },

    { id: 'sec_pre', type: 'section', label: 'Pre-installation Checks' },
    { id: 'pre_db_inspected',   type: 'checkbox', label: 'DB / consumer unit inspected' },
    { id: 'pre_earthing',       type: 'checkbox', label: 'Earthing tested (< 10 Ω)' },
    { id: 'pre_supply_capacity',type: 'checkbox', label: 'Supply capacity sufficient (1-ph / 3-ph)' },
    { id: 'pre_breaker',        type: 'checkbox', label: 'Dedicated MCB / RCD specified' },
    { id: 'pre_route',          type: 'checkbox', label: 'Cable route surveyed & agreed with customer' },

    { id: 'sec_install', type: 'section', label: 'Installation Steps' },
    { id: 'inst_mounted', type: 'checkbox', label: 'Wallbox mounted to wall / pole' },
    { id: 'inst_cabling', type: 'checkbox', label: 'Cabling pulled, glanded, terminated' },
    { id: 'inst_mcb',     type: 'checkbox', label: 'MCB / RCBO installed at DB' },
    { id: 'inst_earth',   type: 'checkbox', label: 'Earth lead bonded & continuity verified' },
    { id: 'inst_ip_seal', type: 'checkbox', label: 'IP67 seal verified, glands tight' },

    { id: 'sec_post', type: 'section', label: 'Post-installation Tests' },
    { id: 'post_powered',     type: 'checkbox', label: 'Power on, no fault LED' },
    { id: 'post_charge_test', type: 'checkbox', label: 'Charge session test passed (min 5 min)' },
    { id: 'post_rcd',         type: 'checkbox', label: 'RCD trip test passed' },
    { id: 'post_app',         type: 'checkbox', label: 'App pairing / OCPP backend connected' },
    { id: 'post_walkthrough', type: 'checkbox', label: 'Customer walkthrough completed' },

    { id: 'sec_notes', type: 'section', label: 'Technician Notes' },
    { id: 'notes', type: 'textarea', label: 'Observations, deviations, follow-ups' },

    { id: 'sec_signoff', type: 'section', label: 'Sign-off' },
    { id: 'tech_signature',     type: 'text', label: 'Technician Name',          required: true },
    { id: 'customer_signature', type: 'text', label: 'Customer Sign-off (Name)' },
  ],
};

const MAINTENANCE_TEMPLATE: FormTemplate = {
  id: 'tpl-maintenance',
  name: 'Annual Maintenance Service',
  description: 'Periodic check for installed chargers under maintenance contract.',
  fields: [
    { id: 'sec_visit', type: 'section', label: 'Visit Details' },
    { id: 'customer_name',  type: 'text', label: 'Customer Name', required: true },
    { id: 'serial_number',  type: 'text', label: 'Charger Serial No.' },
    { id: 'visit_date',     type: 'text', label: 'Visit Date' },

    { id: 'sec_check', type: 'section', label: 'Maintenance Checks' },
    { id: 'chk_enclosure', type: 'checkbox', label: 'Enclosure clean & undamaged' },
    { id: 'chk_torque',    type: 'checkbox', label: 'Terminal torque verified' },
    { id: 'chk_rcd_test',  type: 'checkbox', label: 'RCD trip test passed' },
    { id: 'chk_firmware',  type: 'checkbox', label: 'Firmware up-to-date' },
    { id: 'chk_session',   type: 'checkbox', label: 'Test charge session completed' },

    { id: 'sec_findings', type: 'section', label: 'Findings & Recommendations' },
    { id: 'findings', type: 'textarea', label: 'Any issues found, parts replaced, recommendations' },

    { id: 'sec_sign', type: 'section', label: 'Sign-off' },
    { id: 'tech_signature', type: 'text', label: 'Technician Name', required: true },
  ],
};

const INITIAL_TEMPLATES: FormTemplate[] = [CHARGER_INSTALL_TEMPLATE, MAINTENANCE_TEMPLATE];

const INITIAL_WORK_ORDERS: WorkOrder[] = [
  { id: 'WO-2026-0142', title: '7kW Wallbox install',     customerId: 'cust-ahmad',    customer: 'Ahmad Razif',     address: 'Jln Riong, Bangsar, 59100 KL',          product: '7kW Home Charger',   scheduledDate: '2026-05-05', priority: 'normal', status: 'open',     assignedTo: null,           templateId: 'tpl-charger-install', response: null },
  { id: 'WO-2026-0143', title: 'Annual maintenance',      customerId: 'cust-ytl',      customer: 'YTL PowerSeraya', address: 'Menara YTL, KL',                        product: '22kW Commercial',    scheduledDate: '2026-05-06', priority: 'normal', status: 'open',     assignedTo: null,           templateId: 'tpl-maintenance',     response: null },
  { id: 'WO-2026-0141', title: '22kW Commercial install', customerId: 'cust-nurul',    customer: 'Nurul Ain',       address: 'Jln SS2, PJ, 47300 SL',                 product: '22kW Commercial',    scheduledDate: '2026-05-04', priority: 'high',   status: 'assigned', assignedTo: 'Zulkifli A.',  templateId: 'tpl-charger-install', response: null },
  { id: 'WO-2026-0140', title: '7kW Wallbox install',     customerId: 'cust-lee',      customer: 'Lee Cheng Wei',   address: 'Jln Kiara, Mont Kiara, 50480 KL',       product: '7kW Home Charger',   scheduledDate: '2026-05-03', priority: 'normal', status: 'in_progress', assignedTo: 'Zulkifli A.', templateId: 'tpl-charger-install', response: { values: { customer_name: 'Lee Cheng Wei', install_address: 'Jln Kiara, Mont Kiara, 50480 KL', pre_db_inspected: true, pre_earthing: true } } },
  { id: 'WO-2026-0139', title: '22kW Commercial install', customerId: 'cust-priya',    customer: 'Priya Rajendran', address: 'Persiaran APEC, Cyberjaya, 63000 SL',   product: '22kW Commercial',    scheduledDate: '2026-05-02', priority: 'normal', status: 'submitted', assignedTo: 'Zulkifli A.', templateId: 'tpl-charger-install', response: { submittedAt: '2026-05-02', submittedBy: 'Zulkifli A.', values: { customer_name: 'Priya Rajendran', install_address: 'Persiaran APEC, Cyberjaya', install_date: '02 May 2026', serial_number: 'EVO-22K-024891', pre_db_inspected: true, pre_earthing: true, pre_supply_capacity: true, pre_breaker: true, pre_route: true, inst_mounted: true, inst_cabling: true, inst_mcb: true, inst_earth: true, inst_ip_seal: true, post_powered: true, post_charge_test: true, post_rcd: true, post_app: true, post_walkthrough: true, notes: 'Customer requested second charger Q3 — flagged to Sales.', tech_signature: 'Zulkifli A.', customer_signature: 'P. Rajendran' } } },
  { id: 'WO-2026-0138', title: '7kW Wallbox install',     customerId: 'cust-hafiz',    customer: 'Hafiz Mohd Noor', address: 'Jln SAS 3, Shah Alam, 40150 SL',        product: '7kW Home Charger',   scheduledDate: '2026-05-01', priority: 'high',   status: 'reviewed', assignedTo: 'Ramesh K.',    templateId: 'tpl-charger-install', response: { submittedAt: '2026-05-01', submittedBy: 'Ramesh K.', editedAt: '2026-05-02', editedBy: 'Aishah PIC', values: { customer_name: 'Hafiz Mohd Noor', install_address: 'Jln SAS 3, Shah Alam', install_date: '01 May 2026', serial_number: 'EVO-7K-019487', pre_db_inspected: true, pre_earthing: true, pre_supply_capacity: true, pre_breaker: true, pre_route: false, inst_mounted: true, inst_cabling: true, inst_mcb: true, inst_earth: true, inst_ip_seal: true, post_powered: true, post_charge_test: true, post_rcd: true, post_app: true, post_walkthrough: true, notes: 'DB overcrowded; recommended upgrade in 6 months.', tech_signature: 'Ramesh K.', customer_signature: 'H. Mohd Noor' } } },
];

const INITIAL_CUSTOMERS: Customer[] = [
  { id: 'cust-ahmad', name: 'Ahmad Razif',         type: 'Residential', email: 'ahmad.razif@email.com',     phone: '+6012-345 6789', address: 'Jln Riong, Bangsar, 59100 Kuala Lumpur',         notes: '' },
  { id: 'cust-nurul', name: 'Nurul Ain Bt Hassan', type: 'Commercial',  email: 'nurul.ain@company.com',     phone: '+603-7890 1234', address: 'Jln SS2, Petaling Jaya, 47300 Selangor',          notes: '3 chargers across HQ + 2 branches.' },
  { id: 'cust-lee',   name: 'Lee Cheng Wei',       type: 'Residential', email: 'lee.cw@email.com',          phone: '+6016-234 5678', address: 'Jln Kiara, Mont Kiara, 50480 Kuala Lumpur',       notes: '' },
  { id: 'cust-priya', name: 'Priya Rajendran',     type: 'Commercial',  email: 'priya.r@techco.com',        phone: '+603-2345 6789', address: 'Persiaran APEC, Cyberjaya, 63000 Selangor',       notes: 'Office park, 2 bays.' },
  { id: 'cust-hafiz', name: 'Hafiz Mohd Noor',     type: 'Residential', email: 'hafiz.mn@email.com',        phone: '+6019-876 5432', address: 'Jln SAS 3, Shah Alam, 40150 Selangor',            notes: 'DB upgrade recommended.' },
  { id: 'cust-ytl',   name: 'YTL PowerSeraya',     type: 'Enterprise',  email: 'procurement@ytl.com.my',    phone: '+603-2117 8888', address: 'Menara YTL, Jln Bukit Bintang, 55100 KL',         notes: '18 commercial chargers under deployment.' },
];

// ── Store ─────────────────────────────────────────────────────────

interface Store {
  workOrders: WorkOrder[];
  templates: FormTemplate[];
  customers: Customer[];
  getTemplate(id: string): FormTemplate | undefined;
  getCustomer(id: string | null | undefined): Customer | undefined;

  // technician actions
  pickUp(workOrderId: string, technicianName: string): void;
  saveDraft(workOrderId: string, values: FormValues): void;
  submit(workOrderId: string, values: FormValues, technicianName: string): void;

  // pic actions
  amend(workOrderId: string, values: FormValues, picName: string): void;
  approve(workOrderId: string): void;

  // admin actions
  createWorkOrder(input: Omit<WorkOrder, 'id' | 'status' | 'response'>): void;
  reassign(workOrderId: string, technicianName: string | null): void;
  reschedule(workOrderId: string, date: string): void;
  deleteWorkOrder(workOrderId: string): void;
  saveTemplate(template: FormTemplate): void;
  deleteTemplate(templateId: string): void;

  // customer actions
  saveCustomer(customer: Customer): void;
  deleteCustomer(customerId: string): void;
}

const StoreContext = createContext<Store | null>(null);

export function WorkOrderProvider({ children }: { children: ReactNode }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(INITIAL_WORK_ORDERS);
  const [templates, setTemplates] = useState<FormTemplate[]>(INITIAL_TEMPLATES);
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);

  const today = () => new Date().toISOString().slice(0, 10);

  const value: Store = {
    workOrders,
    templates,
    customers,
    getTemplate: (id) => templates.find((t) => t.id === id),
    getCustomer: (id) => (id ? customers.find((c) => c.id === id) : undefined),

    pickUp: (id, tech) =>
      setWorkOrders((ws) =>
        ws.map((w) =>
          w.id === id && w.status === 'open'
            ? { ...w, status: 'assigned', assignedTo: tech }
            : w,
        ),
      ),

    saveDraft: (id, values) =>
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          const nextStatus: WorkOrderStatus = w.status === 'assigned' ? 'in_progress' : w.status;
          return {
            ...w,
            status: nextStatus,
            response: { ...(w.response ?? { values: {} }), values },
          };
        }),
      ),

    submit: (id, values, tech) =>
      setWorkOrders((ws) =>
        ws.map((w) =>
          w.id === id
            ? {
                ...w,
                status: 'submitted',
                response: { values, submittedAt: today(), submittedBy: tech },
              }
            : w,
        ),
      ),

    amend: (id, values, pic) =>
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          return {
            ...w,
            status: 'reviewed',
            response: {
              ...(w.response ?? { values: {} }),
              values,
              editedAt: today(),
              editedBy: pic,
            },
          };
        }),
      ),

    approve: (id) =>
      setWorkOrders((ws) => ws.map((w) => (w.id === id ? { ...w, status: 'completed' } : w))),

    createWorkOrder: (input) => {
      const id = `WO-2026-${String(Date.now()).slice(-4)}`;
      setWorkOrders((ws) => [{ id, status: 'open', response: null, ...input }, ...ws]);
    },

    reassign: (id, tech) =>
      setWorkOrders((ws) =>
        ws.map((w) =>
          w.id === id
            ? { ...w, assignedTo: tech, status: tech ? 'assigned' : 'open' }
            : w,
        ),
      ),

    reschedule: (id, date) =>
      setWorkOrders((ws) => ws.map((w) => (w.id === id ? { ...w, scheduledDate: date } : w))),

    deleteWorkOrder: (id) => setWorkOrders((ws) => ws.filter((w) => w.id !== id)),

    saveTemplate: (tpl) =>
      setTemplates((ts) => {
        if (ts.find((t) => t.id === tpl.id)) return ts.map((t) => (t.id === tpl.id ? tpl : t));
        return [...ts, tpl];
      }),

    deleteTemplate: (id) => setTemplates((ts) => ts.filter((t) => t.id !== id)),

    saveCustomer: (customer) =>
      setCustomers((cs) => {
        if (cs.find((c) => c.id === customer.id)) {
          // also update denormalised customer name on any linked WO
          setWorkOrders((ws) =>
            ws.map((w) =>
              w.customerId === customer.id ? { ...w, customer: customer.name, address: customer.address } : w,
            ),
          );
          return cs.map((c) => (c.id === customer.id ? customer : c));
        }
        return [...cs, customer];
      }),

    deleteCustomer: (id) =>
      setCustomers((cs) => cs.filter((c) => c.id !== id)),
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useWorkOrderStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useWorkOrderStore must be used inside <WorkOrderProvider>');
  return s;
}

// ── Status colour map (shared) ────────────────────────────────────

export const STATUS_COLORS: Record<WorkOrderStatus, { bg: string; color: string; label: string }> = {
  open:        { bg: '#E3F0FF', color: '#1A62C0', label: 'Open' },
  assigned:    { bg: '#F0E8FF', color: '#6B21A8', label: 'Assigned' },
  in_progress: { bg: '#FFF8E1', color: '#B07D00', label: 'In Progress' },
  submitted:   { bg: '#FFF0E0', color: '#B45309', label: 'Submitted' },
  reviewed:    { bg: '#E6F4EA', color: '#1B512D', label: 'Reviewed' },
  completed:   { bg: '#E4F3E3', color: '#1B512D', label: 'Completed' },
};

export const TECHNICIANS = [
  'Zulkifli A.',
  'Ramesh K.',
  'David T.',
  'Fadzli H.',
  'Jason L.',
];

export const DEMO_TECHNICIAN = 'Zulkifli A.';
export const DEMO_PIC = 'Aishah PIC';
