-- Sales Pipeline: allow the two PARKED quote statuses.
--
--   'Long-term' — a tender submission that may take years to convert.
--   'On hold'   — the customer has paused it; not for current follow-up.
--
-- Both are parked for the record and are deliberately NOT active pipeline — the
-- app's KPIs (pipeline value, open quotes, win rate) test Draft/Sent/Won/Lost
-- explicitly, so a parked lead can't flatter the current month. They share one
-- switchable board column. See QUOTE_STATUSES / PARKED_STATUSES in
-- src/screens/Sales.tsx.
--
-- APPLIED as migrations `sales_quotations_allow_long_term_status` and
-- `sales_quotations_allow_on_hold_status`. The column originally carried a CHECK
-- limited to Draft/Sent/Won/Lost, so moving a quote to either parked status would
-- have failed until these ran. Widening only: all 190 existing rows stayed valid
-- and none were modified.

alter table public.sales_quotations
  drop constraint if exists sales_quotations_status_check;

alter table public.sales_quotations
  add constraint sales_quotations_status_check
  check (status = any (array['Draft'::text, 'Sent'::text, 'Won'::text, 'Long-term'::text, 'On hold'::text, 'Lost'::text]));
