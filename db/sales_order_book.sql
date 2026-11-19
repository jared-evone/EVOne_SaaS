-- Sales Order Book — migration sales_order_book.
--
-- The chargers a WON sales quotation has to supply, one row per charger model,
-- and how each is being bought: linked to a Raise PO (po_id; po_no keeps the
-- number), a PO number raised outside the app (po_no only — matched to Incoming
-- Shipments by number), or supplied from existing stock (from_stock). A line
-- with none of these is a pending purchase.
--
-- quote_id was first created with no ON DELETE action; see the
-- sales_order_lines_quote_cascade_guard migration at the bottom for the
-- current rule (cascade, but blocked once a line has a purchase).
create table public.sales_order_lines (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.sales_quotations(id),
  item_id     uuid references public.inv_items(id) on delete set null,
  item_name   text not null,
  qty         integer not null check (qty > 0),
  from_stock  boolean not null default false,
  po_id       uuid references public.purchase_orders(id) on delete set null,
  po_no       text,
  notes       text,
  position    integer not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index sales_order_lines_quote_idx on public.sales_order_lines (quote_id);
create index sales_order_lines_po_idx on public.sales_order_lines (po_id);

alter table public.sales_order_lines enable row level security;
create policy "authenticated full access" on public.sales_order_lines
  for all to authenticated using (true) with check (true);

-- Everyone who can open the Sales Pipeline gets the Order Book with the same
-- rights; adjust per user in Settings afterwards.
insert into public.app_user_permissions (user_id, department, screen_key, can_view, can_edit, can_delete)
select user_id, department, 'sales_orderbook', can_view, can_edit, can_delete
from public.app_user_permissions
where department = 'sales' and screen_key = 'sales' and can_view
on conflict (user_id, department, screen_key) do nothing;

-- 2026-11-19 · migration sales_order_lines_quote_cascade_guard — chargers are
-- now picked on the quote itself (Sales Pipeline, required for new quotes), so
-- a quote's plain charger list goes with it when the quote is deleted
-- (ON DELETE CASCADE). Once a line has a purchase (PO linked, outside PO
-- number, or from stock) the quote can't be deleted: the guard raises 23503,
-- which Sales shows as a plain message. Moving a quote that has chargers to the
-- CPO Sales Pipeline is refused in the app (moveQuote) so they aren't dropped.
alter table public.sales_order_lines drop constraint sales_order_lines_quote_id_fkey;
alter table public.sales_order_lines add constraint sales_order_lines_quote_id_fkey
  foreign key (quote_id) references public.sales_quotations(id) on delete cascade;

create or replace function public.sales_quote_delete_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from sales_order_lines where quote_id = old.id
             and (po_id is not null or nullif(btrim(po_no), '') is not null or from_stock)) then
    raise exception 'Quote % has charger purchases on the Order Book', old.ref using errcode = '23503';
  end if;
  return old;
end $$;

create trigger sales_quotations_delete_guard before delete on public.sales_quotations
  for each row execute function public.sales_quote_delete_guard();
