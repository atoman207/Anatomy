-- ============================================================================
-- chondro — full database schema
--
-- Single source of truth for every migration. Apply with `npm run db:push`
-- or paste this file into the Supabase SQL Editor.
--
-- Convention: do not add new numbered *.sql files. Append new schema changes
-- to the end of this file (all.sql), behind a clear section banner.
--
-- Safe to re-run: every statement in the appended sections is guarded.
-- ============================================================================

-- ============================================================================
-- 0001_init.sql
-- ============================================================================

-- ============================================================================
-- chondro — research data management schema
--
-- Everything is scoped to a laboratory. Access is granted through
-- lab_members, and every table enforces it with row-level security so a
-- leaked anon key cannot read another lab's data.
--
-- Safe to re-run: every statement is guarded.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  display_name  text,
  avatar_url    text,
  date_of_birth date,
  phone_number  text,
  major         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_url    text;
alter table public.profiles add column if not exists date_of_birth date;
alter table public.profiles add column if not exists phone_number  text;
alter table public.profiles add column if not exists major         text;

create table if not exists public.laboratories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  owner_id    uuid not null references auth.users (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$ begin
  create type public.lab_role as enum ('owner', 'admin', 'member', 'viewer');
exception when duplicate_object then null; end $$;

create table if not exists public.lab_members (
  lab_id    uuid not null references public.laboratories (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      public.lab_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (lab_id, user_id)
);

create index if not exists lab_members_user_idx on public.lab_members (user_id);

-- ---------------------------------------------------------------------------
-- Experiments
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  lab_id      uuid not null references public.laboratories (id) on delete cascade,
  name        text not null,
  description text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_lab_idx on public.projects (lab_id);

do $$ begin
  create type public.experiment_status as enum ('planned', 'in_progress', 'complete', 'archived');
exception when duplicate_object then null; end $$;

create table if not exists public.experiments (
  id              uuid primary key default gen_random_uuid(),
  lab_id          uuid not null references public.laboratories (id) on delete cascade,
  project_id      uuid references public.projects (id) on delete set null,
  name            text not null,
  experiment_date date not null default current_date,
  operator        text,
  purpose         text,
  status          public.experiment_status not null default 'in_progress',
  tags            text[] not null default '{}',
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists experiments_lab_idx  on public.experiments (lab_id);
create index if not exists experiments_date_idx on public.experiments (experiment_date desc);

-- ---------------------------------------------------------------------------
-- Notebook
-- ---------------------------------------------------------------------------

create table if not exists public.notebook_templates (
  id          uuid primary key default gen_random_uuid(),
  lab_id      uuid not null references public.laboratories (id) on delete cascade,
  slug        text not null,
  name        text not null,
  description text,
  category    text,
  -- Array of {key,label,type,required,options,defaultValue}
  fields      jsonb not null default '[]'::jsonb,
  body        text not null default '',
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (lab_id, slug)
);

create table if not exists public.notebook_entries (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null references public.laboratories (id) on delete cascade,
  experiment_id uuid not null references public.experiments (id) on delete cascade,
  template_id   uuid references public.notebook_templates (id) on delete set null,
  template_slug text,
  title         text not null,
  -- Field values captured from the template form.
  values        jsonb not null default '{}'::jsonb,
  -- Rendered Markdown. Kept separate from `values` so later edits to the
  -- body never rewrite what was originally recorded.
  body_md       text not null default '',
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists notebook_entries_exp_idx on public.notebook_entries (experiment_id);

-- ---------------------------------------------------------------------------
-- Data organization
-- ---------------------------------------------------------------------------

create table if not exists public.raw_files (
  id                 uuid primary key default gen_random_uuid(),
  lab_id             uuid not null references public.laboratories (id) on delete cascade,
  experiment_id      uuid references public.experiments (id) on delete cascade,
  name               text not null,
  stem               text,
  extension          text,
  platform           text,
  path               text,
  size_bytes         bigint,
  modified_at        timestamptz,
  inferred_sample    text,
  inferred_group     text,
  inferred_replicate integer,
  inferred_batch     text,
  inferred_order     integer,
  issues             jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists raw_files_exp_idx on public.raw_files (experiment_id);

create table if not exists public.sample_sheets (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null references public.laboratories (id) on delete cascade,
  experiment_id uuid references public.experiments (id) on delete cascade,
  name          text not null default 'Sample sheet',
  -- Array of SampleRow objects.
  rows          jsonb not null default '[]'::jsonb,
  extra_columns jsonb not null default '[]'::jsonb,
  issues        jsonb not null default '[]'::jsonb,
  is_valid      boolean not null default false,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists sample_sheets_exp_idx on public.sample_sheets (experiment_id);

-- Rename operations are recorded rather than applied blindly, so a batch
-- rename can be audited and reversed months later.
create table if not exists public.rename_operations (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null references public.laboratories (id) on delete cascade,
  experiment_id uuid references public.experiments (id) on delete cascade,
  rules         jsonb not null default '[]'::jsonb,
  -- Array of {from, to}
  mapping       jsonb not null default '[]'::jsonb,
  file_count    integer not null default 0,
  applied       boolean not null default false,
  reverted_at   timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Datasets and analyses
-- ---------------------------------------------------------------------------

create table if not exists public.datasets (
  id              uuid primary key default gen_random_uuid(),
  lab_id          uuid not null references public.laboratories (id) on delete cascade,
  experiment_id   uuid references public.experiments (id) on delete cascade,
  name            text not null,
  source_filename text,
  source_sheet    text,
  feature_count   integer not null default 0,
  sample_count    integer not null default 0,
  -- {features, featureLabels, samples, values}
  matrix          jsonb not null default '{}'::jsonb,
  -- Per-column profile from the import step.
  profile         jsonb not null default '{}'::jsonb,
  notes           jsonb not null default '[]'::jsonb,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists datasets_exp_idx on public.datasets (experiment_id);

do $$ begin
  create type public.analysis_kind as enum
    ('ttest', 'anova', 'pca', 'kmeans', 'hierarchical', 'differential', 'descriptive');
exception when duplicate_object then null; end $$;

create table if not exists public.analyses (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null references public.laboratories (id) on delete cascade,
  experiment_id uuid references public.experiments (id) on delete cascade,
  dataset_id    uuid references public.datasets (id) on delete cascade,
  kind          public.analysis_kind not null,
  title         text,
  params        jsonb not null default '{}'::jsonb,
  result        jsonb not null default '{}'::jsonb,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists analyses_exp_idx     on public.analyses (experiment_id);
create index if not exists analyses_dataset_idx on public.analyses (dataset_id);

do $$ begin
  create type public.figure_kind as enum ('volcano', 'heatmap', 'pca', 'other');
exception when duplicate_object then null; end $$;

create table if not exists public.figures (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null references public.laboratories (id) on delete cascade,
  experiment_id uuid references public.experiments (id) on delete cascade,
  analysis_id   uuid references public.analyses (id) on delete set null,
  kind          public.figure_kind not null default 'other',
  title         text not null default 'Figure',
  options       jsonb not null default '{}'::jsonb,
  -- The rendered SVG, so a figure in the notebook never silently changes
  -- when the underlying data is re-imported.
  svg           text,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists figures_exp_idx on public.figures (experiment_id);

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

create table if not exists public.audit_logs (
  id         bigint generated always as identity primary key,
  lab_id     uuid references public.laboratories (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  action     text not null,
  entity     text,
  entity_id  uuid,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_lab_idx on public.audit_logs (lab_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'laboratories', 'projects', 'experiments',
    'notebook_templates', 'notebook_entries', 'sample_sheets', 'datasets'
  ]
  loop
    execute format(
      'drop trigger if exists touch_%1$s on public.%1$s;
       create trigger touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Membership helpers
--
-- SECURITY DEFINER so the policies below can consult lab_members without
-- recursing into lab_members' own RLS policy.
-- ---------------------------------------------------------------------------

create or replace function public.is_lab_member(target_lab uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lab_members m
    where m.lab_id = target_lab and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_write_lab(target_lab uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lab_members m
    where m.lab_id = target_lab
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'member')
  );
$$;

create or replace function public.is_lab_admin(target_lab uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lab_members m
    where m.lab_id = target_lab
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

-- Creating a lab and its owner membership in one step avoids the chicken-and-egg
-- problem where the insert policy on lab_members requires an existing membership.
create or replace function public.create_laboratory(lab_name text, lab_description text default null)
returns public.laboratories
language plpgsql
security definer
set search_path = public
as $$
declare
  new_lab public.laboratories;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.laboratories (name, description, owner_id)
  values (lab_name, lab_description, auth.uid())
  returning * into new_lab;

  insert into public.lab_members (lab_id, user_id, role)
  values (new_lab.id, auth.uid(), 'owner');

  return new_lab;
end;
$$;

-- Laboratory creation is an administrative function only (done through the
-- `/admin/labs` server action with the service-role key, which bypasses RLS
-- entirely). This RPC used to let any signed-up user spin up their own lab
-- as a bootstrapping shortcut; that self-service path is intentionally
-- closed off now, so the grant is revoked rather than extended.
revoke execute on function public.create_laboratory(text, text) from authenticated;
revoke execute on function public.create_laboratory(text, text) from public;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles           enable row level security;
alter table public.laboratories       enable row level security;
alter table public.lab_members        enable row level security;
alter table public.projects           enable row level security;
alter table public.experiments        enable row level security;
alter table public.notebook_templates enable row level security;
alter table public.notebook_entries   enable row level security;
alter table public.raw_files          enable row level security;
alter table public.sample_sheets      enable row level security;
alter table public.rename_operations  enable row level security;
alter table public.datasets           enable row level security;
alter table public.analyses           enable row level security;
alter table public.figures            enable row level security;
alter table public.audit_logs         enable row level security;

-- profiles: a user sees and edits only their own row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid());
drop policy if exists profiles_upsert on public.profiles;
create policy profiles_upsert on public.profiles
  for insert with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- laboratories
drop policy if exists labs_select on public.laboratories;
create policy labs_select on public.laboratories
  for select using (public.is_lab_member(id));
-- No one inserts a laboratory through the ordinary client: creation happens
-- exclusively via the admin-gated server action, using the service-role key
-- (which bypasses RLS). This policy therefore denies every direct insert.
drop policy if exists labs_insert on public.laboratories;
create policy labs_insert on public.laboratories
  for insert with check (false);
drop policy if exists labs_update on public.laboratories;
create policy labs_update on public.laboratories
  for update using (public.is_lab_admin(id)) with check (public.is_lab_admin(id));
drop policy if exists labs_delete on public.laboratories;
create policy labs_delete on public.laboratories
  for delete using (owner_id = auth.uid());

-- lab_members: members see the roster; admins change it.
drop policy if exists members_select on public.lab_members;
create policy members_select on public.lab_members
  for select using (user_id = auth.uid() or public.is_lab_member(lab_id));
drop policy if exists members_insert on public.lab_members;
create policy members_insert on public.lab_members
  for insert with check (public.is_lab_admin(lab_id));
drop policy if exists members_update on public.lab_members;
create policy members_update on public.lab_members
  for update using (public.is_lab_admin(lab_id)) with check (public.is_lab_admin(lab_id));
drop policy if exists members_delete on public.lab_members;
create policy members_delete on public.lab_members
  for delete using (public.is_lab_admin(lab_id) or user_id = auth.uid());

-- Every lab-scoped table shares the same shape of policy.
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'experiments', 'notebook_templates',
    'raw_files', 'sample_sheets', 'rename_operations', 'datasets',
    'analyses', 'figures'
  ]
  loop
    execute format('drop policy if exists %1$s_select on public.%1$s;', t);
    execute format(
      'create policy %1$s_select on public.%1$s for select
       using (public.is_lab_member(lab_id));', t);

    execute format('drop policy if exists %1$s_insert on public.%1$s;', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert
       with check (public.can_write_lab(lab_id));', t);

    execute format('drop policy if exists %1$s_update on public.%1$s;', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update
       using (public.can_write_lab(lab_id)) with check (public.can_write_lab(lab_id));', t);

    execute format('drop policy if exists %1$s_delete on public.%1$s;', t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete
       using (public.can_write_lab(lab_id));', t);
  end loop;
end $$;

-- notebook_entries: append-only, like audit_logs. Every save is a new
-- version rather than an edit in place, so "what did the note say at
-- 14:32 on the day of the experiment" always has a definite answer - the
-- record a researcher may need to show is never mutated after the fact.
drop policy if exists notebook_entries_select on public.notebook_entries;
create policy notebook_entries_select on public.notebook_entries
  for select using (public.is_lab_member(lab_id));
drop policy if exists notebook_entries_insert on public.notebook_entries;
create policy notebook_entries_insert on public.notebook_entries
  for insert with check (public.can_write_lab(lab_id));

-- audit_logs: readable by lab members, append-only for them, never updated.
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs
  for select using (lab_id is not null and public.is_lab_member(lab_id));
drop policy if exists audit_insert on public.audit_logs;
create policy audit_insert on public.audit_logs
  for insert with check (lab_id is not null and public.is_lab_member(lab_id));

-- ---------------------------------------------------------------------------
-- Voice provenance
--
-- Every stage of the voice → notebook pipeline is kept as its own column
-- with its own timestamp, rather than only the final text: that is what
-- lets a researcher show what was actually said, what the AI produced, what
-- they themselves edited, and when they signed off on it, as distinct facts.
-- ---------------------------------------------------------------------------

create table if not exists public.voice_notes (
  id                uuid primary key default gen_random_uuid(),
  lab_id            uuid not null references public.laboratories (id) on delete cascade,
  experiment_id     uuid references public.experiments (id) on delete cascade,
  engine            text,
  model             text,
  audio_seconds     numeric,
  raw_transcript    text,
  transcribed_at    timestamptz,
  edited_transcript text,
  edited_at         timestamptz,
  -- Structured fields the AI extracted from the transcript.
  ai_note           jsonb not null default '{}'::jsonb,
  ai_structured_at  timestamptz,
  final_markdown    text,
  confirmed_at      timestamptz,
  confirmed_by      uuid references auth.users (id) on delete set null,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists voice_notes_exp_idx on public.voice_notes (experiment_id);

-- Once a researcher confirms a voice note, none of its content may change.
-- This is the actual tamper-resistance mechanism, not just a UI convention:
-- an update statement against a confirmed row fails at the database.
create or replace function public.prevent_confirmed_voice_note_edit()
returns trigger
language plpgsql
as $$
begin
  if old.confirmed_at is not null then
    raise exception 'この音声ノートは確定済みのため変更できません。';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_confirmed_voice_note on public.voice_notes;
create trigger lock_confirmed_voice_note
  before update on public.voice_notes
  for each row execute function public.prevent_confirmed_voice_note_edit();

-- ---------------------------------------------------------------------------
-- Saved literature
-- ---------------------------------------------------------------------------

create table if not exists public.saved_papers (
  id            uuid primary key default gen_random_uuid(),
  lab_id        uuid not null references public.laboratories (id) on delete cascade,
  experiment_id uuid references public.experiments (id) on delete cascade,
  pmid          text,
  doi           text,
  title         text not null,
  journal       text,
  pub_year      integer,
  authors       jsonb not null default '[]'::jsonb,
  url           text,
  note          text,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists saved_papers_exp_idx on public.saved_papers (experiment_id);

-- Added after the initial saved_papers release: full bibliographic detail
-- (volume/issue/pages) needed to render a publication-ready citation, not
-- just enough to identify the paper.
alter table public.saved_papers add column if not exists volume text;
alter table public.saved_papers add column if not exists issue  text;
alter table public.saved_papers add column if not exists pages  text;

-- ---------------------------------------------------------------------------
-- Reagent / lot registry
-- ---------------------------------------------------------------------------

create table if not exists public.reagents (
  id          uuid primary key default gen_random_uuid(),
  lab_id      uuid not null references public.laboratories (id) on delete cascade,
  name        text not null,
  category    text,
  vendor      text,
  lot         text,
  received_at date,
  expires_at  date,
  notes       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists reagents_lab_idx on public.reagents (lab_id);

do $$
declare
  t text;
begin
  foreach t in array array['voice_notes', 'reagents']
  loop
    execute format(
      'drop trigger if exists touch_%1$s on public.%1$s;
       create trigger touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

alter table public.voice_notes  enable row level security;
alter table public.saved_papers enable row level security;
alter table public.reagents     enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['voice_notes', 'saved_papers', 'reagents']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$s;', t);
    execute format(
      'create policy %1$s_select on public.%1$s for select
       using (public.is_lab_member(lab_id));', t);

    execute format('drop policy if exists %1$s_insert on public.%1$s;', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert
       with check (public.can_write_lab(lab_id));', t);

    execute format('drop policy if exists %1$s_update on public.%1$s;', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update
       using (public.can_write_lab(lab_id)) with check (public.can_write_lab(lab_id));', t);

    execute format('drop policy if exists %1$s_delete on public.%1$s;', t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete
       using (public.can_write_lab(lab_id));', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Platform roles — "Administrator" and "User"
--
-- Until now platform-admin rights came only from PLATFORM_ADMIN_EMAILS, a
-- server-only environment variable. That is safe but not administrable: an
-- administrator cannot promote a colleague without a redeploy, and there is
-- nothing to seed.
--
-- This migration moves the role into the database while keeping the property
-- that made the env var safe — a user cannot grant it to themselves. The
-- column is writable only by the service role (see the trigger below), so the
-- ordinary `profiles_update` policy, which lets a user edit their own row,
-- cannot be turned into a privilege-escalation path.
--
-- Safe to re-run: every statement is guarded.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.platform_role as enum ('admin', 'user');
exception when duplicate_object then null; end $$;

alter table public.profiles
  add column if not exists platform_role public.platform_role not null default 'user';

create index if not exists profiles_platform_role_idx
  on public.profiles (platform_role)
  where platform_role = 'admin';

-- The column is service-role-only.
create or replace function public.guard_platform_role()
returns trigger
language plpgsql
as $$
begin
  if new.platform_role is distinct from old.platform_role
     and current_user not in ('postgres', 'service_role', 'supabase_admin')
  then
    raise exception '権限（platform_role）は変更できません。';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_platform_role on public.profiles;
create trigger guard_platform_role
  before update on public.profiles
  for each row execute function public.guard_platform_role();

-- Membership helper, matching is_lab_member / is_lab_admin in this file.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.platform_role = 'admin'
  );
$$;

-- Administrators read every profile; a User still reads only their own.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_platform_admin());

-- Seed: the first administrator.
update public.profiles p
   set platform_role = 'admin'
  from auth.users u
 where u.id = p.id
   and lower(u.email) = 'hira.sui.456@gmail.com'
   and p.platform_role <> 'admin';

-- ---------------------------------------------------------------------------
-- New users get a profile row automatically.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Core row only. Extra profile columns are filled afterwards so a missing
  -- column or a bad date cannot abort auth.users insert ("Database error
  -- saving new user").
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  begin
    update public.profiles
       set date_of_birth = case
             when coalesce(new.raw_user_meta_data ->> 'date_of_birth', '') ~ '^\d{4}-\d{2}-\d{2}$'
             then (new.raw_user_meta_data ->> 'date_of_birth')::date
             else date_of_birth
           end,
           phone_number = nullif(new.raw_user_meta_data ->> 'phone_number', ''),
           major        = nullif(new.raw_user_meta_data ->> 'major', '')
     where id = new.id;
  exception when undefined_column then
    null;
  when others then
    null;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 0002_billing.sql
-- ============================================================================

-- ============================================================================
-- chondro — Stripe billing
--
-- A subscription belongs to a *laboratory*, not to a user: every table in
-- 0001_init (core schema) is lab_id-scoped and access is granted through lab_members,
-- so the laboratory is the only unit where "who is entitled to this feature"
-- has a single answer. The lab owner pays; every member of that lab gets the
-- plan.
--
-- Stripe is the source of truth for money. This schema only mirrors the state
-- Stripe reports over webhooks, so that entitlement checks are one local read
-- rather than an API call on every request. Nothing here ever writes back to
-- Stripe.
--
-- Quotas are enforced by triggers rather than in application code. Experiments
-- are inserted straight from the browser through RLS (see ExperimentCreator),
-- and members are added by a service-role action that bypasses RLS entirely -
-- a check in either one of those would leave the other open. A BEFORE INSERT
-- trigger is the only place both paths must pass through.
--
-- Safe to re-run: every statement is guarded.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.billing_plan as enum ('free', 'pro', 'team');
exception when duplicate_object then null; end $$;

-- Mirrors Stripe's subscription statuses verbatim, so a value never has to be
-- translated on the way in and an unexpected one is impossible to store.
do $$ begin
  create type public.billing_status as enum (
    'active', 'trialing', 'past_due', 'canceled',
    'incomplete', 'incomplete_expired', 'unpaid', 'paused'
  );
exception when duplicate_object then null; end $$;

-- The limits are a table rather than constants inside the trigger so the
-- quotas can be read by the application for display ("3 / 20 experiments")
-- without restating them in TypeScript. `null` means unlimited.
create table if not exists public.plan_limits (
  plan            public.billing_plan primary key,
  max_members     integer,
  max_experiments integer,
  max_datasets    integer,
  ai_enabled      boolean not null default false
);

insert into public.plan_limits (plan, max_members, max_experiments, max_datasets, ai_enabled)
values
  ('free', 3,    20,   20,   false),
  ('pro',  10,   200,  200,  true),
  ('team', null, null, null, true)
on conflict (plan) do update set
  max_members     = excluded.max_members,
  max_experiments = excluded.max_experiments,
  max_datasets    = excluded.max_datasets,
  ai_enabled      = excluded.ai_enabled;

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

create table if not exists public.lab_subscriptions (
  lab_id               uuid primary key references public.laboratories (id) on delete cascade,
  plan                 public.billing_plan not null default 'free',
  status               public.billing_status not null default 'active',
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  stripe_price_id        text,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  -- Webhook delivery is not ordered. Every write records the Stripe event's
  -- own timestamp so a late-arriving older event cannot overwrite newer state.
  last_event_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Every laboratory that already exists is explicitly on the free plan, so
-- `lab_plan()` never has to distinguish "no row yet" from "not paying".
insert into public.lab_subscriptions (lab_id, plan, status)
select l.id, 'free', 'active' from public.laboratories l
on conflict (lab_id) do nothing;

-- Processed Stripe events, kept for idempotency: Stripe retries deliveries and
-- may send the same event more than once. The primary key is the event id, so
-- a duplicate delivery fails to insert and the handler can stop early.
create table if not exists public.billing_events (
  id          text primary key,
  type        text not null,
  lab_id      uuid references public.laboratories (id) on delete set null,
  payload     jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create index if not exists billing_events_lab_idx
  on public.billing_events (lab_id, received_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['lab_subscriptions']
  loop
    execute format(
      'drop trigger if exists touch_%1$s on public.%1$s;
       create trigger touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Entitlement
-- ---------------------------------------------------------------------------

/*
 * The effective plan for one laboratory.
 *
 * `past_due` still counts as entitled: Stripe retries a failed payment for
 * days, and cutting a lab off from its own experiment records the morning a
 * card expires would be a worse failure than carrying the cost of the retry
 * window. Everything Stripe considers finished - canceled, unpaid, incomplete
 * - falls back to free.
 */
create or replace function public.lab_plan(target_lab uuid)
returns public.billing_plan
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
               when s.status in ('active', 'trialing', 'past_due') then s.plan
               else 'free'::public.billing_plan
             end
        from public.lab_subscriptions s
       where s.lab_id = target_lab
    ),
    'free'::public.billing_plan
  );
$$;

/** True when the laboratory's plan includes the AI features. */
create or replace function public.lab_ai_enabled(target_lab uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select l.ai_enabled from public.plan_limits l where l.plan = public.lab_plan(target_lab)),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Quota enforcement
--
-- One generic trigger, parameterised with the limit column to consult, so
-- adding a quota later is a `create trigger` and nothing else. SECURITY
-- DEFINER because the caller may not be able to read plan_limits or count
-- rows in the target table under their own row-level security.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_lab_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  limit_column  text := tg_argv[0];
  noun          text := tg_argv[1];
  current_plan  public.billing_plan;
  allowed       integer;
  used          bigint;
begin
  if new.lab_id is null then
    return new;
  end if;

  current_plan := public.lab_plan(new.lab_id);

  execute format('select %I from public.plan_limits where plan = $1', limit_column)
     into allowed
    using current_plan;

  -- null means unlimited, and an unknown plan is treated the same way rather
  -- than blocking writes on a configuration gap.
  if allowed is null then
    return new;
  end if;

  execute format('select count(*) from public.%I where lab_id = $1', tg_table_name)
     into used
    using new.lab_id;

  if used >= allowed then
    raise exception
      '現在のプラン（%）では%は%件までです。プランをアップグレードしてください。',
      current_plan, noun, allowed
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists quota_lab_members on public.lab_members;
create trigger quota_lab_members
  before insert on public.lab_members
  for each row execute function public.enforce_lab_quota('max_members', 'メンバー');

drop trigger if exists quota_experiments on public.experiments;
create trigger quota_experiments
  before insert on public.experiments
  for each row execute function public.enforce_lab_quota('max_experiments', '実験');

drop trigger if exists quota_datasets on public.datasets;
create trigger quota_datasets
  before insert on public.datasets
  for each row execute function public.enforce_lab_quota('max_datasets', 'データセット');

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Subscription state is readable by the lab's members and writable by nobody:
-- it is a mirror of Stripe, and the only writer is the webhook handler using
-- the service-role key (which bypasses RLS). A table with RLS enabled and no
-- write policy denies every write from an anon or authenticated client, which
-- is exactly the intent - a user must not be able to grant their own lab a
-- paid plan by writing this row.
-- ---------------------------------------------------------------------------

alter table public.plan_limits       enable row level security;
alter table public.lab_subscriptions enable row level security;
alter table public.billing_events    enable row level security;

drop policy if exists plan_limits_select on public.plan_limits;
create policy plan_limits_select on public.plan_limits
  for select using (true);

drop policy if exists lab_subscriptions_select on public.lab_subscriptions;
create policy lab_subscriptions_select on public.lab_subscriptions
  for select using (public.is_lab_member(lab_id) or public.is_platform_admin());

-- billing_events deliberately has no policy at all: raw Stripe payloads are
-- for the webhook handler and the service role, not for the browser.

-- ============================================================================
-- 0003_peer_review.sql
-- ============================================================================

-- ============================================================================
-- chondro — AI Peer Review
--
-- Three independent AI reviewers (methods/statistics, novelty/significance,
-- structure/logic) evaluate an uploaded paper the same way a journal's
-- reviewer panel would: each produces its own scores, concerns and
-- recommendations, and the report is the three of them side by side rather
-- than one blended opinion. The three-way split is deliberate — a single
-- "evaluate this paper" prompt collapses distinct kinds of judgment into one
-- undifferentiated score, which is far less useful for revision than knowing
-- specifically that the statistics reviewer is unconvinced while the novelty
-- reviewer is not.
--
-- Scoped to an experiment like everything else in this schema, so a review
-- shows up alongside the data it is reviewing.
--
-- `document_kind` is constrained to 'paper' for now. The product direction
-- (see project notes) is to add a grant/research-proposal variant later with
-- its own rubric; the column exists today so that becomes a value added to
-- the check constraint rather than a schema migration touching every row.
--
-- Safe to re-run: every statement is guarded.
-- ============================================================================

create table if not exists public.peer_reviews (
  id                uuid primary key default gen_random_uuid(),
  lab_id            uuid not null references public.laboratories (id) on delete cascade,
  experiment_id     uuid not null references public.experiments (id) on delete cascade,
  document_kind     text not null default 'paper' check (document_kind in ('paper')),
  title             text not null,
  source_filename   text,
  -- The text the reviewers actually saw. Kept so a report can always be
  -- traced back to exactly what was reviewed, and so a re-review has
  -- something to diff against.
  extracted_text    text not null,
  -- Array of the three reviewer results: {reviewer, overall_score,
  -- category_scores, major_concerns, minor_concerns, recommendations, summary}.
  reviewer_results  jsonb not null default '[]'::jsonb,
  -- The nine named category scores, flattened from the three reviewers, so
  -- the summary table renders from one column instead of re-deriving it.
  category_scores   jsonb not null default '{}'::jsonb,
  -- Average of the three reviewers' overall_score, computed in application
  -- code rather than by a fourth model call, so the total is always exactly
  -- traceable to the three numbers next to it.
  overall_score     numeric not null,
  -- Set when this review is a re-review of a revised draft, chaining the
  -- history so "did this go up after I revised it" has a direct answer.
  previous_review_id uuid references public.peer_reviews (id) on delete set null,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists peer_reviews_exp_idx  on public.peer_reviews (experiment_id, created_at desc);
create index if not exists peer_reviews_prev_idx on public.peer_reviews (previous_review_id);

do $$
declare
  t text;
begin
  foreach t in array array['peer_reviews']
  loop
    execute format(
      'drop trigger if exists touch_%1$s on public.%1$s;
       create trigger touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- Same shape of policy as every other lab-scoped table in the core schema:
-- members read, writers (member/admin/owner) create and change.
alter table public.peer_reviews enable row level security;

drop policy if exists peer_reviews_select on public.peer_reviews;
create policy peer_reviews_select on public.peer_reviews
  for select using (public.is_lab_member(lab_id));

drop policy if exists peer_reviews_insert on public.peer_reviews;
create policy peer_reviews_insert on public.peer_reviews
  for insert with check (public.can_write_lab(lab_id));

drop policy if exists peer_reviews_update on public.peer_reviews;
create policy peer_reviews_update on public.peer_reviews
  for update using (public.can_write_lab(lab_id)) with check (public.can_write_lab(lab_id));

drop policy if exists peer_reviews_delete on public.peer_reviews;
create policy peer_reviews_delete on public.peer_reviews
  for delete using (public.can_write_lab(lab_id));

-- ============================================================================
-- 0004_reviewer_profiles.sql
-- ============================================================================

-- ============================================================================
-- chondro — AI Peer Review reviewer profiles
--
-- The three reviewers in the peer review section above (methods,
-- novelty, structure) are a fixed, platform-wide set - not something each
-- laboratory customizes independently, the same way the OpenAI model ids are
-- one deployment-wide choice rather than a per-lab one. This table gives each
-- of the three a name and an editable rubric supplement, editable only by a
-- platform administrator from /admin/peer-review.
--
-- `rubric_notes` is appended to that reviewer's system prompt verbatim at
-- review time (see runFullReview in src/lib/ai/peerReview.ts). It tunes how
-- strict or lenient a reviewer is and what it emphasizes; it never changes
-- the nine category score fields themselves, which stay fixed because they
-- are load-bearing for the JSON schema OpenAI is asked to fill and for the
-- report's own column shape.
--
-- Avatars are not stored here: they are generated deterministically from the
-- name in src/lib/ai/reviewerProfiles.ts, so renaming a reviewer changes its
-- avatar automatically and there is nothing image-shaped to store, host, or
-- moderate.
--
-- Safe to re-run: every statement is guarded.
-- ============================================================================

create table if not exists public.reviewer_profiles (
  role         text primary key check (role in ('methods', 'novelty', 'structure')),
  name         text not null,
  rubric_notes text not null default '',
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now()
);

insert into public.reviewer_profiles (role, name, rubric_notes) values
  ('methods',   '高橋 誠', ''),
  ('novelty',   '藤井 彩', ''),
  ('structure', '中村 学', '')
on conflict (role) do nothing;

do $$
declare
  t text;
begin
  foreach t in array array['reviewer_profiles']
  loop
    execute format(
      'drop trigger if exists touch_%1$s on public.%1$s;
       create trigger touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- Readable by anyone signed in (the peer-review page shows reviewer names to
-- every lab, not just platform admins) - the same shape as plan_limits'
-- "for select using (true)". Writable only by a platform administrator.
alter table public.reviewer_profiles enable row level security;

drop policy if exists reviewer_profiles_select on public.reviewer_profiles;
create policy reviewer_profiles_select on public.reviewer_profiles
  for select using (true);

drop policy if exists reviewer_profiles_update on public.reviewer_profiles;
create policy reviewer_profiles_update on public.reviewer_profiles
  for update using (public.is_platform_admin()) with check (public.is_platform_admin());
