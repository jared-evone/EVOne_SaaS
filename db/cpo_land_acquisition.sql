-- 2026-10-13 · migration cpo_land_acquisition — Land Acquisition (CPO
-- department, above CPO Sales Pipeline): sites we're trying to secure for CPO
-- charging, from first contact to a signed site contract. Refs LA-YYYY-NNNN.
-- Stages: identified → engaging → survey → proposal → negotiation → signed,
-- plus on_hold / dropped (reason required in the app). Activity log + files
-- are jsonb on the row; documents live in the private cpo-land-docs bucket.
create sequence cpo_land_ref;
create table cpo_land_sites (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default ('LA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('cpo_land_ref')::text, 4, '0')),
  site_name        text not null,
  address          text,
  latitude         numeric,
  longitude        numeric,
  site_type        text,
  lots             int,
  landlord         text,
  contact_name     text,
  contact_phone    text,
  contact_email    text,
  stage            text not null default 'identified'
                     check (stage in ('identified','engaging','survey','proposal','negotiation','signed','on_hold','dropped')),
  proposed_ac      int,
  proposed_dc      int,
  commercial_model text,
  terms            text,
  contract_years   numeric,
  expected_close   date,
  tender_close     date,
  pic              text,
  high_potential   boolean not null default false,
  next_action      text,
  next_action_date date,
  signed_on        date,
  dropped_reason   text,
  cpo_location_id  uuid references cpo_locations(id) on delete set null,
  log              jsonb not null default '[]',
  files            jsonb not null default '[]',
  notes            text,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter sequence cpo_land_ref owned by cpo_land_sites.ref;
create index cpo_land_sites_stage_idx on cpo_land_sites (stage);
alter table cpo_land_sites enable row level security;
create policy "authenticated full access" on cpo_land_sites for all to authenticated using (true) with check (true);

-- Internal-only documents (no anonymous flow) — authenticated policies, like tsd-sops.
insert into storage.buckets (id, name, public, file_size_limit)
values ('cpo-land-docs', 'cpo-land-docs', false, 52428800)
on conflict (id) do nothing;
create policy "cpo land docs read" on storage.objects for select to authenticated using (bucket_id = 'cpo-land-docs');
create policy "cpo land docs upload" on storage.objects for insert to authenticated with check (bucket_id = 'cpo-land-docs');
create policy "cpo land docs delete" on storage.objects for delete to authenticated using (bucket_id = 'cpo-land-docs');

-- Data (execute_sql): screen key cpo_land granted view/edit/delete to the two
-- CPO department admins (admin@evone.com.sg, kyleson@evone.com.sg).
