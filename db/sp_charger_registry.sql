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
