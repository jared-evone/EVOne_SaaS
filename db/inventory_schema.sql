-- Inventory department schema — applied 2026-10-01 via MCP (migration inventory_module).
-- Data migrated from Excel: see inventory_seed.sql.
--
-- STANDALONE BY DESIGN: nothing outside the Inventory department reads or
-- writes these tables. Sales, the Charger Registry and TSD never change stock;
-- customer / project / charger references here are plain text.
--
-- Stock is never edited directly. Every change is a row in inv_movements
-- (opening, receipt, issue, transfer_in/out, adjustment, spoilt, cannibalised,
-- return) and on-hand per item × location is their sum (view inv_on_hand).
-- Multi-row operations run in the plpgsql functions below, so each is atomic.
-- Locations: Toh Guan, Paya Ubi, and Spoilt (usable = false, quarantine —
-- excluded from the usable total, exactly like the Excel "Spoilt" column).

create table inv_locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  code       text,
  usable     boolean not null default true,
  sort_order int not null default 0
);

create table inv_items (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  brand         text,
  category      text,
  reorder_point int,
  reorder_qty   int,
  unit_price    numeric,
  notes         text,
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index inv_items_name_brand_uq on inv_items (lower(name), lower(coalesce(brand, '')));

create table inv_movements (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references inv_items(id) on delete restrict,
  location_id uuid not null references inv_locations(id) on delete restrict,
  qty         int  not null check (qty <> 0),
  kind        text not null check (kind in ('opening','receipt','issue','transfer_in','transfer_out','adjustment','spoilt','cannibalised','return')),
  moved_on    date not null default current_date,
  ref_type    text,
  ref_id      uuid,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index inv_movements_item_idx on inv_movements (item_id, location_id);
create index inv_movements_date_idx on inv_movements (moved_on desc, created_at desc);

create view inv_on_hand with (security_invoker = true) as
  select item_id, location_id, sum(qty)::int as qty
  from inv_movements group by item_id, location_id;

create table inv_requests (
  id                    uuid primary key default gen_random_uuid(),
  pr_no                 text not null unique,
  submitted_on          date not null default current_date,
  employee              text,
  department            text,
  company_project       text,
  delivery_address      text,
  item_id               uuid references inv_items(id) on delete set null,
  item_name             text not null,
  qty                   int not null check (qty > 0),
  required_by           date,
  remarks               text,
  status                text not null default 'pending'
                          check (status in ('legacy','pending','approved','fulfilled','cancelled')),
  do_no                 text unique,
  fulfilled_location_id uuid references inv_locations(id),
  fulfilled_on          date,
  delivered_by          text,
  delivery_note         text,
  created_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table inv_shipments (
  id              uuid primary key default gen_random_uuid(),
  legacy_no       int,
  supplier        text,
  po_no           text,
  employee        text,
  customer        text,
  warranty        text,
  description     text not null,
  item_id         uuid references inv_items(id) on delete set null,
  qty             int not null check (qty > 0),
  mode            text,
  order_date      date,
  in_transit_date date,
  eta             date,
  eta_note        text,
  status          text not null default 'ordered'
                    check (status in ('ordered','in_transit','partial','received','cancelled')),
  received_on     date,
  notes           text,
  legacy          boolean not null default false,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table inv_grn (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid references inv_shipments(id) on delete set null,
  po_no        text,
  received_on  date,
  supplier     text,
  item_id      uuid references inv_items(id) on delete set null,
  item_name    text not null,
  qty_ordered  int,
  qty_received int,
  location_id  uuid references inv_locations(id),
  condition    text,
  notes        text,
  status       text not null default 'received' check (status in ('pending','received')),
  posted       boolean not null default false,
  legacy       boolean not null default false,
  created_by   text,
  created_at   timestamptz not null default now()
);

create table inv_cannibalisations (
  id                  uuid primary key default gen_random_uuid(),
  cb_no               text not null unique,
  taken_on            date not null default current_date,
  part_item_id        uuid references inv_items(id) on delete set null,
  part_name           text not null,
  qty                 int not null check (qty > 0),
  source              text not null check (source in ('stock','charger')),
  source_location_id  uuid references inv_locations(id),
  donor_item_id       uuid references inv_items(id) on delete set null,
  donor_note          text,
  used_for            text,
  charger_ref         text,
  reason              text,
  status              text not null default 'awaiting' check (status in ('awaiting','replenished','written_off')),
  replenished_on      date,
  replenish_note      text,
  created_by          text,
  created_at          timestamptz not null default now()
);

alter table inv_locations enable row level security;
alter table inv_items enable row level security;
alter table inv_movements enable row level security;
alter table inv_requests enable row level security;
alter table inv_shipments enable row level security;
alter table inv_grn enable row level security;
alter table inv_cannibalisations enable row level security;
create policy "authenticated full access" on inv_locations for all to authenticated using (true) with check (true);
create policy "authenticated full access" on inv_items for all to authenticated using (true) with check (true);
create policy "authenticated full access" on inv_movements for all to authenticated using (true) with check (true);
create policy "authenticated full access" on inv_requests for all to authenticated using (true) with check (true);
create policy "authenticated full access" on inv_shipments for all to authenticated using (true) with check (true);
create policy "authenticated full access" on inv_grn for all to authenticated using (true) with check (true);
create policy "authenticated full access" on inv_cannibalisations for all to authenticated using (true) with check (true);

-- ── Stock-changing operations (each one atomic) ──────────────────

create or replace function inv_transfer(p_item uuid, p_from uuid, p_to uuid, p_qty int, p_spoilt boolean, p_date date, p_note text, p_by text)
returns void language plpgsql as $$
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than zero'; end if;
  if p_from = p_to then raise exception 'Pick two different locations'; end if;
  insert into inv_movements (item_id, location_id, qty, kind, moved_on, note, created_by) values
    (p_item, p_from, -p_qty, case when p_spoilt then 'spoilt' else 'transfer_out' end, coalesce(p_date, current_date), p_note, p_by),
    (p_item, p_to,    p_qty, case when p_spoilt then 'spoilt' else 'transfer_in'  end, coalesce(p_date, current_date), p_note, p_by);
end $$;

create or replace function inv_record_grn(p_item uuid, p_supplier text, p_po text, p_qty_ordered int, p_qty_received int,
  p_location uuid, p_date date, p_condition text, p_note text, p_by text)
returns uuid language plpgsql as $$
declare g uuid;
begin
  if p_qty_received is null or p_qty_received < 0 then raise exception 'Enter the quantity received'; end if;
  insert into inv_grn (po_no, received_on, supplier, item_id, item_name, qty_ordered, qty_received, location_id, condition, notes, status, posted, created_by)
  values (p_po, coalesce(p_date, current_date), p_supplier, p_item, (select name from inv_items where id = p_item),
          p_qty_ordered, p_qty_received, p_location, p_condition, p_note, 'received', p_qty_received > 0, p_by)
  returning id into g;
  if p_qty_received > 0 then
    insert into inv_movements (item_id, location_id, qty, kind, moved_on, ref_type, ref_id, note, created_by)
    values (p_item, p_location, p_qty_received, 'receipt', coalesce(p_date, current_date), 'grn', g, nullif(trim(coalesce(p_po, '')), ''), p_by);
  end if;
  return g;
end $$;

create or replace function inv_receive_shipment(p_shipment uuid, p_qty int, p_location uuid, p_date date, p_condition text, p_note text, p_by text)
returns uuid language plpgsql as $$
declare s inv_shipments; g uuid; prior int; total int;
begin
  select * into s from inv_shipments where id = p_shipment for update;
  if not found then raise exception 'Shipment not found'; end if;
  if s.item_id is null then raise exception 'Link this shipment to an inventory item before receiving it'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'Enter the quantity received'; end if;
  select coalesce(sum(qty_received), 0) into prior from inv_grn where shipment_id = s.id and status = 'received';
  insert into inv_grn (shipment_id, po_no, received_on, supplier, item_id, item_name, qty_ordered, qty_received, location_id, condition, notes, status, posted, created_by)
  values (s.id, s.po_no, coalesce(p_date, current_date), s.supplier, s.item_id, (select name from inv_items where id = s.item_id),
          greatest(s.qty - prior, 0), p_qty, p_location, p_condition, p_note, 'received', p_qty > 0, p_by)
  returning id into g;
  if p_qty > 0 then
    insert into inv_movements (item_id, location_id, qty, kind, moved_on, ref_type, ref_id, note, created_by)
    values (s.item_id, p_location, p_qty, 'receipt', coalesce(p_date, current_date), 'grn', g, s.po_no, p_by);
  end if;
  total := prior + p_qty;
  update inv_shipments
     set status = case when total >= s.qty then 'received' else 'partial' end,
         received_on = coalesce(p_date, current_date), updated_at = now()
   where id = s.id;
  return g;
end $$;

create or replace function inv_complete_grn(p_grn uuid, p_qty int, p_location uuid, p_date date, p_condition text, p_by text)
returns void language plpgsql as $$
declare g inv_grn;
begin
  select * into g from inv_grn where id = p_grn for update;
  if not found then raise exception 'Receipt not found'; end if;
  if g.status <> 'pending' then raise exception 'This receipt is already completed'; end if;
  if g.item_id is null then raise exception 'Link this line to an inventory item first'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'Enter the quantity received'; end if;
  update inv_grn set status = 'received', qty_received = p_qty, location_id = p_location,
         received_on = coalesce(p_date, current_date), condition = coalesce(p_condition, condition), posted = p_qty > 0
   where id = p_grn;
  if p_qty > 0 then
    insert into inv_movements (item_id, location_id, qty, kind, moved_on, ref_type, ref_id, note, created_by)
    values (g.item_id, p_location, p_qty, 'receipt', coalesce(p_date, current_date), 'grn', g.id, g.po_no, p_by);
  end if;
end $$;

create or replace function inv_fulfil_request(p_request uuid, p_location uuid, p_date date, p_delivered_by text, p_note text, p_by text)
returns text language plpgsql as $$
declare r inv_requests; v_do text; n int;
begin
  select * into r from inv_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status not in ('pending', 'approved') then raise exception 'Only pending or approved requests can be fulfilled'; end if;
  if r.item_id is null then raise exception 'Link this request to an inventory item first'; end if;
  select count(*) + 1 into n from inv_requests where do_no is not null;
  v_do := 'DO-' || to_char(coalesce(p_date, current_date), 'YYYY') || '-' || lpad(n::text, 4, '0');
  insert into inv_movements (item_id, location_id, qty, kind, moved_on, ref_type, ref_id, note, created_by)
  values (r.item_id, p_location, -r.qty, 'issue', coalesce(p_date, current_date), 'request', r.id,
          r.pr_no || coalesce(' · ' || r.company_project, ''), p_by);
  update inv_requests set status = 'fulfilled', do_no = v_do, fulfilled_location_id = p_location,
         fulfilled_on = coalesce(p_date, current_date), delivered_by = p_delivered_by, delivery_note = p_note, updated_at = now()
   where id = r.id;
  return v_do;
end $$;

create or replace function inv_cannibalise(p_part uuid, p_part_name text, p_qty int, p_source text, p_location uuid,
  p_donor_item uuid, p_donor_note text, p_used_for text, p_charger_ref text, p_reason text, p_date date, p_by text)
returns text language plpgsql as $$
declare v_no text; n int; c uuid;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than zero'; end if;
  if p_source = 'stock' and (p_part is null or p_location is null) then
    raise exception 'Pick the part and the location it was taken from';
  end if;
  select count(*) + 1 into n from inv_cannibalisations;
  v_no := 'CB-' || to_char(coalesce(p_date, current_date), 'YYYY') || '-' || lpad(n::text, 4, '0');
  insert into inv_cannibalisations (cb_no, taken_on, part_item_id, part_name, qty, source, source_location_id, donor_item_id,
    donor_note, used_for, charger_ref, reason, created_by)
  values (v_no, coalesce(p_date, current_date), p_part, coalesce(nullif(trim(p_part_name), ''), (select name from inv_items where id = p_part)),
    p_qty, p_source, p_location, p_donor_item, p_donor_note, p_used_for, p_charger_ref, p_reason, p_by)
  returning id into c;
  if p_source = 'stock' then
    insert into inv_movements (item_id, location_id, qty, kind, moved_on, ref_type, ref_id, note, created_by)
    values (p_part, p_location, -p_qty, 'cannibalised', coalesce(p_date, current_date), 'cannibalisation', c,
            v_no || coalesce(' · ' || p_charger_ref, ''), p_by);
  end if;
  return v_no;
end $$;

create or replace function inv_replenish_cannibalisation(p_id uuid, p_status text, p_refit_location uuid, p_date date, p_note text, p_by text)
returns void language plpgsql as $$
declare c inv_cannibalisations;
begin
  select * into c from inv_cannibalisations where id = p_id for update;
  if not found then raise exception 'Record not found'; end if;
  if c.status <> 'awaiting' then raise exception 'This record is already closed'; end if;
  if p_status not in ('replenished', 'written_off') then raise exception 'Invalid status'; end if;
  if p_refit_location is not null then
    if c.part_item_id is null then raise exception 'Link the part to an inventory item to take it from stock'; end if;
    insert into inv_movements (item_id, location_id, qty, kind, moved_on, ref_type, ref_id, note, created_by)
    values (c.part_item_id, p_refit_location, -c.qty, 'issue', coalesce(p_date, current_date), 'cannibalisation', c.id,
            'Refit to donor · ' || c.cb_no, p_by);
  end if;
  update inv_cannibalisations set status = p_status, replenished_on = coalesce(p_date, current_date), replenish_note = p_note where id = p_id;
end $$;

revoke execute on function inv_transfer(uuid, uuid, uuid, int, boolean, date, text, text) from public, anon;
revoke execute on function inv_record_grn(uuid, text, text, int, int, uuid, date, text, text, text) from public, anon;
revoke execute on function inv_receive_shipment(uuid, int, uuid, date, text, text, text) from public, anon;
revoke execute on function inv_complete_grn(uuid, int, uuid, date, text, text) from public, anon;
revoke execute on function inv_fulfil_request(uuid, uuid, date, text, text, text) from public, anon;
revoke execute on function inv_cannibalise(uuid, text, int, text, uuid, uuid, text, text, text, text, date, text) from public, anon;
revoke execute on function inv_replenish_cannibalisation(uuid, text, uuid, date, text, text) from public, anon;
grant execute on function inv_transfer(uuid, uuid, uuid, int, boolean, date, text, text) to authenticated;
grant execute on function inv_record_grn(uuid, text, text, int, int, uuid, date, text, text, text) to authenticated;
grant execute on function inv_receive_shipment(uuid, int, uuid, date, text, text, text) to authenticated;
grant execute on function inv_complete_grn(uuid, int, uuid, date, text, text) to authenticated;
grant execute on function inv_fulfil_request(uuid, uuid, date, text, text, text) to authenticated;
grant execute on function inv_cannibalise(uuid, text, int, text, uuid, uuid, text, text, text, text, date, text) to authenticated;
grant execute on function inv_replenish_cannibalisation(uuid, text, uuid, date, text, text) to authenticated;

-- Access (data, via execute_sql): full rights on all six inv_* screens for
-- jaredlau@evone.com.sg, admin@evone.com.sg, admin@evone.com.my. Others are
-- granted from Users & Permissions.

-- 2026-10-01 · migration inventory_brand_category_lists — admin-maintained
-- pick-lists for item Brand / Category (seeded from the values in use). Items
-- keep the text; inv_rename_lookup renames a list entry on every item at once.
-- In the app only Stock Levels admins (can_delete) can add / rename / remove.
create table inv_brands (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order int  not null default 0
);
create unique index inv_brands_name_uq on inv_brands (lower(name));

create table inv_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order int  not null default 0
);
create unique index inv_categories_name_uq on inv_categories (lower(name));

alter table inv_brands enable row level security;
alter table inv_categories enable row level security;
create policy "authenticated full access" on inv_brands for all to authenticated using (true) with check (true);
create policy "authenticated full access" on inv_categories for all to authenticated using (true) with check (true);

insert into inv_brands (name, sort_order)
select brand, row_number() over (order by min(sort_order)) from inv_items where brand is not null group by brand;
insert into inv_categories (name, sort_order)
select category, row_number() over (order by min(sort_order)) from inv_items where category is not null group by category;

create or replace function inv_rename_lookup(p_kind text, p_id uuid, p_new text)
returns void language plpgsql as $$
declare v_old text; v_new text := nullif(trim(p_new), '');
begin
  if v_new is null then raise exception 'Name cannot be empty'; end if;
  if p_kind = 'brand' then
    select name into v_old from inv_brands where id = p_id for update;
    if not found then raise exception 'Brand not found'; end if;
    update inv_brands set name = v_new where id = p_id;
    update inv_items set brand = v_new, updated_at = now() where brand = v_old;
  elsif p_kind = 'category' then
    select name into v_old from inv_categories where id = p_id for update;
    if not found then raise exception 'Category not found'; end if;
    update inv_categories set name = v_new where id = p_id;
    update inv_items set category = v_new, updated_at = now() where category = v_old;
  else
    raise exception 'Unknown list';
  end if;
end $$;
revoke execute on function inv_rename_lookup(text, uuid, text) from public, anon;
grant execute on function inv_rename_lookup(text, uuid, text) to authenticated;

-- 2026-10-01 · migration inv_requests_customer_link — requests pick the company
-- from the customer database (company_project keeps the name as a snapshot, and
-- the original Excel text for migrated rows). Only PR-2026-0030 ("Completion
-- Products") matched a customer exactly and was linked; the rest link in-app.
alter table inv_requests add column customer_id uuid references customers(id) on delete set null;

-- 2026-10-01 · migration inv_spoilt_per_location — spoilt stock is held per
-- location. Each usable location has a quarantine bucket (spoilt_for -> it);
-- "Mark spoilt" in Stock Levels moves usable units into the bucket of the same
-- location (inv_transfer, kind 'spoilt'). The original 'Spoilt' bucket keeps the
-- 8 Excel-migrated spoilt units (location never recorded) until each is tagged
-- to Toh Guan or Paya Ubi in the app.
alter table inv_locations add column spoilt_for uuid references inv_locations(id);

insert into inv_locations (name, code, usable, sort_order, spoilt_for)
select 'Toh Guan — Spoilt', 'TG-SP', false, 3, id from inv_locations where code = 'TG';
insert into inv_locations (name, code, usable, sort_order, spoilt_for)
select 'Paya Ubi — Spoilt', 'PU-SP', false, 4, id from inv_locations where code = 'PU';

update inv_locations set name = 'Spoilt — location not recorded', sort_order = 5 where code = 'SP';

-- 2026-10-02 · migration inv_revert_fulfilment — an admin can send a fulfilled
-- request back to Pending. The stock goes back where it was issued from as a
-- 'return' movement (the original issue stays in the ledger). The DO number is
-- kept in void_do_nos and never handed out again, which is why DO numbering
-- moves from count(*)+1 (would re-issue a freed number) to "after the highest
-- ever used". With no reverts the two give the same number.
alter table inv_requests add column void_do_nos text[] not null default '{}';

create or replace function inv_fulfil_request(p_request uuid, p_location uuid, p_date date, p_delivered_by text, p_note text, p_by text)
returns text language plpgsql as $$
declare r inv_requests; v_do text; n int;
begin
  select * into r from inv_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status not in ('pending', 'approved') then raise exception 'Only pending or approved requests can be fulfilled'; end if;
  if r.item_id is null then raise exception 'Link this request to an inventory item first'; end if;
  perform pg_advisory_xact_lock(hashtext('inv_do_no'));
  select greatest(
           (select count(*) from inv_requests where do_no is not null),
           coalesce((select max(substring(x from '(\d+)$')::int)
                       from (select do_no as x from inv_requests where do_no is not null
                             union all
                             select unnest(void_do_nos) from inv_requests) s), 0)
         ) + 1 into n;
  v_do := 'DO-' || to_char(coalesce(p_date, current_date), 'YYYY') || '-' || lpad(n::text, 4, '0');
  insert into inv_movements (item_id, location_id, qty, kind, moved_on, ref_type, ref_id, note, created_by)
  values (r.item_id, p_location, -r.qty, 'issue', coalesce(p_date, current_date), 'request', r.id,
          r.pr_no || coalesce(' · ' || r.company_project, ''), p_by);
  update inv_requests set status = 'fulfilled', do_no = v_do, fulfilled_location_id = p_location,
         fulfilled_on = coalesce(p_date, current_date), delivered_by = p_delivered_by, delivery_note = p_note, updated_at = now()
   where id = r.id;
  return v_do;
end $$;

create or replace function inv_revert_fulfilment(p_request uuid, p_reason text, p_by text)
returns void language plpgsql as $$
declare r inv_requests; m record;
begin
  select * into r from inv_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'fulfilled' then raise exception 'Only fulfilled requests can be reverted'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for the revert'; end if;
  -- Net out whatever this request still has issued, per item × location. A
  -- legacy "closed during migration" request issued nothing, so returns nothing.
  for m in
    select item_id, location_id, sum(qty)::int as q from inv_movements
     where ref_type = 'request' and ref_id = r.id and kind in ('issue', 'return')
     group by item_id, location_id having sum(qty) <> 0
  loop
    insert into inv_movements (item_id, location_id, qty, kind, moved_on, ref_type, ref_id, note, created_by)
    values (m.item_id, m.location_id, -m.q, 'return', current_date, 'request', r.id,
            'Reverted ' || coalesce(r.do_no || ' · ', '') || r.pr_no || ' — ' || btrim(p_reason), p_by);
  end loop;
  update inv_requests set status = 'pending', do_no = null,
         void_do_nos = case when r.do_no is null then void_do_nos else void_do_nos || r.do_no end,
         fulfilled_location_id = null, fulfilled_on = null, delivered_by = null, delivery_note = null, updated_at = now()
   where id = r.id;
end $$;

revoke execute on function inv_revert_fulfilment(uuid, text, text) from public, anon;
grant execute on function inv_revert_fulfilment(uuid, text, text) to authenticated;
