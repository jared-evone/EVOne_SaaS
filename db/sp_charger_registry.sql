-- SP charger registry — applied 2026-09-29 via MCP.
--
-- WHY: SP Mobility renames a location's display name to broadcast customer
-- notices (e.g. "EVOne - StorHub Kallang Avenue - AC charger is unavailable
-- until further notice"). SP charging-record CSVs carry that volatile name in
-- "Location Name", which the app used as the location key — so a notice week
-- split into a ghost location (and, priced separately, imported at $0/kWh).
-- Charger IDs (Connector column) are stable and present on 100% of SP rows,
-- so imports now resolve location + AC/DC type from this registry by
-- charger_id and ignore the CSV's name (kept only as last_seen_name).
--
-- Applied as three steps:

-- 1) migration backup_sp_kallang_rename_rows — recovery copy of the 267 rows
--    the data fix below touched (nothing was deleted):
--   create table if not exists backup.sp_registry_fix_20260929 as
--   select now() as backed_up_at, r.* from crm_charging_records r
--   where r.source = 'sp'
--     and (r.carpark_code = 'EVOne - StorHub Kallang Avenue - AC charger is unavailable until further notice'
--          or r.charger_id = 'SG-SMO-A01563');

-- 2) one-time data fix (execute_sql): folded the 248 ghost-location rows back
--    into 'EVOne - StorHub Kallang Avenue', re-priced them from
--    sp_carpark_prices (they had imported at the ghost row's $0/kWh), and set
--    charge_type='AC' on all SG-SMO-A01563 rows (the SP parser hardcodes DC).

-- 3) migration sp_charger_registry:
create table sp_charger_registry (
  charger_id         text primary key,
  canonical_location text not null,
  charge_type        text not null default 'DC' check (charge_type in ('AC','DC')),
  first_seen         timestamptz,
  last_seen_name     text,
  updated_at         timestamptz not null default now()
);

alter table sp_charger_registry enable row level security;
create policy "authenticated full access" on sp_charger_registry
  for all to authenticated using (true) with check (true);

-- Seed from the (already-cleaned) SP records: post-fix, every charger has
-- exactly one location name; charge_type is uniform per charger.
insert into sp_charger_registry (charger_id, canonical_location, charge_type, first_seen, last_seen_name)
select charger_id,
       min(carpark_code),
       coalesce(max(charge_type), 'DC'),
       min(start_date_time),
       min(carpark_code)
from crm_charging_records
where source = 'sp' and charger_id is not null and carpark_code is not null
group by charger_id;

-- 4) migration sp_charger_price_override — a charger's own rate wins over its
--    carpark rate at import time (Kallang's AC and DC chargers bill
--    differently); null inherits the carpark price. Re-pricing past sessions
--    goes through sp_reprice_charger, which logs the previous amounts to
--    backup.sp_reprice_log before updating (nothing lost).
alter table sp_charger_registry add column price_per_kwh numeric;

create table if not exists backup.sp_reprice_log (
  repriced_at            timestamptz not null default now(),
  record_id              uuid not null,
  charger_id             text,
  old_transaction_amount numeric,
  old_payment_amount     numeric,
  new_price              numeric
);

create or replace function sp_reprice_charger(p_charger_id text, p_price numeric)
returns integer
language plpgsql security definer set search_path = public, backup as $$
declare n integer;
begin
  insert into backup.sp_reprice_log (record_id, charger_id, old_transaction_amount, old_payment_amount, new_price)
  select id, charger_id, transaction_amount, payment_amount, p_price
  from crm_charging_records
  where source = 'sp' and charger_id = p_charger_id;

  update crm_charging_records
  set transaction_amount = case when total_energy_supplied_kwh is null then transaction_amount
                                else round((total_energy_supplied_kwh * p_price)::numeric, 2) end,
      payment_amount     = case when total_energy_supplied_kwh is null then payment_amount
                                else round((total_energy_supplied_kwh * p_price)::numeric, 2) end
  where source = 'sp' and charger_id = p_charger_id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function sp_reprice_charger(text, numeric) from public, anon;
grant execute on function sp_reprice_charger(text, numeric) to authenticated;
