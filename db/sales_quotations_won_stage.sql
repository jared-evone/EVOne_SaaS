-- Sales pipeline: post-win delivery stage — applied 2026-10-01 via MCP.
--
-- Won stays a single status, so won value, win rate and Sales Manager
-- reporting are untouched; won_stage only tracks where a won deal is in
-- delivery (Onboarding → Installing → Completed & invoiced). The Won board
-- column switches between stages from chips in its header, like the shared
-- Long-term / On hold column. NULL = not staged yet (every quote won before
-- this column existed) and shows under the Won column's "All" chip. A fresh
-- win starts at 'onboarding'; leaving Won clears the stage.
alter table sales_quotations add column won_stage text
  check (won_stage in ('onboarding', 'installing', 'completed_invoiced'));
