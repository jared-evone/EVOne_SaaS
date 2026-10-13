-- 2026-10-13 · migration cpo_breakdowns — CPO Chargers gets a Breakdowns tab
-- (beside Meter Readings and Maintenance). Rows come from the tab's log form
-- or from PIC Review filing an approved Breakdown work order. PDFs live in the
-- cpo-maintenance-pdfs bucket under chargers/<id>/breakdowns/.
create table cpo_breakdowns (
  id             uuid primary key default gen_random_uuid(),
  charger_id     uuid not null references cpo_chargers(id) on delete cascade,
  breakdown_date date not null,
  description    text not null,
  technician     text,
  pdf_path       text,
  pdf_filename   text,
  work_order_id  text,
  created_by     text,
  created_at     timestamptz not null default now()
);
create index cpo_breakdowns_charger_idx on cpo_breakdowns (charger_id, breakdown_date desc);
alter table cpo_breakdowns enable row level security;
create policy "authenticated full access" on cpo_breakdowns for all to authenticated using (true) with check (true);
