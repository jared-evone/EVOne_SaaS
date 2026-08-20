-- Breakdown log per charger (Charger Registry → charger → Breakdown tab).
-- One row per incident: what happened, when, with an optional PDF report.
--
-- PDFs go to the existing `charger-forms` bucket under breakdown/{charger_id}/…
-- (its policies are role `public`, so both anon and authenticated pass — no
-- anon-only gotcha). Rows cascade away with the charger; storage objects are
-- swept by collectChargerStoragePaths in src/screens/Projects.tsx.
--
-- APPLIED as migration `charger_breakdowns`.

create table if not exists public.charger_breakdowns (
  id             uuid primary key default gen_random_uuid(),
  charger_id     uuid not null references public.site_chargers(id) on delete cascade,
  breakdown_date date not null,
  description    text not null,
  storage_path   text,
  filename       text,
  created_at     timestamptz not null default now()
);

create index if not exists charger_breakdowns_charger_idx
  on public.charger_breakdowns (charger_id, breakdown_date desc);

alter table public.charger_breakdowns enable row level security;

-- Internal screen: logged-in staff only, anon denied.
create policy "charger_breakdowns_all_authenticated"
  on public.charger_breakdowns
  for all to authenticated
  using (true) with check (true);
