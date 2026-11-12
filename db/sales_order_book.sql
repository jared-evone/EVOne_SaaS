-- Sales Order Book — migration sales_order_book.
--
-- The chargers a WON sales quotation has to supply, one row per charger model,
-- and how each is being bought: linked to a Raise PO (po_id; po_no keeps the
-- number), a PO number raised outside the app (po_no only — matched to Incoming
-- Shipments by number), or supplied from existing stock (from_stock). A line
-- with none of these is a pending purchase.
--
-- quote_id deliberately has no ON DELETE action: a quote that still has order
-- lines can't be deleted (or moved to the CPO Sales Pipeline, which deletes the
-- original row) until its chargers are removed here, so they're never lost
-- silently. The app turns that 23503 error into a plain message.
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
