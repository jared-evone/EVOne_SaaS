-- Charger-build project management (Charger Registry department → "Projects").
-- One row per project; the whole BuildProject object lives in `data` (jsonb),
-- same pattern as tsd_work_orders, so the shape can evolve without migrations.
--
-- Apply via the Supabase MCP `apply_migration` (or the SQL editor) when the
-- connection is back. Until then the Projects screen runs in preview mode with
-- sample data.

create table if not exists public.charger_projects (
  id         uuid primary key default gen_random_uuid(),
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.charger_projects enable row level security;

-- Internal screen (Charger Registry dept). Logged-in staff only; anon denied.
create policy "charger_projects_all_authenticated"
  on public.charger_projects
  for all to authenticated
  using (true) with check (true);

-- Private bucket for stage-tagged project documents (viewed via signed URLs).
insert into storage.buckets (id, name, public)
values ('charger-project-docs', 'charger-project-docs', false)
on conflict (id) do nothing;

create policy "charger_project_docs_read"   on storage.objects for select to anon, authenticated using (bucket_id = 'charger-project-docs');
create policy "charger_project_docs_insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'charger-project-docs');
create policy "charger_project_docs_update" on storage.objects for update to anon, authenticated using (bucket_id = 'charger-project-docs') with check (bucket_id = 'charger-project-docs');
create policy "charger_project_docs_delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'charger-project-docs');

-- Reusable project types. Each pairs a lifecycle timeline (`stages`) with the
-- build checklist (`sections`) — creating a project from one applies both.
create table if not exists public.charger_project_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  stages     jsonb not null default '[]'::jsonb,
  sections   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.charger_project_templates enable row level security;

create policy "charger_project_templates_all_authenticated"
  on public.charger_project_templates
  for all to authenticated
  using (true) with check (true);
