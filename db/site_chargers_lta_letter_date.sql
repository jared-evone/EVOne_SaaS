-- LTA Inspection Letter Date on a charger.
--
-- The LTA schedule (Form A every 6/24 months, Form D every 12) is counted from
-- an anchor date. Priority, highest first:
--   1. lta_letter_date   — the date on LTA's inspection letter (this column)
--   2. turn_on_date      — registration / commissioning date
--   3. procurement_date  — last resort so the first Form A/D still computes
-- See ltaAnchor() in src/screens/Projects.tsx. When the letter date is set it
-- overrides the registration date for deciding when Forms A & D fall due.
--
-- Apply via the Supabase MCP `apply_migration` (or the SQL editor).

alter table public.site_chargers
  add column if not exists lta_letter_date date;

comment on column public.site_chargers.lta_letter_date is
  'Expiry date on the LTA inspection letter — the date the covered form(s) are due. When set, it is cycle 1''s due date for the forms in lta_letter_forms (the base is backed off one interval). NULL = schedule from registration, then procurement.';

-- Which form(s) the letter's due date applies to: Form A, Form D, or both. The
-- form it does NOT cover keeps scheduling from the registration date.
alter table public.site_chargers
  add column if not exists lta_letter_forms text;

alter table public.site_chargers
  drop constraint if exists site_chargers_lta_letter_forms_chk;
alter table public.site_chargers
  add constraint site_chargers_lta_letter_forms_chk
  check (lta_letter_forms is null or lta_letter_forms in ('A', 'D', 'both'));

update public.site_chargers
  set lta_letter_forms = 'both'
  where lta_letter_date is not null and lta_letter_forms is null;

comment on column public.site_chargers.lta_letter_forms is
  'Which forms the LTA letter due date applies to: A, D, or both. NULL when lta_letter_date is unset.';
