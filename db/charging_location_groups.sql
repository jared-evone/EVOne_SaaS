-- Charging location chart groups — applied 2026-09-29 via MCP.
--
-- WHY: CSMS providers rename locations (SP appends notice text; GoParkin
-- renamed "(Private) EVOne [ TYJ ]" → "[ Tee Yih Jia ]"), which used to split
-- one site's chart into several. This grouping layer merges raw location
-- names into ONE chart at display time — raw records are never rewritten.
-- The member primary key enforces "one location lives in exactly one chart":
-- claiming a location for a chart removes it from its previous one, and a
-- chart left with no members is dropped by the client.
create table charging_location_groups (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  created_at timestamptz not null default now()
);

create table charging_location_group_members (
  carpark_code text primary key,
  group_id     uuid not null references charging_location_groups(id) on delete cascade
);

alter table charging_location_groups enable row level security;
alter table charging_location_group_members enable row level security;
create policy "authenticated full access" on charging_location_groups
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on charging_location_group_members
  for all to authenticated using (true) with check (true);
