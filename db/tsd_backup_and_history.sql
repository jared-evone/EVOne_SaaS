-- TSD recovery safety net.
--
-- WHY: an early dev session wiped photo values out of several work orders when a
-- whole-blob write ran against a light (photo-stripped) row. The client-side
-- guardrails now prevent that (see § "Work order data safety" in CLAUDE.md), but
-- at the time there was no way to RECOVER — the values were simply gone. These
-- objects make any future bad write reversible.
--
-- The `backup` schema is deliberately NOT in the PostgREST exposed-schema list,
-- so none of it is reachable from the browser client. Everything here is
-- additive: no table in `public` is modified.
--
-- Apply via the Supabase MCP `apply_migration` (or the SQL editor).

create schema if not exists backup;

-- ── Point-in-time snapshots ──────────────────────────────────────
-- Take one before any risky change:  select * from backup.tsd_snapshot('pre-<change>');

create table if not exists backup.tsd_work_orders_snapshot (
  snapshot_label text        not null,
  taken_at       timestamptz not null default now(),
  id             text        not null,
  data           jsonb       not null,
  updated_at     timestamptz,
  primary key (snapshot_label, id)
);

create table if not exists backup.tsd_form_templates_snapshot (
  snapshot_label text        not null,
  taken_at       timestamptz not null default now(),
  id             text        not null,
  name           text,
  kind           text,
  template       jsonb,
  updated_at     timestamptz,
  primary key (snapshot_label, id)
);

create or replace function backup.tsd_snapshot(p_label text)
returns table (table_name text, rows_captured bigint)
language plpgsql
as $$
declare n_wo bigint; n_tpl bigint;
begin
  delete from backup.tsd_work_orders_snapshot   where snapshot_label = p_label;
  delete from backup.tsd_form_templates_snapshot where snapshot_label = p_label;

  insert into backup.tsd_work_orders_snapshot (snapshot_label, id, data, updated_at)
  select p_label, w.id, w.data, w.updated_at from public.tsd_work_orders w;
  get diagnostics n_wo = row_count;

  insert into backup.tsd_form_templates_snapshot (snapshot_label, id, name, kind, template, updated_at)
  select p_label, t.id, t.name, t.kind, t.template, t.updated_at from public.tsd_form_templates t;
  get diagnostics n_tpl = row_count;

  return query
    select 'tsd_work_orders'::text, n_wo
    union all
    select 'tsd_form_templates'::text, n_tpl;
end;
$$;

-- ── Continuous history ───────────────────────────────────────────
-- Every UPDATE/DELETE keeps the row's PREVIOUS value, so a destructive write is
-- always reversible. No-op writes (data unchanged) are not recorded.

create table if not exists backup.tsd_work_orders_history (
  history_id  bigserial primary key,
  changed_at  timestamptz not null default now(),
  operation   text        not null,   -- 'UPDATE' | 'DELETE'
  id          text        not null,   -- the work order id
  old_data    jsonb       not null,   -- the row's value BEFORE the change
  old_updated timestamptz
);

create index if not exists tsd_woh_id_time on backup.tsd_work_orders_history (id, changed_at desc);

create or replace function backup.tsd_work_orders_capture()
returns trigger
language plpgsql
security definer
set search_path = backup, public
as $$
begin
  if tg_op = 'DELETE' then
    insert into backup.tsd_work_orders_history (operation, id, old_data, old_updated)
    values ('DELETE', old.id, old.data, old.updated_at);
    return old;
  end if;

  if new.data is distinct from old.data then
    insert into backup.tsd_work_orders_history (operation, id, old_data, old_updated)
    values ('UPDATE', old.id, old.data, old.updated_at);
  end if;
  return new;
end;
$$;

drop trigger if exists tsd_work_orders_capture_trg on public.tsd_work_orders;
create trigger tsd_work_orders_capture_trg
  before update or delete on public.tsd_work_orders
  for each row execute function backup.tsd_work_orders_capture();

-- ── Recovery recipes ─────────────────────────────────────────────
--
-- Inspect a work order's change history:
--   select history_id, operation, changed_at, old_data->'forms'
--   from backup.tsd_work_orders_history where id = 'WO-2026-1234' order by changed_at desc;
--
-- Roll one work order back to its value before the last change:
--   update public.tsd_work_orders w set data = h.old_data
--   from (select old_data from backup.tsd_work_orders_history
--         where id='WO-2026-1234' order by history_id desc limit 1) h
--   where w.id = 'WO-2026-1234';
--
-- Restore a deleted work order:
--   insert into public.tsd_work_orders (id, data)
--   select id, old_data from backup.tsd_work_orders_history
--   where id='WO-2026-1234' and operation='DELETE' order by history_id desc limit 1;
--
-- Restore everything from a snapshot label:
--   update public.tsd_work_orders w set data = s.data
--   from backup.tsd_work_orders_snapshot s
--   where s.snapshot_label = 'pre-dev-2026-08-18' and s.id = w.id;
