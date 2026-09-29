-- Corporate CRM secondary rate — applied 2026-09-29 via MCP.
--
-- A company can carry a flat $/kWh that applies to sessions at selected
-- locations INSTEAD of the base/discounted tier. Those sessions bill at the
-- one flat rate and their kWh does not count toward the volume threshold;
-- all other sessions keep the normal base→discounted tiering. Location names
-- match the location strings in the invoicing sheets / charging records.
alter table crm_companies add column secondary_rate numeric;
alter table crm_companies add column secondary_rate_locations text[] not null default '{}';
