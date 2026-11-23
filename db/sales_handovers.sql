-- Project Handover (Sales → Project Manager) — migration sales_handovers,
-- applied 2026-11-23 via MCP.
--
-- One row per job handed from Sales to the Project Manager. `state` holds the
-- builder choices (same keys as the original shared register, so its exports
-- load unchanged — see src/screens/handover/handoverRules.ts) and `checks` the
-- ticked checklist items. quote_id links the won quotation the job came from;
-- it is SET NULL if that quote is ever deleted, so a handover is never lost
-- with it (company / sales are kept as text on the row). legacy_id is the
-- register's document id, for handovers imported from it.
create table public.sales_handovers (
  id             uuid primary key default gen_random_uuid(),
  quote_id       uuid references public.sales_quotations(id) on delete set null,
  customer_id    uuid references public.customers(id) on delete set null,
  company        text not null default '',
  salesperson_id uuid,
  sales          text,
  pm             text,
  hdate          date,
  status         text not null default 'Draft' check (status in ('Draft', 'Handed over', 'In progress', 'Completed')),
  state          jsonb not null default '{}'::jsonb,
  checks         jsonb not null default '{}'::jsonb,
  done           integer not null default 0,
  total          integer not null default 0,
  legacy_id      text unique,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index sales_handovers_quote_idx on public.sales_handovers (quote_id);
create index sales_handovers_customer_idx on public.sales_handovers (customer_id);

alter table public.sales_handovers enable row level security;
create policy "authenticated full access" on public.sales_handovers
  for all to authenticated using (true) with check (true);

-- Uploaded documents (quotation, cable routing, signed completion form,
-- commissioning photos). Private, login-only — no anonymous flow.
insert into storage.buckets (id, name, public) values ('sales-handover-docs', 'sales-handover-docs', false)
  on conflict (id) do nothing;
create policy "sales handover docs read" on storage.objects for select to authenticated using (bucket_id = 'sales-handover-docs');
create policy "sales handover docs upload" on storage.objects for insert to authenticated with check (bucket_id = 'sales-handover-docs');
create policy "sales handover docs delete" on storage.objects for delete to authenticated using (bucket_id = 'sales-handover-docs');

-- Everyone who can open the Sales Pipeline gets Project Handover with the same
-- rights (keeps full-rights Sales admins admins); adjust per user in Settings.
insert into public.app_user_permissions (user_id, department, screen_key, can_view, can_edit, can_delete)
select user_id, department, 'sales_handover', can_view, can_edit, can_delete
from public.app_user_permissions
where department = 'sales' and screen_key = 'sales' and can_view
on conflict (user_id, department, screen_key) do nothing;

-- 2026-11-23 · data import (no schema change) — the ten handovers that lived
-- in the earlier stand-alone register were recreated here from its printed
-- PDFs, as Draft rows with legacy_id 'phf-20261123-<company>' (unique, so a
-- re-run adds nothing). Each is linked to its Won quotation and customer in
-- the Sales Pipeline; nothing was ticked on any of them, so checks = {}. Their
-- state holds only what differs from a blank handover — normaliseState fills
-- the rest on load. The rows themselves are not repeated here because they
-- carry customers' contact details.

-- 2026-11-23 · the default Project Manager (Wan Shahrilnizam Fadzillah, a
-- Charger Registry / pm account) can open Project Handover: view and edit, no
-- delete. It is a grant in the SALES department, where the screen lives, so
-- that account now also has a Sales section holding just this screen.
insert into public.app_user_permissions (user_id, department, screen_key, can_view, can_edit, can_delete)
values ('f31e5ae0-84bc-4409-bb37-c92caffc51d1', 'sales', 'sales_handover', true, true, false)
on conflict (user_id, department, screen_key) do nothing;
