# EVOne SaaS — Handoff Document

> Written for a new Claude session picking up this project. Read CLAUDE.md first for
> design conventions. This doc covers what was built, where things live, and what still
> needs attention.

---

## What was built (in order)

### 1. Corporate CRM (`src/screens/CorporateCRM.tsx`)
Standard CRUD screen managing `crm_companies`, `crm_vehicles`, `crm_sp_drivers`.

Key things to know:
- `CompanySelect` is **exported** — a custom branded dropdown with search field and
  honeydew highlight. Used by AccountManager and both Vehicle/Driver modals.
- SP pricing columns (`sp_base_rate`, `sp_threshold_kwh`, `sp_discounted_rate`) exist on
  `crm_companies` alongside the GoParkin pricing columns.

### 2. Charging Records (`src/screens/ChargingRecords.tsx`)
Read-only view of the `charging_records` table (GoParkin source data).
- Filter by `source`, `transaction_type`, date range.
- Paginated with `.range()` to bypass the Supabase 1000-row PostgREST cap.

### 3. Corporate Invoicing (`src/screens/CorporateInvoicing.tsx`)
The main billing screen. Has a top-level tab bar: **Generate** | **Customer Portal**.

#### Generate tab
1. User picks a billing month (YYYY-MM, defaults to previous month).
2. **Pull GoParkin Data** — queries `charging_records` where
   `source='goparkin' AND transaction_type='Corporate'` within the month date range.
   Matches plates against `crm_vehicles` to attribute rows to companies.
3. **Upload SP Corporate XLSX** — parses the `.xlsx` file, reads only the sheet named
   `"EVOne Corporate fleet"`. Uses `cellDates: true` so date cells become JS Date objects.
   `findKey()` does case-insensitive header lookup. `parseSpCorpDate()` handles Date
   objects, Excel serial numbers, DD/MM/YYYY strings, and ISO strings.
   **Important:** `isNaN(energy)` is the zero-guard — `0 kWh` rows must be kept.
4. **Unmatched records CSV download** — any plate/email not found in CRM is flagged and
   downloadable for cross-checking.
5. **Statement table** — one row per company; columns: company, vehicles, GoParkin kWh,
   SP kWh, total kWh, rate, total amount.
6. **Per-row actions**: View (opens `StatementView` modal) | ⬇ PDF (browser download) |
   ↑ Publish (upserts single statement to `customer_portal_documents`).
   `rowBusyId` state tracks which row is loading.
7. **Publish All** — publishes statements for all companies in one pass with a progress
   counter. Statements only — invoices come from accounting software.

#### Exports from CorporateInvoicing.tsx
These are used by the portal sub-screens:
```ts
export interface CRMCompany { id, name, base_rate, threshold_kwh, discounted_rate }
export interface GoParkinRow { plate, location, start, end, kwh }
export interface SpCorpRecord { driverEmail, location, startDateTime, endDateTime, energyKwh }
export interface CompanyStatement { company, goparkinRows, spRows, totalKwh, appliedRate, totalAmount }
export function buildStatement(company, goparkinRows, spRows): CompanyStatement
export function StatementView({ stmt, billingMonth, onClose })   // in-app modal
export function CorporateStatementPDF({ stmt, billingMonth })    // react-pdf Document
```

### 4. Customer Portal (`src/screens/portal/`)
Nested inside Corporate Invoicing behind the "Customer Portal" tab.

```
portal/
  CustomerPortal.tsx    — entry: three sub-tabs (Master View / Accounts / Customer Login)
  MasterView.tsx        — admin overview of all accounts + documents
  AccountManager.tsx    — CRUD portal accounts, seed all companies
  CustomerLogin.tsx     — login form + customer dashboard
  InvoicePDF.tsx        — formal invoice react-pdf Document (kept, currently unused)
  portalDb.ts           — all Supabase helpers
  portalAuth.ts         — Web Crypto password hashing
  pdfShared.ts          — shared PDF constants + formatters
  types.ts              — PortalAccount, PortalDocument, PortalStatementData
```

---

## Supabase tables added

### `customer_portal_accounts`
| col | type | notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `company_id` | uuid FK → `crm_companies.id` | unique |
| `email` | text | **nullable** — precreated rows have no credentials yet; unique index allows multiple NULLs |
| `password_hash` | text | nullable until configured |
| `password_salt` | text | nullable until configured |
| `last_login_at` | timestamptz | updated on login |
| `created_at` / `updated_at` | timestamptz | `now()` defaults |

RLS: anon SELECT/INSERT/UPDATE/DELETE (matches all other tables in this project).

### `customer_portal_documents`
| col | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid FK → `crm_companies.id` | |
| `billing_month` | text | `YYYY-MM` |
| `doc_type` | text | `'statement'` or `'invoice'` |
| `invoice_number` | text | nullable; only set on invoices, format `INV-YYYY-MM-####` |
| `statement_data` | jsonb | full `PortalStatementData` JSON; used to re-render StatementView modal |
| `pdf_base64` | text | PDF stored as base64 — no Storage bucket needed |
| `total_kwh` | numeric | denormalised for list display |
| `total_amount` | numeric | |
| `applied_rate` | numeric | |
| `issued_at` | timestamptz | `now()` default |
| `issued_by` | text | `'admin'` for now |

Unique constraint: `(company_id, billing_month, doc_type)` — upsert replaces on republish.

---

## Portal sub-screens in detail

### MasterView.tsx
- Left panel (320 px): list of all accounts with search, doc count badge, last login.
  Clicking a row selects it.
- Right panel: account header card, then **Statements** / **Invoices** tabs.
- Document table columns: billing month | invoice no. / energy | amount | issued | actions.
- Actions per row:
  - **View** (statements only) — opens `StatementView` modal rehydrating from `statement_data` jsonb.
  - **⬇ PDF** — `downloadPdfFromBase64(d.pdf_base64, filename)`.
  - **Delete** — inline confirm (`confirmDeleteId` state) before calling `deleteDocument(id)`.
- Upload button above the table changes label based on active tab:
  - "⬆ Upload Statement" or "⬆ Upload Invoice"
  - Opens `UploadDocumentModal` which handles both types polymorphically.
  - Invoice upload: shows Invoice No. field; inherits totals from matching statement if one exists.
  - Statement upload: shows a warning about placeholder `statement_data` (no breakdown rows).
- `refreshKey` state is incremented after any mutation to re-trigger the `useEffect` fetch.

### AccountManager.tsx
- Table of all accounts. Unconfigured rows (email = null) sort to the top and show a
  yellow "Awaiting setup" chip + "Set Up" button.
- Modals:
  - `NewAccountModal` — picks company, enters email, generates password (admin copies it once).
  - `SetupModal` — fills email + generates password on a precreated row.
  - `ResetPasswordModal` — regenerates salt + hash; shows new password once.
  - `EditEmailModal` — changes email only.
- **"⊞ Pre-create for All Companies"** button — calls `seedAccountsForAllCompanies()`,
  inserts a null-credentials row for every company that doesn't have one yet.

### CustomerLogin.tsx
- Login form → `findAccountByEmail` → `verifyPassword` → `recordLogin` → dashboard.
- Guards: "No account found" | "Account not set up yet" | "Incorrect password".
- `CustomerDashboard` post-login:
  - Green welcome header with company name + logged-in email + Sign Out.
  - Two KPI cards: Registered GoParkin Vehicles | Registered SP Drivers
    (counts from `crm_vehicles` / `crm_sp_drivers` for that company).
  - Statements / Invoices tabs showing all documents for that company.
  - Per-row: View Details (statement modal) + ⬇ PDF download.

### CustomerPortal.tsx
- Admin sub-tab strip: **Master View** | **Accounts** | **Customer Login**.
- When a customer logs in (via Customer Login tab), the strip hides and shows
  "← Back to admin view" instead. This is a preview/testing convenience for admins.
- Dev notice at top: "This section will move to a top-level screen."

---

## Shared utilities

### `portal/pdfShared.ts`
PDF constants and formatters imported by both `CorporateInvoicing.tsx` and `InvoicePDF.tsx`:
```ts
pdfGreen = '#2A9A47'
pdfHoneydew = '#E6F4EA'
pdfSlate = '#5B6B7A'
pdfBorderW = '#EBEBEB'
bRight / bBottom / bAll   // border style objects (explicit borderWidth/Color/Style — react-pdf doesn't accept shorthand)
fmtMonthLabel(ym)         // "May 2025"
fmtDateTime(s)            // "2025-05-01 14:30:00"
fmtKwh(n)                 // "12.34 kWh"
fmtAmt(n)                 // "$123.45"
fmtRate(n)                // "$0.2800/kWh"
```

### `portal/portalAuth.ts`
Web Crypto — no external dependency:
```ts
randomSalt(): string                                          // 32-byte hex
hashPassword(salt, password): Promise<string>                // SHA-256(salt+password)
verifyPassword(salt, expectedHash, attempt): Promise<bool>
generatePassword(): string                                    // 12-char alphanumeric
```
> Note: SHA-256 is fine for this internal demo. When the portal is promoted to production,
> swap to Supabase Auth (bcrypt) — password reset flow handles migration.

### `portal/portalDb.ts` — key functions
```ts
// Accounts
listAccounts()
createAccount({ company_id, email, password, salt })
seedAccountsForAllCompanies()                  // inserts null-creds rows for new companies
configureAccount(id, email, salt, password)    // fills creds on a precreated row
updateAccountPassword(id, newSalt, newPassword)
updateAccountEmail(id, email)
deleteAccount(id)
findAccountByEmail(email)                      // used by login
recordLogin(accountId)

// Documents
listDocumentsForCompany(companyId)
countDocsByCompany()                           // Record<companyId, count>
countFleetForCompany(companyId)                // { vehicles, spDrivers }
upsertDocument(args)                           // upserts on (company_id, billing_month, doc_type)
uploadStatementForCompany(args)               // manual upload with placeholder statement_data
uploadInvoiceForCompany(args)                  // inherits totals from matching statement
deleteDocument(id)
nextInvoiceSeq(billingMonth)                   // returns next integer sequence for INV numbers
makeInvoiceNumber(billingMonth, seq)           // "INV-2025-05-0001"

// PDF helpers
blobToBase64(blob): Promise<string>            // FileReader → strips data URL prefix
downloadPdfFromBase64(base64, filename): void  // decodes → Blob → anchor click
```

---

## Known react-pdf gotchas (already fixed, don't reintroduce)

| Problem | Fix |
|---|---|
| `gap` not supported | Use `marginRight` on sibling `<View>`s |
| Border shorthand `'1pt solid #...'` ignored | Use explicit `borderWidth`, `borderColor`, `borderStyle` |
| `textTransform` not supported | Uppercase text in source string |
| `overflow: 'hidden'` on text not supported | Use fixed-width View + `numberOfLines` |
| `width: 'auto'` on Image ignored | Set explicit numeric `width` |
| Page-break splits table rows from header | Add `wrap={false}` on each data row; group header + first row |
| 0 kWh SP rows being skipped | Use `isNaN(energy)` not `!energy` |
| SP XLSX dates parsed as strings with `raw: false` | Use `cellDates: true` + `getUTC*` methods for date formatting |

---

## What's not done / future work

1. **InvoicePDF.tsx** — the formal invoice react-pdf Document exists but is not wired up.
   Currently invoices are uploaded manually from accounting software. When EVOne wants
   in-app invoice generation, wire `publishAll` / `publishOne` to also render `<InvoicePDF>`
   and call `uploadInvoiceForCompany` with the generated base64.

2. **Move portal to top-level screen** — `CustomerPortal` is currently nested inside
   `CorporateInvoicing` under a tab. When stable, extract it to `src/screens/portal/`
   entry point, add it as `'customerportal'` in `App.tsx` routing, and remove the tab
   from `CorporateInvoicing.tsx`.

3. **Supabase Auth migration** — current password auth is SHA-256 table-based for the demo.
   Production should migrate to Supabase Auth (bcrypt). Password reset handles migration.

4. **RLS hardening** — all tables currently allow anon CRUD. Before going to production,
   add proper RLS policies so customers can only read their own company's documents.

5. **SP driver count in Customer Dashboard** — `crm_sp_drivers` is the source table.
   If SP drivers are stored differently in production, update `countFleetForCompany`.

6. **Invoice number sequence** — `nextInvoiceSeq` counts by billing_month. If invoices
   are ever auto-generated in bulk, wrap in a transaction to avoid race conditions.

---

## Running locally

```bash
npm run dev -- --host    # starts on http://localhost:5173 (or next available port)
```

TypeScript check:
```bash
npx tsc --noEmit
```

Build:
```bash
npm run build
```

`.env` file at project root needs:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

---

## File map (screens only)

```
src/screens/
  CorporateInvoicing.tsx     billing screen + Publish All + PDF generation
  CorporateCRM.tsx           companies / vehicles / SP drivers CRUD
  ChargingRecords.tsx        GoParkin raw data viewer
  portal/
    CustomerPortal.tsx       admin entry + sub-tab switcher
    MasterView.tsx           admin document management per account
    AccountManager.tsx       portal account CRUD + seed
    CustomerLogin.tsx        customer-facing login + dashboard
    InvoicePDF.tsx           formal invoice PDF (unused, kept for future)
    portalDb.ts              all Supabase DB helpers
    portalAuth.ts            Web Crypto password utils
    pdfShared.ts             PDF constants + formatters (shared)
    types.ts                 PortalAccount, PortalDocument, PortalStatementData
```
