import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './lib/supabase';

// ── Types ─────────────────────────────────────────────────────────

export type WorkOrderStatus =
  | 'open'        // unassigned, awaiting pickup
  | 'assigned'    // picked up, not started
  | 'in_progress' // technician on-site / filling form
  | 'submitted'   // technician submitted, awaiting PIC review
  | 'reviewed'    // PIC amended, ready to approve
  | 'completed';  // approved, archived

export type FieldType =
  | 'section'
  | 'text'
  | 'number'
  | 'textarea'
  | 'checkbox'
  | 'cross'      // overlay-only: stamps an ✕ (e.g. to strike out "delete as appropriate")
  | 'photo'
  | 'group'
  | 'date'
  | 'time'
  | 'signature'
  | 'select'
  | 'charger';

export type TemplateKind = 'structured' | 'overlay';

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  // Group-only: composed sub-fields chosen by the admin (text/photo/date/…).
  // Each child stores its value under its own id. Legacy groups (no `children`)
  // are a checkbox question + photo + remarks under `${id}::photo` / `${id}::remark`.
  children?: FormField[];
  photoLabel?: string;
  remarkLabel?: string;
  // Select-only: the dropdown choices
  options?: string[];
  // Overlay-only positioning (percent of form image, 0-100)
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  page?: number;              // overlay page index (0-based); defaults to 0
  // Overlay text size, as a percentage of the page height (resolution-independent
  // so the on-screen input and the exported PDF match). Unset = auto-fit the box.
  fontSize?: number;
}

export interface OverlayPage {
  imageSrc: string;           // data URL (frontend-only mock)
  imageWidth?: number;
  imageHeight?: number;
}

export interface FormTemplate {
  id: string;
  name: string;
  description: string;
  kind?: TemplateKind;        // undefined treated as 'structured' (backwards compat)
  fields: FormField[];
  // Overlay-only — multiple pages supported. `imageSrc`/`imageWidth`/`imageHeight`
  // mirror page 0 for backwards compatibility.
  pages?: OverlayPage[];
  imageSrc?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export type FormValues = Record<string, string | boolean>;

// Sentinel templateId for non-templated jobs whose report is a manually-uploaded PDF.
export const OTHER_FORM_ID = 'other';

// A work order consists of one or more form instances to complete (e.g. 2× install
// report + 1× maintenance). Each instance holds its own filled values / PDF report.
export interface WorkOrderForm {
  id: string;                 // unique per instance within the work order
  templateId: string;         // a FormTemplate id, or OTHER_FORM_ID
  label: string;              // display, e.g. "EV Charger Installation Report (1 of 2)"
  values?: FormValues;
  reportFileName?: string;    // Other instances: manually-uploaded PDF
  reportPdfUrl?: string;      // permanent Storage URL for the uploaded report
  reportPdfBase64?: string;   // legacy inline PDF (pre-Storage work orders)
}

export interface FormResponse {
  submittedAt?: string;
  submittedBy?: string;
  editedAt?: string;
  editedBy?: string;
}

export interface WorkOrder {
  id: string;
  title: string;
  category?: string | null;    // optional admin-managed grouping (tsd_work_order_categories)
  instructions?: string | null; // optional PIC note shown to the technician (multi-line)
  customerId: string | null;   // link to Customer registry (preferred)
  customer: string;            // denormalised name for display + legacy
  address: string;
  product?: string;
  scheduledDate: string;
  priority: 'low' | 'normal' | 'high';
  status: WorkOrderStatus;
  /** Assigned technician(s). Work orders created before multi-assign hold a
   *  single name string — always read this through assigneesOf(). */
  assignedTo: string | string[] | null;
  forms: WorkOrderForm[];      // one or more form instances to complete
  response: FormResponse | null;
}

/** Assignees as a list — tolerates the legacy single-string shape. */
export function assigneesOf(w: { assignedTo?: string | string[] | null }): string[] {
  const a = w.assignedTo;
  if (!a) return [];
  return (Array.isArray(a) ? a : [a]).filter(Boolean);
}

/** Display label for a work order's assignees. */
export function assigneesLabel(w: { assignedTo?: string | string[] | null }, empty = 'Unassigned'): string {
  const list = assigneesOf(w);
  return list.length ? list.join(', ') : empty;
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

const INITIAL_TEMPLATES: FormTemplate[] = [];

const INITIAL_WORK_ORDERS: WorkOrder[] = [];

// Customers are seeded into Supabase (tsd_customers) by migration and loaded from there.
const INITIAL_CUSTOMERS: Customer[] = [];

// ── Store ─────────────────────────────────────────────────────────

interface Store {
  workOrders: WorkOrder[];
  templates: FormTemplate[];
  customers: Customer[];
  getTemplate(id: string): FormTemplate | undefined;
  getCustomer(id: string | null | undefined): Customer | undefined;
  /** Lazy-load the FULL work order (incl. photo/PDF blobs) into the store. The
   *  list loads a light projection; call this before opening a work order so its
   *  form values are present. Resolves once the row is merged. */
  loadWorkOrderDetail(workOrderId: string): Promise<void>;

  // technician actions
  saveDraft(workOrderId: string, forms: WorkOrderForm[]): void;
  submit(workOrderId: string, forms: WorkOrderForm[], technicianName: string): void;

  // pic actions
  amend(workOrderId: string, forms: WorkOrderForm[], picName: string): void;
  approve(workOrderId: string): void;

  // admin actions
  createWorkOrder(input: Omit<WorkOrder, 'id' | 'status' | 'response'>): void;
  reassign(workOrderId: string, technicians: string[]): void;
  /** Change the assignees without disturbing an in-flight status (submitted/
   *  reviewed/completed stay put); only the open⇄assigned pair tracks assignment. */
  setAssignee(workOrderId: string, technicians: string[]): void;
  renameWorkOrder(workOrderId: string, title: string): void;
  setWorkOrderCategory(workOrderId: string, category: string | null): void;
  setWorkOrderInstructions(workOrderId: string, instructions: string | null): void;
  reschedule(workOrderId: string, date: string): void;
  deleteWorkOrder(workOrderId: string): void;
  saveTemplate(template: FormTemplate): void;
  deleteTemplate(templateId: string): void;

  // customer actions
  saveCustomer(customer: Customer): void;
  deleteCustomer(customerId: string): void;
}

const StoreContext = createContext<Store | null>(null);

// A row has "full" detail once its form values / legacy inline PDFs are loaded —
// as opposed to the light list projection where they're stripped. Used so a
// background list refetch never downgrades an open (hydrated) work order.
function formsAreFull(w: WorkOrder): boolean {
  return (w.forms ?? []).some(
    (f) => (f.values && Object.keys(f.values).length > 0) || !!f.reportPdfBase64,
  );
}

export function WorkOrderProvider({ children }: { children: ReactNode }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(INITIAL_WORK_ORDERS);
  const [templates, setTemplates] = useState<FormTemplate[]>(INITIAL_TEMPLATES);
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);

  // Templates, work orders and customers are persisted to Supabase so they survive
  // refresh — and synced across devices (technician phone → PIC desktop) via
  // Supabase Realtime + a refetch whenever the tab returns to the foreground.
  useEffect(() => {
    let live = true;

    // Fire the three loads independently so each list/dropdown paints as soon as
    // its own (small) payload lands — templates + customers no longer wait behind
    // the work-order fetch. Work orders come back as a LIGHT projection (photos /
    // report PDFs stripped server-side); full detail is lazy-loaded per row when a
    // work order is opened, via loadWorkOrderDetail.
    // The work-order list only — cheap (photos stripped server-side). Polled on a
    // short interval so a tech sees a newly-assigned job within seconds even if the
    // realtime socket is asleep, without a manual reload.
    const loadWorkOrders = () => {
      supabase.rpc('tsd_work_orders_list').then(({ data, error }) => {
        if (!live) return;
        if (error) { console.error('load work orders failed', error); return; }
        if (!Array.isArray(data)) return;
        const light = data as unknown as WorkOrder[];
        // The list is a LIGHT projection (form values / photos stripped). If a row
        // is already loaded full in memory (an open report), keep its full forms —
        // otherwise a background refetch would blank out the open work order until
        // the next page reload. Metadata (title/status/…) still refreshes.
        setWorkOrders((prev) => {
          const byId = new Map(prev.map((w) => [w.id, w]));
          return light.map((lr) => {
            const ex = byId.get(lr.id);
            return ex && formsAreFull(ex) ? { ...lr, forms: ex.forms, response: ex.response } : lr;
          });
        });
      });
    };

    const loadAll = () => {
      supabase.from('tsd_form_templates').select('template').then(({ data }) => {
        if (live && data) setTemplates(data.map((r) => (r as { template: FormTemplate }).template));
      });
      loadWorkOrders();
      supabase.from('tsd_customers').select('data').then(({ data }) => {
        if (live && data) setCustomers(data.map((r) => (r as { data: Customer }).data));
      });
    };

    const refetchWorkOrder = async (id: string) => {
      const { data } = await supabase.from('tsd_work_orders').select('data').eq('id', id).maybeSingle();
      if (!live) return;
      if (!data) {
        setWorkOrders((ws) => ws.filter((w) => w.id !== id));
        return;
      }
      const wo = (data as { data: WorkOrder }).data;
      setWorkOrders((ws) => (ws.some((w) => w.id === wo.id) ? ws.map((w) => (w.id === wo.id ? wo : w)) : [wo, ...ws]));
    };

    void loadAll();

    // Realtime rows can exceed the broadcast payload limit (photo-laden jsonb),
    // so treat events as change *signals* and refetch the affected row by id.
    const channel = supabase
      .channel('tsd-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tsd_work_orders' }, (payload) => {
        const id =
          ((payload.new as { id?: string } | null)?.id) ??
          ((payload.old as { id?: string } | null)?.id);
        if (id) void refetchWorkOrder(id);
        else void loadAll();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tsd_form_templates' }, () => void loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tsd_customers' }, () => void loadAll())
      .subscribe();

    // Mobile browsers kill websockets in the background — refetch on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadAll();
    };
    document.addEventListener('visibilitychange', onVisible);

    // Backstop poll (visible tabs only): guarantees new/assigned work orders show
    // up promptly regardless of realtime delivery. Cheap — the light list is a few KB.
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadWorkOrders();
    }, 15000);

    return () => {
      live = false;
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, []);

  // NOTE: a supabase query only executes when `.then()` is called — never use bare
  // `void supabase…`, that builds the request but never sends it.
  const persistWorkOrder = (wo: WorkOrder) => {
    supabase
      .from('tsd_work_orders')
      .upsert({ id: wo.id, data: wo, updated_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) {
          console.error('persist work order failed', error);
          alert(`Saving to the server failed — your changes are NOT synced yet.\n\n${error.message}`);
        }
      });
  };
  // Merge only the changed top-level fields server-side (data || patch), so a
  // metadata edit never overwrites the full row — the in-memory copy is a light
  // projection with photo/PDF blobs stripped, and a whole-blob upsert would wipe
  // them. Use this for every mutation that ISN'T rewriting form contents.
  const patchWorkOrder = (id: string, patch: Record<string, unknown>) => {
    supabase.rpc('tsd_work_order_patch', { p_id: id, p_patch: patch }).then(({ error }) => {
      if (error) {
        console.error('patch work order failed', error);
        alert(`Saving to the server failed — your changes are NOT synced yet.\n\n${error.message}`);
      }
    });
  };
  const persistCustomer = (c: Customer) => {
    supabase
      .from('tsd_customers')
      .upsert({ id: c.id, data: c, updated_at: new Date().toISOString() })
      .then(({ error }) => { if (error) console.error('persist customer failed', error); });
  };

  const today = () => new Date().toISOString().slice(0, 10);

  const value: Store = {
    workOrders,
    templates,
    customers,
    getTemplate: (id) => templates.find((t) => t.id === id),
    getCustomer: (id) => (id ? customers.find((c) => c.id === id) : undefined),

    loadWorkOrderDetail: async (id) => {
      const { data } = await supabase.from('tsd_work_orders').select('data').eq('id', id).maybeSingle();
      if (!data) return;
      const wo = (data as { data: WorkOrder }).data;
      setWorkOrders((ws) => (ws.some((w) => w.id === wo.id) ? ws.map((w) => (w.id === wo.id ? wo : w)) : [wo, ...ws]));
    },

    saveDraft: (id, forms) =>
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          const nextStatus: WorkOrderStatus = w.status === 'assigned' ? 'in_progress' : w.status;
          const next: WorkOrder = { ...w, status: nextStatus, forms, response: w.response ?? {} };
          persistWorkOrder(next);
          return next;
        }),
      ),

    submit: (id, forms, tech) =>
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          const next: WorkOrder = { ...w, status: 'submitted', forms, response: { submittedAt: today(), submittedBy: tech } };
          persistWorkOrder(next);
          return next;
        }),
      ),

    amend: (id, forms, pic) =>
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          const next: WorkOrder = { ...w, status: 'reviewed', forms, response: { ...(w.response ?? {}), editedAt: today(), editedBy: pic } };
          persistWorkOrder(next);
          return next;
        }),
      ),

    approve: (id) =>
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          patchWorkOrder(id, { status: 'completed' });
          return { ...w, status: 'completed' };
        }),
      ),

    createWorkOrder: (input) => {
      const id = `WO-2026-${String(Date.now()).slice(-4)}`;
      const wo: WorkOrder = { id, status: 'open', response: null, ...input };
      setWorkOrders((ws) => [wo, ...ws]);
      persistWorkOrder(wo);
    },

    reassign: (id, techs) =>
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          const status: WorkOrderStatus = techs.length ? 'assigned' : 'open';
          patchWorkOrder(id, { assignedTo: techs, status });
          return { ...w, assignedTo: techs, status };
        }),
      ),

    reschedule: (id, date) =>
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          patchWorkOrder(id, { scheduledDate: date });
          return { ...w, scheduledDate: date };
        }),
      ),

    setAssignee: (id, techs) =>
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          // Preserve any progressed status; only the open⇄assigned pair reflects
          // whether a technician is on it. Editing a submitted job never resets it.
          const status: WorkOrderStatus =
            w.status === 'open' || w.status === 'assigned' ? (techs.length ? 'assigned' : 'open') : w.status;
          patchWorkOrder(id, { assignedTo: techs, status });
          return { ...w, assignedTo: techs, status };
        }),
      ),

    renameWorkOrder: (id, title) =>
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          patchWorkOrder(id, { title });
          return { ...w, title };
        }),
      ),

    setWorkOrderCategory: (id, category) =>
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          patchWorkOrder(id, { category });
          return { ...w, category };
        }),
      ),

    setWorkOrderInstructions: (id, instructions) =>
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          patchWorkOrder(id, { instructions });
          return { ...w, instructions };
        }),
      ),

    deleteWorkOrder: (id) => {
      setWorkOrders((ws) => ws.filter((w) => w.id !== id));
      supabase.from('tsd_work_orders').delete().eq('id', id)
        .then(({ error }) => { if (error) console.error('delete work order failed', error); });
    },

    saveTemplate: (tpl) => {
      setTemplates((ts) => {
        if (ts.find((t) => t.id === tpl.id)) return ts.map((t) => (t.id === tpl.id ? tpl : t));
        return [...ts, tpl];
      });
      supabase
        .from('tsd_form_templates')
        .upsert({
          id: tpl.id,
          name: tpl.name,
          kind: tpl.kind ?? 'structured',
          template: tpl,
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => { if (error) console.error('persist template failed', error); });
    },

    deleteTemplate: (id) => {
      setTemplates((ts) => ts.filter((t) => t.id !== id));
      supabase.from('tsd_form_templates').delete().eq('id', id)
        .then(({ error }) => { if (error) console.error('delete template failed', error); });
    },

    saveCustomer: (customer) => {
      persistCustomer(customer);
      setCustomers((cs) => {
        if (cs.find((c) => c.id === customer.id)) return cs.map((c) => (c.id === customer.id ? customer : c));
        return [...cs, customer];
      });
      // also update denormalised customer name/address on any linked WO (and persist them)
      setWorkOrders((ws) =>
        ws.map((w) => {
          if (w.customerId !== customer.id) return w;
          patchWorkOrder(w.id, { customer: customer.name, address: customer.address });
          return { ...w, customer: customer.name, address: customer.address };
        }),
      );
    },

    deleteCustomer: (id) => {
      setCustomers((cs) => cs.filter((c) => c.id !== id));
      supabase.from('tsd_customers').delete().eq('id', id)
        .then(({ error }) => { if (error) console.error('delete customer failed', error); });
    },
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
