# EVOne Mega System — Design & Code Conventions

> The whole project is built from the EVOne Design Bundle prototype. Visual fidelity to that prototype is non-negotiable. Read this file before editing anything UI-related.

## Stack

- **Vite + React 18 + TypeScript** (strict). Inline styles only — **no** Tailwind, no CSS-in-JS library, no shadcn/MUI/Chakra. Don't add one.
- **One CSS file**: [src/styles.css](src/styles.css) — global reset + scrollbar only. Don't grow it.
- **One font**: Figtree (loaded from Google Fonts in [index.html](index.html)). Don't add fonts.
- **State**: `useState` + React Context. No Redux/Zustand. The Work Order module's store lives in [src/workOrderStore.tsx](src/workOrderStore.tsx).
- **Routing**: role-based switch in [src/App.tsx](src/App.tsx). No react-router.

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
- **[NavItem](src/components/NavItem.tsx)** — sidebar nav row. Active = honeydew bg + green text + 6×6 green dot on the right.
- **[Logo](src/components/Logo.tsx)** — official EVOne PNG. Use this, never `<img>` directly. Default height 36; use 26-34 in headers and 44 on splash screens.
- **[charts.tsx](src/components/charts.tsx)** — `Sparkline`, `MiniBar`, `Donut`, `LineChart`, `BarChart`. SVG-based, no chart library. Grid line colour is `#E4F3E3`. Default chart colour is `C.green`, secondary is `C.opal`.

If you need a new primitive, add it here. Don't rebuild a KPI card inline in a screen.

### Form rendering is shared too

[src/screens/tsd/TechApp.tsx](src/screens/tsd/TechApp.tsx) exports `FormPaper`, `FormHeader`, `FieldList` (the A4-styled report renderer). The PIC view reuses these. Don't fork — extend the shared renderer if a new field type is needed.

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
<div style={{ position: 'relative', width: 220 }}>
  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="…"
    style={{ width: '100%', padding: '8px 14px 8px 34px', borderRadius: 99, border: '1px solid #EBEBEB',
             fontFamily: 'Figtree', fontSize: 13, outline: 'none', background: C.white }}/>
  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                 color: C.slate, fontSize: 15 }}>⌕</span>
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
- Click on overlay (not card) closes: `onClick={e => { if (e.target === e.currentTarget) onClose(); }}`
- Card: `borderRadius: 20, padding: 28, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18)'`
- Close button: 32×32, `background: '#F3F3F3'`, glyph `×`
- Grouped subsection inside modal (e.g. "Bill To"): wrap in `background: C.seasalt, borderRadius: 12, padding: 16`

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

Use the geometric Unicode glyphs already in the design (`⊞ ◈ ◎ ◉ ◫ ◐ ◧ ▦ ◑`) for nav, status emojis sparingly (`📅 ⌕ ⬇ ⏻ ⚡ ★`). **Do not** add lucide, react-icons, or any icon library — the prototype's identity comes partly from these geometric glyphs.

## File / directory conventions

```
src/
  theme.ts                  brand tokens (C)
  data.ts                   shared static data for the global dashboard
  workOrderStore.tsx        Context + types for the Work Order module
  main.tsx                  root + provider mounting
  App.tsx                   role-based routing only — no UI here
  styles.css                global reset + scrollbar; do not grow
  components/               small primitives shared across screens
  screens/
    Overview.tsx, Invoices.tsx, … one file per top-level screen
    Login.tsx               login + sub-role helpers
    tsd/                    Technical Service Dept. workflow module
      TSDWorkspace.tsx      sub-role chooser (Tech / PIC / Admin)
      TechApp.tsx           technician mobile-style app + shared FormPaper/FieldList
      PICApp.tsx            review queue + editable PDF view
      TSDAdminApp.tsx       work-order management + form builder
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
- **PDF / file export** is a placeholder. When wiring real PDF generation, use `react-pdf` or browser `react-to-print`; don't bring in a backend just for this.
- **Hover** is done via `onMouseEnter` / `onMouseLeave` on the element itself (mutates `e.currentTarget.style.…`). It's verbose but consistent with inline styling.
- **Lists with selection** (Suppliers, PIC review queue, Form Builder templates) all use the same pattern: list-left + detail-right grid (`'1fr 340px'` or `'280px 1fr'`), selected item gets `1.5px solid C.green` border.
- **Editing a record when switching selection**: pass `key={item.id}` to the editor component so internal `useState` resets. See [PICReportEditor](src/screens/tsd/PICApp.tsx) for the canonical example.

## Don'ts (explicit)

- Don't centralise styles into a shared `styles.ts`.
- Don't introduce Tailwind, CSS Modules, styled-components, emotion, or a UI library.
- Don't add a logo PNG anywhere except via `<Logo />`.
- Don't change the global `body { overflow: hidden }` rule — screens manage their own scrolling via `overflowY: 'auto'` on their root.
- Don't hardcode the brand green `#2A9A47` (or any token colour) in a component. Always `C.green`.
- Don't introduce a router. Role-switch + sub-screen state lives in component state in [App.tsx](src/App.tsx) and module entry points.
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
