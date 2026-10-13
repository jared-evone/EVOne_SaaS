-- 2026-10-13 · migration sales_quotations_archive — archive (not delete) old
-- quotes in the Sales and CPO Sales pipelines. Archived quotes leave the board
-- and list and sit on the Archived shelf (restorable); they still count in won
-- value / win rate and in the Sales Dashboard, but not in open pipeline value.
alter table sales_quotations     add column archived_at timestamptz, add column archived_by text;
alter table cpo_sales_quotations add column archived_at timestamptz, add column archived_by text;
