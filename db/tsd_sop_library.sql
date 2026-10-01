-- Technical Service SOP Library — applied 2026-10-01 via MCP.
--
-- A controlled library of PDF SOPs: categories + tags for navigation, and
-- document-control metadata on each SOP (unique doc number, revision,
-- effective date, owner, review-due date, draft/active/archived status).
-- Replacing an SOP's PDF moves the outgoing version into tsd_sop_revisions so
-- the audit trail survives; anyone can flag an SOP as wrong/outdated and
-- editors resolve it. Screen: src/screens/tsd/SopLibrary.tsx (screen key
-- 'tsd_sop', tech department).

create table tsd_sop_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

create table tsd_sops (
  id             uuid primary key default gen_random_uuid(),
  doc_no         text not null unique,
  title          text not null,
  description    text,
  category_id    uuid references tsd_sop_categories(id) on delete set null,
  tags           text[] not null default '{}',
  revision       text not null default 'Rev 0',
  revision_note  text,                         -- "what changed" for the current revision
  effective_date date,
  review_due     date,
  owner          text,
  status         text not null default 'active' check (status in ('active', 'draft', 'archived')),
  pinned         boolean not null default false,
  pdf_path       text,
  pdf_filename   text,
  pdf_size       bigint,
  flag_note      text,
  flagged_by     text,
  flagged_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text
);

create table tsd_sop_revisions (
  id             uuid primary key default gen_random_uuid(),
  sop_id         uuid not null references tsd_sops(id) on delete cascade,
  revision       text not null,
  pdf_path       text not null,
  pdf_filename   text,
  pdf_size       bigint,
  effective_date date,
  note           text,
  replaced_at    timestamptz not null default now(),
  replaced_by    text
);
create index tsd_sop_revisions_sop_idx on tsd_sop_revisions (sop_id, replaced_at desc);

alter table tsd_sop_categories enable row level security;
alter table tsd_sops enable row level security;
alter table tsd_sop_revisions enable row level security;
create policy "authenticated full access" on tsd_sop_categories for all to authenticated using (true) with check (true);
create policy "authenticated full access" on tsd_sops for all to authenticated using (true) with check (true);
create policy "authenticated full access" on tsd_sop_revisions for all to authenticated using (true) with check (true);

insert into tsd_sop_categories (name, sort_order) values
  ('Installation', 1),
  ('Commissioning', 2),
  ('Preventive Maintenance', 3),
  ('Breakdown & Troubleshooting', 4),
  ('Safety & Compliance', 5),
  ('General', 6);

-- Private bucket. Internal documents with no anonymous flow, so policies are
-- authenticated-only (unlike buckets that serve the portal / QR flows).
insert into storage.buckets (id, name, public) values ('tsd-sops', 'tsd-sops', false)
  on conflict (id) do nothing;
create policy "tsd_sops_read"   on storage.objects for select to authenticated using (bucket_id = 'tsd-sops');
create policy "tsd_sops_insert" on storage.objects for insert to authenticated with check (bucket_id = 'tsd-sops');
create policy "tsd_sops_update" on storage.objects for update to authenticated using (bucket_id = 'tsd-sops');
create policy "tsd_sops_delete" on storage.objects for delete to authenticated using (bucket_id = 'tsd-sops');

-- Grants for the new screen (data, via execute_sql): mirrors existing tech
-- access — view for everyone who can view the Technician screen, edit for
-- Work Order editors, delete for Work Order deleters (the department admins,
-- who therefore keep full-admin status across every tech screen).
--   insert into app_user_permissions (user_id, department, screen_key, can_view, can_edit, can_delete)
--   select user_id, 'tech', 'tsd_sop', (v or e or d), (e or d), d from (
--     select user_id,
--            bool_or(screen_key = 'tsd_technician' and can_view)  as v,
--            bool_or(screen_key = 'tsd_workorders' and can_edit)  as e,
--            bool_or(screen_key = 'tsd_workorders' and can_delete) as d
--     from app_user_permissions where department = 'tech' group by user_id
--   ) b where v or e or d
--   on conflict (user_id, department, screen_key) do nothing;
