-- Corporate CRM location sets — applied 2026-09-29 via MCP.
--
-- Named, reusable sets of charging locations for the secondary-rate picker:
-- instead of adding locations to a company one by one, an admin saves a set
-- once ("Save these locations as a set…" in the company modal) and applies it
-- with "+ Add from set…". Saving an existing name overwrites that set.
create table crm_location_sets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  locations  text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table crm_location_sets enable row level security;
create policy "authenticated full access" on crm_location_sets
  for all to authenticated using (true) with check (true);
