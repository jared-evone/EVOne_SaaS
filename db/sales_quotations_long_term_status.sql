-- Sales Pipeline: allow the 'Long-term' quote status.
--
-- A Long-term quote is a tender submission that may take years to convert. It is
-- parked for the record and is deliberately NOT active pipeline — the app's KPIs
-- (pipeline value, open quotes, win rate) test Draft/Sent/Won/Lost explicitly, so
-- a multi-year lead can't flatter the current month. See QUOTE_STATUSES in
-- src/screens/Sales.tsx.
--
-- APPLIED as migration `sales_quotations_allow_long_term_status`. The column did
-- carry a CHECK limited to the original four values, so every attempt to move a
-- quote to Long-term would have failed until this ran. Widening only: all 190
-- existing rows stayed valid and none were modified.

alter table public.sales_quotations
  drop constraint if exists sales_quotations_status_check;

alter table public.sales_quotations
  add constraint sales_quotations_status_check
  check (status = any (array['Draft'::text, 'Sent'::text, 'Won'::text, 'Long-term'::text, 'Lost'::text]));
