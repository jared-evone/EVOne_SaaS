# EVOne Mega System — Design & Code Conventions

> The whole project is built from the EVOne Design Bundle prototype. Visual fidelity to that prototype is non-negotiable. Read this file before editing anything UI-related.

## Stack

- **Vite + React 18 + TypeScript** (strict). Inline styles only — **no** Tailwind, no CSS-in-JS library, no shadcn/MUI/Chakra. Don't add one.
- **Data**: Supabase (Postgres + Storage + RLS). Client in [src/lib/supabase.ts](src/lib/supabase.ts); every screen queries via `supabase.from('table')`. No ORM, no codegen.
- **Auth + permissions**: per-department `app_users` / `app_roles` / `app_role_permissions` tables, loaded into a React Context by [src/permissions.tsx](src/permissions.tsx). See § Permissions below.
- **Icons**: `lucide-react`. The old Unicode-glyph identity (`⌕ ⏻ ⬇` etc.) has been retired across the app — render a `LucideIcon` component, not a string.
- **One CSS file**: [src/styles.css](src/styles.css) — global reset + scrollbar only. Don't grow it.
- **One font**: Figtree (loaded from Google Fonts in [index.html](index.html)). Don't add fonts.
- **State**: `useState` + React Context. No Redux/Zustand. Module stores: [src/workOrderStore.tsx](src/workOrderStore.tsx) for TSD.
- **Routing**: permission-gated screen-key switch in [src/App.tsx](src/App.tsx) (`NAV_ALL` → `DEPARTMENT_SCREENS` → `can(key, 'can_view')`). No react-router.
- **File export / heavy deps**: `@react-pdf/renderer` for PDFs; `xlsx` for spreadsheet import. Leaflet is loaded on demand from a CDN by [ChargerLocationMap](src/components/ChargerLocationMap.tsx) (no npm dep needed). No date library — use `Date` + `toLocaleDateString`. No chart library — see [charts.tsx](src/components/charts.tsx).

## Permissions

Every navigable screen is a `ScreenKey` in [src/permissions.tsx](src/permissions.tsx). Two filters compose to decide what a user sees:

- `DEPARTMENT_SCREENS[department]` — which keys a department even exposes in its sidebar.
- `app_role_permissions` — `can_view` / `can_edit` / `can_delete` per role, loaded into the `PermissionsContext` on sign-in.

Inside a screen, call `usePermissions()` and gate every action:

```tsx
const { can } = usePermissions();
const canEdit   = can('customers', 'can_edit');
const canDelete = can('customers', 'can_delete');
{canEdit && <button>+ New Customer</button>}
```

**Sub-screen permission keys** are real `ScreenKey`s that don't render a top-level component — they exist purely to gate tabs / nested views. Examples: `charging_cpo_carparks` and `charging_sp_price` gate the two tabs inside Charging Records; `tsd_workorders` / `tsd_forms` / `tsd_pic` show up in the TSD Admin group. They live in `ScreenKey` + `SCREEN_LABELS` (so they appear in the Settings permission matrix) but are deliberately absent from `App.tsx`'s `screens` map when they don't render directly.

Adding a new top-level screen = touch four places:

1. `ScreenKey` + `SCREEN_LABELS` in [src/permissions.tsx](src/permissions.tsx).
2. `DEPARTMENT_SCREENS[department]` — list the key for any department that should see it.
3. `NAV_ALL` + `SCREEN_TITLES` + `screens` map in [src/App.tsx](src/App.tsx).
4. An `app_role_permissions` row for any role that should access it (the Settings UI does this for you per-role).

**Storage buckets** for binary files: `cpo-maintenance-pdfs` (charger meter / maintenance reports), `crm-contracts` (corporate company contracts), `crm-instructions` (account-opening instruction PDFs + master service agreement), `sales-quotations` (quote PDFs, private), `sales-photos` / `technician-photos` (avatars, public). Read/insert/delete policies must list **both** `anon` AND `authenticated` roles; `usePermissions()` still gates *which UI* can upload. **Same gotcha as tables, on `storage.objects`:** an upload policy scoped to `anon` only blocks now-logged-in (authenticated) staff with a "violates row-level security policy" error on upload — this bit us on `cpo-maintenance-pdfs`. When you add a bucket or write a storage policy, scope it `TO anon, authenticated` (or `public`), never `anon` alone.

`usePermissions().can()` gates the UI. It is **not** the only line of defence anymore — the database enforces a login too (see next section). Always keep gating the UI with `can()`, but never assume it's the security boundary.

## Auth, security & data access (server-side) — read before touching auth, RLS, or `app_users`

This app uses **custom auth** (the `app_users` table), wrapped so the database can verify identity. Do not reintroduce client-side password handling or blanket `anon` access.

**Login & passwords**
- Sign-in goes through the `app_login(department, email, password)` **RPC** (SECURITY DEFINER). It bcrypt-verifies server-side and returns the safe user fields **plus a signed JWT** (`role: authenticated`, 30-day exp, `app_department`/`app_role` claims). See [src/screens/Login.tsx](src/screens/Login.tsx).
- Passwords are **bcrypt-hashed** (pgcrypto, in the `extensions` schema). The client must **never** SELECT or compare the `password` column — `anon`/`authenticated` have no column privilege on it. Set/reset passwords only via the `app_set_password(user_id, password)` RPC (authenticated only). See [Settings.tsx](src/screens/Settings.tsx) / [TechniciansAdmin.tsx](src/screens/tsd/TechniciansAdmin.tsx) for the create/edit pattern (insert non-password columns → `app_set_password`).
- The JWT is signed in-DB with the project JWT secret, stored in `private.app_config` (key `jwt_secret`, a private schema not exposed via the API). pgjwt lives in `extensions`.

**Client token wiring** ([src/lib/supabase.ts](src/lib/supabase.ts))
- The client uses the supabase-js `accessToken` callback: it sends the logged-in JWT when present+unexpired, else falls back to the anon key. `setAppToken` / `hasValidAppToken` manage it; the token + user persist in `localStorage` so sessions survive refresh; sign-out clears both. Do **not** call `supabase.auth.*` — that namespace is disabled by the `accessToken` option.

**RLS posture (this is the security boundary)**
- Every `public` data table has RLS enabled. Internal tables have one policy: `FOR ALL TO authenticated USING (true) WITH CHECK (true)` — i.e. you must be logged in; `anon` (the bare public key) is denied.
- A small set is **also** reachable by anonymous flows and therefore keeps an `anon` policy too: the **customer portal** + **public `?apply=`** (`customer_portal_accounts`, `customer_portal_documents`, `crm_companies`, `crm_vehicles`, `crm_sp_drivers`, `crm_account_applications`, `crm_account_form_templates`, `cpo_locations`, `cpo_managed_carparks`) and the **QR form-test `?formPreview=`** (`tsd_form_templates` anon SELECT).
- **Gotcha that bit us (twice):** an `anon`-only policy hides the object from logged-in staff. Any **table** an anon flow needs must have **both** an `anon` policy AND an `authenticated` policy, or internal screens read empty. The **same applies to `storage.objects`** — a bucket policy scoped to `anon` alone blocks authenticated uploads/reads/deletes (this is why CPO meter-reading PDF uploads failed for logged-in users; fixed in `fix_cpo_pdf_storage_authenticated` by widening the `cpo-pm pdfs` policies to `anon, authenticated`).

**When you add a new table**
- Enable RLS and add `FOR ALL TO authenticated USING (true) WITH CHECK (true)`.
- If a customer-portal / public / QR (anonymous) screen must reach it, add an `anon` policy too — and keep the `authenticated` one.
- Privileged operations (anything reading a secret or another user's row) go in a `SECURITY DEFINER` function granted to the right role, not direct table access.

**When you add a new storage bucket** — scope every read/insert/delete policy `TO anon, authenticated` (or `public`), never `anon` alone, or logged-in staff get "violates row-level security policy" on upload. See the `cpo-pm pdfs` gotcha above.

**Supabase query gotcha (data-loss class bug):** a supabase-js query is a lazy thenable — it only runs when you `await` it or call `.then()`. **Never** write `void supabase.from(...).upsert(...)` (it silently never executes). Always `await` it, or attach `.then(({ error }) => …)` and surface the error.

**Concurrency:** writes are last-write-wins (no optimistic locking yet), except TSD work orders which sync via Supabase Realtime (`tsd-sync` channel in [src/workOrderStore.tsx](src/workOrderStore.tsx)). For new shared-edit screens, prefer refetch-after-save and consider an `updated_at` guard.

**Migrations:** apply schema/policy changes via the Supabase MCP `apply_migration` (DDL); use `execute_sql` only for reads/data. Domain data must be Supabase-backed — no in-memory-only stores for anything that must persist or be shared.

## Work order data safety — read before touching `workOrderStore` or the TSD form views

**This module has already lost data once.** A whole-blob write ran against a
*light* (photo-stripped) work order and overwrote the saved `forms[].values`
of five work orders. The photos were base64-only at the time and were
unrecoverable. Everything below exists to stop that happening again — do not
work around any of it.

**Why the risk exists.** `tsd_work_orders.data` is one jsonb blob holding the
whole work order, including every form's answers. The list view deliberately
loads a *light projection* with photo/PDF blobs stripped (a full load is ~14 MB).
So an in-memory work order is either **light** (forms present, values stripped)
or **hydrated** (real values). Writing a light row back to the server destroys
the answers.

**The four rules:**

1. **Metadata edits go through `patchWorkOrder`** — assignee, status, title,
   category, instructions, schedule. It calls the `tsd_work_order_patch` RPC,
   which merges server-side (`data = data || patch`), so untouched fields —
   including `forms` — are never rewritten. This is always safe on a light row.
2. **Only `saveDraft` / `submit` / `amend` / `createWorkOrder` write the whole
   blob**, and they must be handed *hydrated* forms by the caller. Don't add a
   fifth whole-blob writer without a very good reason.
3. **Hydrate before you render an editor.** `loadWorkOrderDetail(id)` pulls the
   full row; the editor must not mount until it resolves. Both callers gate on
   this — `hydratedId === active.id` in [TechApp](src/screens/tsd/TechApp.tsx),
   `detailReadyId === selected.id` in [PICApp](src/screens/tsd/PICApp.tsx). A form
   that mounts on a light row will save emptiness over real answers.
4. **A background refetch must not clobber a hydrated row.** The list loader
   merges with `formsAreFull()` in [workOrderStore](src/workOrderStore.tsx) —
   keep that check when touching the load path.

**New media goes to Storage, never into the blob.** Use `uploadFormPhoto` /
`uploadFormPdf` from [lib/formMedia.ts](src/lib/formMedia.ts); the value stored in
the form is a public URL. Readers accept both that and legacy inline base64, so
never "clean up" the base64 branch — older work orders still rely on it.

**Recovery.** Applied by [db/tsd_backup_and_history.sql](db/tsd_backup_and_history.sql),
in a `backup` schema that is not API-exposed:

- `backup.tsd_work_orders_history` — a trigger keeps the **previous** value of
  every work order on each UPDATE/DELETE, so a bad write is reversible. No-op
  writes aren't recorded.
- `backup.tsd_snapshot('label')` — takes a labelled point-in-time copy of the
  work orders + form templates. **Run one before any risky data change.**

Restore recipes are in the comments at the bottom of that SQL file.

## Brand tokens — use these, don't hardcode

All brand colours come from [src/theme.ts](src/theme.ts) via the `C` object. Never write `#2A9A47` in a component file — write `C.green`.

| Token         | Hex       | Use                                                  |
|---------------|-----------|------------------------------------------------------|
| `C.green`     | `#2A9A47` | Primary. Titles, KPI accent card bg, primary buttons, active states |
| `C.honeydew`  | `#E6F4EA` | Pale green tint. Active nav, chips, banners, modal subsections    |
| `C.yellow`    | `#F18A47` | Orange accent — secondary categories in charts, "premium" tags   |
| `C.opal`      | `#1B8FD4` | Blue accent — tertiary categories, energy/CPO context           |
| `C.seasalt`   | `#F7FAFC` | Page bg, table thead bg, grouped form section bg                |
| `C.slate`     | `#5B6B7A` | Secondary text, label text, muted icons                         |
| `C.white`     | `#FFFFFF` | Card surface                                                    |

### Local status palettes are OK

Status-badge colour maps (e.g. `STATUS_COLORS` in [workOrderStore.tsx](src/workOrderStore.tsx), `INVOICE_STATUS_COLORS` in [Invoices.tsx](src/screens/Invoices.tsx)) hold their own `{ bg, color }` pairs. These are **local context maps**, not brand tokens — keep them next to where they're used. Common pairings:

| Semantic | bg        | color     |
|----------|-----------|-----------|
| Success  | `#E4F3E3` | `#1B512D` |
| Info     | `#E3F0FF` | `#1A62C0` |
| Warning  | `#FFF8E1` | `#B07D00` |
| Danger   | `#FDEAEA` | `#C0321A` |
| Purple   | `#F0E8FF` | `#6B21A8` |
| Amber    | `#FFF0E0` | `#B45309` |
| Neutral  | `#F3F3F3` | `#767B77` |

Don't invent new pairs without checking these first.

## Typography

| Role                | Size | Weight | Other                                          |
|---------------------|------|--------|------------------------------------------------|
| Page title          | 18   | 700    | `color: C.green`, `letterSpacing: '-0.02em'`   |
| Section heading     | 14   | 700    | `color: C.green`                               |
| KPI value           | 32   | 700    | `color: C.green` / `C.white` on accent, `letterSpacing: '-0.04em'`, `lineHeight: 1` |
| Body                | 13   | 400-600| `color: '#1a1a1a'`                             |
| Body secondary      | 12   | 400    | `color: C.slate`                               |
| Field label (caps)  | 11   | 700    | `color: C.slate`, `textTransform: 'uppercase'`, `letterSpacing: '0.05em'` |
| Tiny meta (caps)    | 10   | 700    | `letterSpacing: '0.04em'`                      |
| Badge text          | 11   | 700    | `letterSpacing: '0` (none)                     |

Font family is inherited from `body` — only set it explicitly inside form controls (`input`, `select`, `textarea`, `button`), which otherwise reset to the user-agent font: always pass `fontFamily: 'Figtree'`.

## Spacing & radii rhythm

Stick to this scale. Don't introduce 13px padding or 17px gaps.

- **Border radius**: `20` modal, `16` large card, `14` medium card, `12` small card / button row, `10` button & input, `8` small button, `99` pill / chip, `6` tag
- **Card padding**: `'20px 24px'` standard, `28` modal, `'16px 20px'` compact list card, `'12px 16px'` toolbar block
- **Gap between cards**: `12` tight, `14` KPI row default, `16` grid sections, `20-24` between major rows
- **Page content padding**: `24` (TSD admin), `28` (top dashboard)
- **Border**: `'1px solid #EBEBEB'` (default), `'1px solid #F3F3F3'` (lighter dividers), `'1.5px solid …'` for selected list items, `'2px solid …'` for active modal pills

## Component primitives — reuse, don't reinvent

Located in [src/components/](src/components/):

- **[KPICard](src/components/KPICard.tsx)** — stat tile. Has `accent` variant (filled green) for the lead KPI. Always 4-up in `repeat(4, 1fr)` grid with 14-16 gap.
- **[Badge](src/components/Badge.tsx)** — generic status pill. Add new status keys to its map; don't duplicate the pill shape.
- **[NavItem](src/components/NavItem.tsx)** — sidebar nav row. Takes a `LucideIcon` component, not a string. Active = honeydew bg + green text + 6×6 green dot on the right.
- **[Logo](src/components/Logo.tsx)** — official EVOne marque PNG. Use this for the main brand mark, never `<img>` directly. Default height 36; use 26-34 in headers and 44 on splash screens.
- **[BrandLogo](src/components/BrandLogo.tsx)** — secondary brand / platform PNGs (`evone`, `eve`, `goparkin`, `sp`). Use `<BrandLogo brand="eve" height={26} />` instead of importing the asset by hand.
- **[charts.tsx](src/components/charts.tsx)** — `Sparkline`, `MiniBar`, `Donut`, `LineChart`, `BarChart`. SVG-based, no chart library. Grid line colour is `#E4F3E3`. Default chart colour is `C.green`, secondary is `C.opal`.
- **[ChargerLocationMap](src/components/ChargerLocationMap.tsx)** — Leaflet (lazy-loaded from a CDN, no npm dep) over CartoDB Positron tiles, with brand-coloured SVG pins. Reuse for any SG map view.
- **[OneMapAutocomplete](src/components/OneMapAutocomplete.tsx)** — Singapore address typeahead over OneMap's free Elastic-search endpoint (`src/lib/onemap.ts`). Auto-fills lat/lng on pick.

If you need a new primitive, add it here. Don't rebuild a KPI card inline in a screen. For one-off icon spans (search glyph, mailto/tel link prefix, download-arrow chip) just render Lucide inline — don't make a wrapper component.

### Form rendering is shared too

[src/screens/tsd/TechApp.tsx](src/screens/tsd/TechApp.tsx) exports `FormPaper`, `FormHeader`, `FieldList` (the A4-styled report renderer). [PICApp.tsx](src/screens/tsd/PICApp.tsx) reuses these. Don't fork — extend the shared renderer if a new field type is needed.

### Tech department lives in the main Dashboard

There is no longer a TSDWorkspace sub-role chooser. Tech users see standard sidebar entries — `Technician` as a leaf plus a `TSD Admin` group (Work Orders / Form Templates / PIC Review). `TechApp` accepts an embedded mode (no `onBack` / `onSignOut`) so its internal Shell hides its own chrome when rendered inside the Dashboard.

## Repeated UI patterns (recipes)

### Card

```tsx
<div style={{ background: C.white, borderRadius: 16, padding: '20px 24px', border: '1px solid #EBEBEB' }}>…</div>
```

### Table

- `thead tr` → `background: C.seasalt`
- `th` → `padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB'`
- `tr` → `borderBottom: '1px solid #F3F3F3', cursor: 'pointer'`
- Row hover: `onMouseEnter={e => e.currentTarget.style.background = '#FAFAFA'}` / `onMouseLeave={… = 'transparent'}` — **inline JS, not CSS `:hover`**, because we're using inline styles
- `td` → `padding: '12-13px x 16px'`
- Primary cell (id / amount / metric) → `fontWeight: 700, color: C.green`
- Secondary cell → `color: C.slate`

See [Suppliers.tsx](src/screens/Suppliers.tsx) or [Invoices.tsx](src/screens/Invoices.tsx) for canonical examples.

### Search input (pill-shaped)

```tsx
import { Search } from 'lucide-react';

<div style={{ position: 'relative', width: 220 }}>
  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="…"
    style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB',
             fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}/>
  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                 color: C.slate, display: 'inline-flex' }}>
    <Search size={14} />
  </span>
</div>
```

### Filter pill row

Active = filled green, inactive = white with `1px solid #EBEBEB`. See the toolbar in [Invoices.tsx](src/screens/Invoices.tsx) or [PurchaseOrders.tsx](src/screens/PurchaseOrders.tsx).

### Primary action button

```tsx
<button style={{ padding: '8-10px 18-24px', borderRadius: 10, border: 'none',
                 background: C.green, color: C.white,
                 fontFamily: 'Figtree', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
  + New Thing
</button>
```

Outline variant: swap `background: 'transparent', color: C.green, border: '1px solid ' + C.green`.

### Modal

- Overlay: `position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center'`
- **Close ONLY via the X button.** Do not wire close-on-overlay-click — we had it, users dismissed forms by accident, so it was removed app-wide.
- Card: `borderRadius: 20, padding: 28, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)'`
- Close button: 32×32, `background: '#F3F3F3'`, glyph `×` (one place a literal `×` survives — every other glyph is Lucide).
- Grouped subsection inside modal (e.g. "Bill To"): wrap in `background: C.seasalt, borderRadius: 12, padding: 16`.
- Destructive actions inside a modal use an inline confirm banner (red bg `#FDEAEA`, red copy, Cancel / "Yes, Delete" buttons) — never a second nested modal.

See [InvoiceModal](src/screens/Invoices.tsx) for the full pattern.

### Form field label

```tsx
<label style={{ fontSize: 11, fontWeight: 700, color: C.slate,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                display: 'block', marginBottom: 6 }}>
  Field Label
</label>
```

## Icons

Use `lucide-react`. The prior Unicode-glyph identity is gone. Map a screen / action to a semantically close Lucide icon (Customers → `Users`, Projects → `FolderKanban`, Invoices → `Receipt`, Charging → `Zap`, Sign-out → `Power`, Search → `Search`, Download → `Download`, Mail → `Mail`, Phone → `Phone`, Edit → `Pencil`, Folder/empty → `FolderClosed`, etc.).

**Action button / inline label** — Lucide inline with `display: 'inline'` + `verticalAlign` so it sits centred with the text:

```tsx
import { Download } from 'lucide-react';

<button>
  <Download size={12} strokeWidth={2.25}
    style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }}/>
  PDF
</button>
```

**Sidebar** — `NavItem` takes a `LucideIcon` component reference (the type, not an instance). Set it in `NAV_ALL` inside [App.tsx](src/App.tsx).

**Empty states** — center a larger Lucide icon (`size={32}`, `strokeWidth={1.5}`, `color={C.slate}`) above the placeholder copy.

**Only literal glyph that survived:** the modal close button still renders `×`. Everything else — `⌕ ⏻ ⬇ ✉ ☎ 📁 📄 📅 🛠` — is Lucide now.

## File / directory conventions

```
db/                         SQL of record for schema/policy changes applied via
                            the Supabase MCP — charger_projects.sql,
                            site_chargers_lta_letter_date.sql,
                            tsd_backup_and_history.sql. Keep these in sync when
                            you apply a migration, so a fresh environment can be
                            rebuilt from the repo alone.
src/
  theme.ts                  brand tokens (C)
  data.ts                   demo/static data used by a few legacy screens
  workOrderStore.tsx        Context + types for the TSD Work Order module
  permissions.tsx           Departments, ScreenKeys, PermissionsProvider, can()
  main.tsx                  root + provider mounting
  App.tsx                   permission-gated screen routing only — no UI here
  styles.css                global reset + scrollbar; do not grow
  assets/                   brand PNGs (evone-logo, eve-logo, goparkin-logo, sp-logo)
  lib/                      supabase.ts (client), onemap.ts (SG geocoder),
                            formMedia.ts (TSD photo/PDF → Storage),
                            compressImage.ts, navLinks.ts (Google Maps directions),
                            ltaEmail.ts, useIsMobile.ts, zip.ts, version.ts
  components/               KPICard, Badge, NavItem, Logo, BrandLogo,
                            charts, ChargerLocationMap, OneMapAutocomplete,
                            SearchSelect (brand searchable dropdown),
                            TechAvatar, AvatarCropper
  screens/
    Overview.tsx, Invoices.tsx, Customers.tsx, Projects.tsx, …
                            one file per top-level screen; export `ScreenFoo`
    Projects.tsx            Charger Registry — sites, chargers, LTA inspection
                            schedule (Form A/D), warranty. The biggest screen.
    Login.tsx               department picker + email/password sign-in
    Settings.tsx, DBHealth.tsx
                            in-app admin (Users & Permissions matrix + DB health)
    charging/               sub-tabs for ChargingRecords (CarparksTab, …)
    crm/                    Corporate CRM onboarding —
                            AccountOpening (admin) + PublicApplication (customer)
    portal/                 customer-facing invoice / statement portal
    projmgmt/               ChargerProjects.tsx — the Charger Registry "Projects"
                            module (pm department only): per-project lifecycle
                            with stage-tagged documents, sectioned build
                            checklist with sub-tasks, reusable project types
                            (lifecycle + checklist pairs), dated note log
    tsd/                    Technical Service Dept. workflow:
                            TechApp.tsx      (mobile-style tech app +
                                              shared FormPaper / FormHeader /
                                              FieldList)
                            PICApp.tsx       (review queue + editable PDF view,
                                              exports PICReviewBoard)
                            TSDAdminApp.tsx  (Work Orders + FormBuilder)
                            TechniciansAdmin.tsx
                            OverlayForm.tsx, PDFExport.tsx
```

**Rules:**

- A new top-level screen → `src/screens/Foo.tsx`, exported as `ScreenFoo`.
- A new module (e.g. another self-contained department) → `src/screens/<module>/<ModuleApp>.tsx` plus sub-views in the same folder.
- A new shared primitive → `src/components/Foo.tsx`.
- A new shared module-level store → `src/<module>Store.tsx` with a Context + a `useFooStore()` hook that throws if used outside the provider.
- TypeScript: define an `interface FooProps` for component props. Use string-literal union types (`'open' | 'assigned' | …`) for enums.

## Coding style

- **Inline styles only.** Style objects in JSX. Don't extract to `const styles = StyleSheet.create({…})` or similar — the prototype's style is intentionally co-located with markup.
- **No default exports** except top-level pages bound by tooling (`App.tsx`, `main.tsx`). Everything else is named.
- **No comments** unless explaining a non-obvious WHY. Don't write `// component for X` above an obvious component.
- **No new dependencies** without a clear reason. Bundle-size matters for a self-contained dashboard. If you're tempted to add a date library — use `Date` + `toLocaleDateString`. If you're tempted to add a UI library — re-read this file.
- **PDF generation**: `@react-pdf/renderer`. Canonical use: [PDFExport.tsx](src/screens/tsd/PDFExport.tsx), [CorporateInvoicing.tsx](src/screens/CorporateInvoicing.tsx), [PublicApplication.tsx](src/screens/crm/PublicApplication.tsx). Don't bring in a server-side PDF service.
- **CSV / Excel import**: `xlsx`. See the GoParkin + SP parsers in [CorporateInvoicing.tsx](src/screens/CorporateInvoicing.tsx) and [ChargingRecords.tsx](src/screens/ChargingRecords.tsx).
- **Storage uploads**: Supabase Storage. Sign URLs with `createSignedUrl(path, 60)` for view; pass `{ download: filename }` to force download. See the meter-reading / maintenance flows in [CPOChargers.tsx](src/screens/CPOChargers.tsx).
- **Hover** is done via `onMouseEnter` / `onMouseLeave` on the element itself (mutates `e.currentTarget.style.…`). It's verbose but consistent with inline styling.
- **Lists with selection** (Suppliers, PIC review queue, Form Builder templates) all use the same pattern: list-left + detail-right grid (`'1fr 340px'` or `'280px 1fr'`), selected item gets `1.5px solid C.green` border.
- **Editing a record when switching selection**: pass `key={item.id}` to the editor component so internal `useState` resets. See [PICReportEditor](src/screens/tsd/PICApp.tsx) for the canonical example.

## Don'ts (explicit)

- Don't centralise styles into a shared `styles.ts`.
- Don't introduce Tailwind, CSS Modules, styled-components, emotion, or a UI library.
- Don't use `<img>` for any logo PNG. Use `<Logo />` for the EVOne marque and `<BrandLogo brand="evone|eve|goparkin|sp" />` for everything else — the asset paths are encapsulated there.
- Don't change the global `body { overflow: hidden }` rule — screens manage their own scrolling via `overflowY: 'auto'` on their root.
- Don't hardcode the brand green `#2A9A47` (or any token colour) in a component. Always `C.green`.
- Don't introduce a router. Screen-switch + sub-screen state lives in component state in [App.tsx](src/App.tsx) (a `useState<ScreenKey>`) and module entry points.
- Don't add comments restating what the code does. Don't add JSDoc to every function.
- Don't replace inline styles with a className refactor "for cleanliness". The whole codebase is inline-style — partial migration is worse than either pole.
- Don't add new top-level brand colours. Add a token to `C` in [theme.ts](src/theme.ts) if you really need a new shade; explain why in the commit.

## Quick sanity-check before committing UI

1. Does it use `C.*` for every brand colour?
2. Border-radius is one of `{20, 16, 14, 12, 10, 8, 99, 6}`?
3. Font is Figtree on any new `<input>`, `<select>`, `<textarea>`, `<button>`?
4. Hover on rows mutates `e.currentTarget.style.background`?
5. Section labels are 11px / 700 / uppercase / `0.05em` / `C.slate`?
6. New screen wrapped in a flex column with `gap: 20` (or `24`) between major rows?
7. New table follows the thead `C.seasalt` + uppercase label + row-hover pattern?
8. New modal uses 20-radius card + 28 padding + close-on-overlay-click?

If any of these is "no", revisit before pushing.
