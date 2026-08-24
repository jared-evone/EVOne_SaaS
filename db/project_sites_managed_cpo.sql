-- Managed-CPO designation at the SITE level (Charger Registry → site tab).
--
-- A managed-CPO site is public charging owned by the customer but billed
-- through EVOne, because EVOne holds the EVCO licence. The site pays a platform
-- fee per contract term; the app tracks the current term, days to renewal
-- (so the next subscription invoice goes out on time), and the invoices issued.
--
-- APPLIED as migration `project_sites_managed_cpo`.

alter table public.project_sites
  add column if not exists managed_cpo boolean not null default false,
  add column if not exists cpo_platform_fee numeric,      -- fee per term, SGD
  add column if not exists cpo_contract_start date,       -- current term start
  add column if not exists cpo_contract_months integer;   -- term length

create table if not exists public.site_cpo_invoices (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references public.project_sites(id) on delete cascade,
  invoice_date date not null,
  amount       numeric,
  storage_path text,   -- charger-forms bucket, cpo-subscription/{site_id}/…
  filename     text,
  created_at   timestamptz not null default now()
);

create index if not exists site_cpo_invoices_site_idx
  on public.site_cpo_invoices (site_id, invoice_date desc);

alter table public.site_cpo_invoices enable row level security;

create policy "site_cpo_invoices_all_authenticated"
  on public.site_cpo_invoices
  for all to authenticated
  using (true) with check (true);
