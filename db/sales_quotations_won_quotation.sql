-- Sales pipeline: what is recorded when a quote is marked Won.
-- Both migrations were applied 2026-11-23 via MCP, and both are additive.
--
-- Added to BOTH pipeline tables: moving a quote between them copies the whole
-- row, so the two must always have the same columns.

-- migration sales_quotations_won_final_price — the final price the customer
-- pays, GST included. Sales keys it in when a quote moves to Won (required
-- then, together with at least one attached quotation PDF). `total` is left
-- alone: it stays the pipeline value (largest quotation version). Every PDF on
-- the quote (versions / files) shows on the Project Handover linked to it —
-- read live from the quote, nothing is copied.
alter table public.sales_quotations
  add column if not exists won_final_price numeric check (won_final_price is null or won_final_price >= 0);
alter table public.cpo_sales_quotations
  add column if not exists won_final_price numeric check (won_final_price is null or won_final_price >= 0);

-- migration sales_quotations_won_quotation — UNUSED. Applied earlier the same
-- day for a first design (pick the ONE accepted quotation + a yes/no "price is
-- after GST"), which the owner replaced with the final-price field above
-- before it shipped. Nothing reads or writes these columns and they are empty
-- on every row. They are recorded here because they exist in the database;
-- drop them only on the owner's say-so.
alter table public.sales_quotations
  add column if not exists won_pdf_path text,
  add column if not exists won_pdf_name text,
  add column if not exists won_price_incl_gst boolean;
alter table public.cpo_sales_quotations
  add column if not exists won_pdf_path text,
  add column if not exists won_pdf_name text,
  add column if not exists won_price_incl_gst boolean;
