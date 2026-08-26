-- ============================================================================
-- chondro ? full database schema
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
-- chondro ? research data management schema
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
-- Every stage of the voice ? notebook pipeline is kept as its own column
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
    raise exception '???????????????????????';
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
  experiment_id uuid references public.experiments (id) on delete cascade,
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

alter table public.reagents
  add column if not exists experiment_id uuid references public.experiments (id) on delete cascade;

create index if not exists reagents_lab_idx on public.reagents (lab_id);
create index if not exists reagents_experiment_idx on public.reagents (experiment_id);

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
-- Platform roles ? "Administrator" and "User"
--
-- Until now platform-admin rights came only from PLATFORM_ADMIN_EMAILS, a
-- server-only environment variable. That is safe but not administrable: an
-- administrator cannot promote a colleague without a redeploy, and there is
-- nothing to seed.
--
-- This migration moves the role into the database while keeping the property
-- that made the env var safe ? a user cannot grant it to themselves. The
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
    raise exception '???platform_role??????????';
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
-- chondro ? Stripe billing
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
  max_labs        integer,
  max_members     integer,
  max_experiments integer,
  max_datasets    integer,
  ai_enabled      boolean not null default false
);

-- Existing DBs: CREATE TABLE IF NOT EXISTS does not add new columns.
do $$
begin
  if to_regclass('public.plan_limits') is not null
     and not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'plan_limits'
         and column_name = 'max_labs'
     )
  then
    alter table public.plan_limits add column max_labs integer;
  end if;
end $$;

insert into public.plan_limits (plan, max_labs, max_members, max_experiments, max_datasets, ai_enabled)
values
  ('free', 1,    5,    10,   null, true),
  ('pro',  10,   100,  200,  null, true),
  ('team', null, null, null, null, true)
on conflict (plan) do update set
  max_labs        = excluded.max_labs,
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
      'plan %: % limit reached (%). Upgrade the plan to add more.',
      current_plan, noun, allowed
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists quota_lab_members on public.lab_members;
create trigger quota_lab_members
  before insert on public.lab_members
  for each row execute function public.enforce_lab_quota('max_members', '????');

drop trigger if exists quota_experiments on public.experiments;
create trigger quota_experiments
  before insert on public.experiments
  for each row execute function public.enforce_lab_quota('max_experiments', '??');

drop trigger if exists quota_datasets on public.datasets;
create trigger quota_datasets
  before insert on public.datasets
  for each row execute function public.enforce_lab_quota('max_datasets', '??????');

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
-- chondro ? AI Peer Review
--
-- Three independent AI reviewers (methods/statistics, novelty/significance,
-- structure/logic) evaluate an uploaded paper the same way a journal's
-- reviewer panel would: each produces its own scores, concerns and
-- recommendations, and the report is the three of them side by side rather
-- than one blended opinion. The three-way split is deliberate ? a single
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
-- chondro ? AI Peer Review reviewer profiles
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
  ('methods',   '?? ?', ''),
  ('novelty',   '?? ?', ''),
  ('structure', '?? ?', '')
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

-- ============================================================================
-- Plan prices
--
-- Which Stripe Price object each paid plan sells, held in the database rather
-- than in environment variables.
--
-- Price ids used to live in STRIPE_PRICE_PRO / STRIPE_PRICE_TEAM, which meant
-- changing a price required editing an env var on every deployment target and
-- redeploying - and a local machine and a hosted build could silently disagree
-- about what a plan costs. Keeping them here means one source both read, and a
-- price change is an administrative action (see /admin/billing) rather than a
-- code change.
--
-- `amount_jpy` is a cached copy of what Stripe holds, for display only. Stripe
-- is always the authority on what a card is actually charged; this column
-- exists so the pricing page does not need a Stripe round trip to render, and
-- is refreshed from Stripe whenever a price is created or synced.
--
-- Safe to re-run: every statement is guarded.
-- ============================================================================

create table if not exists public.plan_prices (
  plan            public.billing_plan primary key,
  stripe_price_id text,
  amount_jpy      integer,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

-- A negative amount is never a real price, only a bug on its way to a
-- customer-facing page. Added separately so the table statement above stays
-- re-runnable on a database that already has it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.plan_prices'::regclass
      and conname = 'plan_prices_amount_jpy_nonnegative'
  ) then
    alter table public.plan_prices
      add constraint plan_prices_amount_jpy_nonnegative
      check (amount_jpy is null or amount_jpy >= 0);
  end if;
end $$;

-- One row per plan (including individual researcher). Empty until Stripe setup.
insert into public.plan_prices (plan) values ('free'), ('pro'), ('team')
on conflict (plan) do nothing;

do $$
declare
  t text;
begin
  foreach t in array array['plan_prices']
  loop
    execute format(
      'drop trigger if exists touch_%1$s on public.%1$s;
       create trigger touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- Readable by anyone: the pricing page shows these amounts to every visitor,
-- and a Stripe price id is not a secret (it is submitted to Stripe from the
-- browser in ordinary Checkout integrations). Writable only by a platform
-- administrator, since it decides what customers are charged.
alter table public.plan_prices enable row level security;

drop policy if exists plan_prices_select on public.plan_prices;
create policy plan_prices_select on public.plan_prices
  for select using (true);

drop policy if exists plan_prices_update on public.plan_prices;
create policy plan_prices_update on public.plan_prices
  for update using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ============================================================================
-- AI Peer Review credits
--
-- Pay-per-use, on top of a small free allowance, replaces the lab-Pro-plan
-- gate for AI??: entitlement is now a personal balance on the account that
-- ran the review, not something a laboratory's subscription decides. A review
-- is therefore no longer tied to a laboratory or an experiment - the two
-- columns that used to require one are relaxed to nullable below rather than
-- dropped, so existing rows (and their lab-scoped RLS history) stay intact.
--
-- Safe to re-run: every statement is guarded.
-- ============================================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'peer_reviews'
      and column_name = 'lab_id' and is_nullable = 'NO'
  ) then
    alter table public.peer_reviews alter column lab_id drop not null;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'peer_reviews'
      and column_name = 'experiment_id' and is_nullable = 'NO'
  ) then
    alter table public.peer_reviews alter column experiment_id drop not null;
  end if;
end $$;

-- Superseded by the policies below, which cover both the old lab-scoped rows
-- and new personal ones in one clause.
drop policy if exists peer_reviews_select on public.peer_reviews;
create policy peer_reviews_select on public.peer_reviews
  for select using (
    created_by = auth.uid()
    or (lab_id is not null and public.is_lab_member(lab_id))
  );

drop policy if exists peer_reviews_insert on public.peer_reviews;
create policy peer_reviews_insert on public.peer_reviews
  for insert with check (
    created_by = auth.uid()
    or (lab_id is not null and public.can_write_lab(lab_id))
  );

drop policy if exists peer_reviews_update on public.peer_reviews;
create policy peer_reviews_update on public.peer_reviews
  for update using (
    created_by = auth.uid()
    or (lab_id is not null and public.can_write_lab(lab_id))
  ) with check (
    created_by = auth.uid()
    or (lab_id is not null and public.can_write_lab(lab_id))
  );

drop policy if exists peer_reviews_delete on public.peer_reviews;
create policy peer_reviews_delete on public.peer_reviews
  for delete using (
    created_by = auth.uid()
    or (lab_id is not null and public.can_write_lab(lab_id))
  );

-- One row per account. `free_remaining` starts every account at the free
-- allowance; `purchased_balance` is topped up by the webhook when a credit
-- pack is bought. `used_count`/`total_purchased` are lifetime counters kept
-- alongside the spendable balances so "how many have I ever run/bought" can
-- be shown without summing history.
create table if not exists public.peer_review_credits (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  free_remaining    integer not null default 3,
  purchased_balance integer not null default 0,
  used_count        integer not null default 0,
  total_purchased   integer not null default 0,
  updated_at        timestamptz not null default now(),
  constraint peer_review_credits_nonnegative check (
    free_remaining >= 0 and purchased_balance >= 0 and used_count >= 0 and total_purchased >= 0
  )
);

-- Every account that already exists gets a row, same reasoning as the
-- lab_subscriptions backfill above: `getMyPeerReviewCredits` never has to
-- distinguish "no row yet" from "row with the default allowance".
insert into public.peer_review_credits (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

do $$
declare
  t text;
begin
  foreach t in array array['peer_review_credits']
  loop
    execute format(
      'drop trigger if exists touch_%1$s on public.%1$s;
       create trigger touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- Readable only by the account it belongs to. No insert/update/delete policy
-- is granted at all: every write goes through `consume_peer_review_credit`
-- (spending, called with the caller's own auth.uid()) or through
-- `grant_peer_review_credits` (crediting a purchase, called only by the
-- webhook's service-role client, which bypasses RLS entirely) - never through
-- a direct table write a browser could forge.
alter table public.peer_review_credits enable row level security;

drop policy if exists peer_review_credits_select on public.peer_review_credits;
create policy peer_review_credits_select on public.peer_review_credits
  for select using (user_id = auth.uid());

-- Atomically spends one credit for the calling user: free allowance first,
-- then the purchased balance. A single UPDATE ... WHERE is what makes this
-- safe under concurrency - two simultaneous reviews cannot both succeed off
-- the same last credit, since the second UPDATE's WHERE clause simply matches
-- zero rows once the first has committed.
create or replace function public.consume_peer_review_credit()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.peer_review_credits (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  update public.peer_review_credits
     set free_remaining = free_remaining - 1,
         used_count = used_count + 1
   where user_id = auth.uid()
     and free_remaining > 0;
  if found then
    return true;
  end if;

  update public.peer_review_credits
     set purchased_balance = purchased_balance - 1,
         used_count = used_count + 1
   where user_id = auth.uid()
     and purchased_balance > 0;
  return found;
end;
$$;

-- Credits a completed purchase. `security definer` so it can also be called
-- safely if a future admin tool ever needs to grant credits directly; the
-- webhook itself already writes through the service-role client, which does
-- not need it, but a table write there would still have to reimplement this
-- same upsert-or-add.
create or replace function public.grant_peer_review_credits(target_user uuid, amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if amount <= 0 then
    return;
  end if;

  insert into public.peer_review_credits (user_id, purchased_balance, total_purchased)
  values (target_user, amount, amount)
  on conflict (user_id) do update
    set purchased_balance = public.peer_review_credits.purchased_balance + excluded.purchased_balance,
        total_purchased   = public.peer_review_credits.total_purchased + excluded.total_purchased;
end;
$$;

-- Which Stripe one-time Price each credit pack sells, same shape and reasons
-- as plan_prices: held in the database so a price change is an operational
-- step (re-run the setup script), not a code change or a redeploy.
create table if not exists public.peer_review_credit_prices (
  pack_id         text primary key,
  credits         integer not null,
  amount_jpy      integer not null check (amount_jpy >= 0),
  stripe_price_id text,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

-- Existing DBs may still have ten/hundred rows and an old check constraint.
-- Drop the check, remove obsolete packs, then re-apply the current catalogue.
alter table public.peer_review_credit_prices
  drop constraint if exists peer_review_credit_prices_pack_id_check;

delete from public.peer_review_credit_prices
 where pack_id not in ('single', 'thirty', 'monthly');

alter table public.peer_review_credit_prices
  add constraint peer_review_credit_prices_pack_id_check
  check (pack_id in ('single', 'thirty', 'monthly'));

insert into public.peer_review_credit_prices (pack_id, credits, amount_jpy) values
  ('single',  1,     100),
  ('thirty',  30,    2000),
  ('monthly', 10000, 5000)
on conflict (pack_id) do update
  set credits = excluded.credits,
      amount_jpy = excluded.amount_jpy,
      stripe_price_id = case
        when public.peer_review_credit_prices.amount_jpy is distinct from excluded.amount_jpy
          or public.peer_review_credit_prices.credits is distinct from excluded.credits
        then null
        else public.peer_review_credit_prices.stripe_price_id
      end;

do $$
declare
  t text;
begin
  foreach t in array array['peer_review_credit_prices']
  loop
    execute format(
      'drop trigger if exists touch_%1$s on public.%1$s;
       create trigger touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- Readable by anyone: the AI?? page shows these prices to every visitor.
-- Writable only by a platform administrator (via the setup script's
-- service-role key, which bypasses RLS, or from a future admin editor).
alter table public.peer_review_credit_prices enable row level security;

drop policy if exists peer_review_credit_prices_select on public.peer_review_credit_prices;
create policy peer_review_credit_prices_select on public.peer_review_credit_prices
  for select using (true);

drop policy if exists peer_review_credit_prices_update on public.peer_review_credit_prices;
create policy peer_review_credit_prices_update on public.peer_review_credit_prices
  for update using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Lets a one-time credit purchase's webhook event carry who bought it, the
-- same way billing_events.lab_id already carries which laboratory a
-- subscription event was about. Nullable, like lab_id: most events still have
-- no user (e.g. invoice.payment_failed is about a laboratory, not a person).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_events' and column_name = 'user_id'
  ) then
    alter table public.billing_events
      add column user_id uuid references auth.users (id) on delete set null;
  end if;
end $$;

create index if not exists billing_events_user_idx
  on public.billing_events (user_id, received_at desc);

-- New accounts get a peer_review_credits row the same moment they get a
-- profiles row, so a brand-new user's first AI?? never has to distinguish
-- "no row yet" from "row at the default allowance" either.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

  insert into public.peer_review_credits (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Self-service laboratories: pending invites
--
-- Any signed-in user may already create a laboratory and invite members whose
-- accounts already exist (see createLabAction / addMemberAction). This table
-- covers the other half: inviting someone with no account yet. A row here is
-- a promise - "email X will hold role Y in lab Z once they sign up" - that
-- the auth callback consumes the moment that person confirms their account,
-- so a lab owner never has to remember to add them a second time.
-- ---------------------------------------------------------------------------

create table if not exists public.lab_invites (
  id          uuid primary key default gen_random_uuid(),
  lab_id      uuid not null references public.laboratories (id) on delete cascade,
  email       text not null,
  role        public.lab_role not null default 'member',
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);

-- Only one live invite per (lab, email) at a time; a new invite after one is
-- accepted is a fresh row, which keeps the accepted one as history.
create unique index if not exists lab_invites_pending_unique
  on public.lab_invites (lab_id, email)
  where accepted_at is null;

create index if not exists lab_invites_email_idx on public.lab_invites (email);

alter table public.lab_invites enable row level security;

-- Read-only for the lab's own admins/owners, so they can see who has not yet
-- accepted. Every write (insert on invite, update on accept) goes through the
-- service-role client in a server action that has already re-checked the
-- caller's authority or is running as a system callback, matching how
-- lab_members itself is written.
drop policy if exists lab_invites_select on public.lab_invites;
create policy lab_invites_select on public.lab_invites
  for select using (public.is_lab_admin(lab_id));

-- ============================================================================
-- Notebook entries: same-day editing
--
-- Entries used to be pure insert-only (see saveNotebookEntry's own doc
-- comment: "always an insert, never an update"), which meant fixing a typo
-- required a whole new dated version. The actual integrity requirement was
-- narrower than that: a lab report should be editable while it is still
-- "today's" entry, and permanently fixed once that day has passed ? not
-- fixed from the instant it is saved.
--
-- The boundary is JST (Asia/Tokyo), not the database's session timezone,
-- since every date shown in this app's UI is a Japanese calendar date
-- (toLocaleDateString("ja-JP")) - a server running in UTC must not lock an
-- entry out from under a researcher still working within their own "today".
--
-- Safe to re-run: every statement is guarded.
-- ============================================================================

drop policy if exists notebook_entries_update on public.notebook_entries;
create policy notebook_entries_update on public.notebook_entries
  for update using (public.can_write_lab(lab_id)) with check (public.can_write_lab(lab_id));

-- Same shape as prevent_confirmed_voice_note_edit: fires unconditionally,
-- including against the service-role client, so the boundary cannot be
-- bypassed by an admin tool that forgets to check the date itself.
create or replace function public.prevent_stale_notebook_entry_edit()
returns trigger
language plpgsql
as $$
begin
  if (old.created_at at time zone 'Asia/Tokyo')::date
     <> (now() at time zone 'Asia/Tokyo')::date
  then
    raise exception '????????????????????????';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_stale_notebook_entry on public.notebook_entries;
create trigger lock_stale_notebook_entry
  before update on public.notebook_entries
  for each row execute function public.prevent_stale_notebook_entry_edit();

-- ============================================================================
-- Report PDFs
--
-- The five ?? tools (???????/Lot????????????????) are now one
-- guided flow that ends by producing a PDF - a preview on request, and a final
-- version when the researcher finishes. Both get stored, not just downloaded,
-- so "what did we hand off for this experiment" has an answer later.
--
-- Reuses `raw_files` (kept generic on purpose already) instead of a new table:
-- a report PDF is, structurally, just another file that belongs to an
-- experiment. `kind` distinguishes a report PDF from an ordinary catalogued
-- raw instrument file, and `storage_path` is new because the existing `path`
-- column already means something else there (the original client-side
-- filename/relative path of an uploaded-metadata row) - conflating the two
-- would make old rows ambiguous.
--
-- Safe to re-run: every statement is guarded.
-- ============================================================================

alter table public.raw_files add column if not exists kind text not null default 'raw';
alter table public.raw_files add column if not exists storage_path text;
alter table public.raw_files add column if not exists mime_type text;
alter table public.raw_files add column if not exists created_by uuid references auth.users (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.raw_files'::regclass
      and conname = 'raw_files_kind_check'
  ) then
    alter table public.raw_files
      add constraint raw_files_kind_check
      check (kind in ('raw', 'report_preview', 'report_final'));
  end if;
end $$;

create index if not exists raw_files_kind_idx on public.raw_files (experiment_id, kind);

-- A private bucket: report PDFs may contain unpublished results, so they are
-- fetched only through a signed URL the server hands out after checking lab
-- membership, never through a public bucket URL.
insert into storage.buckets (id, name, public)
values ('lab-reports', 'lab-reports', false)
on conflict (id) do nothing;

-- Objects are stored as `{lab_id}/{experiment_id}/{filename}`, so the first
-- path segment is exactly what `is_lab_member` / `can_write_lab` already key
-- on - the same helpers every other lab-scoped policy in this file uses.
drop policy if exists lab_reports_select on storage.objects;
create policy lab_reports_select on storage.objects
  for select using (
    bucket_id = 'lab-reports'
    and public.is_lab_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists lab_reports_insert on storage.objects;
create policy lab_reports_insert on storage.objects
  for insert with check (
    bucket_id = 'lab-reports'
    and public.can_write_lab(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists lab_reports_update on storage.objects;
create policy lab_reports_update on storage.objects
  for update using (
    bucket_id = 'lab-reports'
    and public.can_write_lab(((storage.foldername(name))[1])::uuid)
  ) with check (
    bucket_id = 'lab-reports'
    and public.can_write_lab(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists lab_reports_delete on storage.objects;
create policy lab_reports_delete on storage.objects
  for delete using (
    bucket_id = 'lab-reports'
    and public.can_write_lab(((storage.foldername(name))[1])::uuid)
  );

-- ============================================================================
-- AI-generated figures
--
-- The notebook step's "AI??????" action used to only queue the image as a
-- workspace clip - fine for the current report, but nothing survived past the
-- browser session: no durable row, no created_by, nothing to pick again from
-- "??????????" the way a chart from /analyze can be. Adding one enum
-- value lets it go through the exact same `figures` insert every other figure
-- kind already uses (see saveFigure), stored as a small SVG wrapper around the
-- PNG so the existing `svg text` column and clip-insertion code need no change.
--
-- Safe to re-run: ADD VALUE IF NOT EXISTS is itself idempotent.
-- ============================================================================

alter type public.figure_kind add value if not exists 'ai_image';

-- ============================================================================
-- Contact messages
--
-- The public /contact form is reachable without a session, like the landing
-- page itself. It writes through a server action using the service-role
-- client (see submitContactMessage in src/lib/contact/actions.ts), the same
-- way billing_events is written only by the Stripe webhook handler - so this
-- table gets no client-facing policy at all. RLS is enabled with zero
-- policies, which denies every direct read/write from an anon or
-- authenticated client outright; only the service role (which bypasses RLS)
-- can touch it.
--
-- Safe to re-run: every statement is guarded.
-- ============================================================================

create table if not exists public.contact_messages (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null,
  phone        text,
  message      text not null,
  submitted_by uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;

-- ============================================================================
-- Reviewer names: generic labels instead of personal names
--
-- Customer feedback: a real-sounding name (?? ? / ?? ? / ?? ?) reads as
-- more authoritative than an AI reviewer's opinion should. Renamed to the
-- generic "Researcher N" labels a journal's own decision letter uses
-- ("Reviewer 1", "Reviewer 2", ...), matching DEFAULT_REVIEWER_NAMES in
-- src/lib/ai/reviewerProfiles.ts.
--
-- Only rewrites rows still holding one of the original seed names, so an
-- administrator who already renamed a reviewer at /admin/peer-review is left
-- alone - same guard shape as the platform_role admin seed above.
--
-- Safe to re-run: the WHERE clause makes this a no-op once applied.
-- ============================================================================

update public.reviewer_profiles
   set name = case role
     when 'methods'   then 'Researcher 1'
     when 'novelty'   then 'Researcher 2'
     when 'structure' then 'Researcher 3'
   end
 where name in ('?? ?', '?? ?', '?? ?');

-- ============================================================================
-- Peer-review credit packs (idempotent refresh)
-- Same catalogue as the seed above; safe if that block already ran.
-- ============================================================================

alter table public.peer_review_credit_prices
  drop constraint if exists peer_review_credit_prices_pack_id_check;

delete from public.peer_review_credit_prices
 where pack_id not in ('single', 'thirty', 'monthly');

alter table public.peer_review_credit_prices
  add constraint peer_review_credit_prices_pack_id_check
  check (pack_id in ('single', 'thirty', 'monthly'));

insert into public.peer_review_credit_prices (pack_id, credits, amount_jpy) values
  ('single',  1,     100),
  ('thirty',  30,    2000),
  ('monthly', 10000, 5000)
on conflict (pack_id) do update
  set credits = excluded.credits,
      amount_jpy = excluded.amount_jpy,
      stripe_price_id = case
        when public.peer_review_credit_prices.amount_jpy is distinct from excluded.amount_jpy
          or public.peer_review_credit_prices.credits is distinct from excluded.credits
        then null
        else public.peer_review_credit_prices.stripe_price_id
      end;

-- ============================================================================
-- Submission files: Figure / Table / Video / Article
--
-- Most journals require figures, tables, video, and the manuscript text to be
-- uploaded as separate files at submission time, not embedded in one document
-- - customer feedback asked for exactly that separation. These are kept
-- distinct from the notebook's inline images (`figures`, and `raw_files` rows
-- of kind 'report_preview'/'report_final'): those illustrate or constitute
-- today's lab report itself, while a submission file belongs to the
-- experiment as a whole and is never inserted into the report body.
--
-- Reuses `raw_files` (already generic, and already the same "just another
-- file that belongs to an experiment" table 'report_preview'/'report_final'
-- use) rather than a new table - widening the kind check is all that's
-- needed. A separate bucket (`submission-files`, not `lab-reports`) keeps
-- these organizationally distinct from generated report PDFs, with the exact
-- same storage-policy shape.
--
-- Safe to re-run: every statement is guarded.
-- ============================================================================

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.raw_files'::regclass
      and conname = 'raw_files_kind_check'
  ) then
    alter table public.raw_files drop constraint raw_files_kind_check;
  end if;
  alter table public.raw_files
    add constraint raw_files_kind_check
    check (kind in (
      'raw', 'report_preview', 'report_final',
      'figure', 'table', 'video', 'article'
    ));
end $$;

insert into storage.buckets (id, name, public)
values ('submission-files', 'submission-files', false)
on conflict (id) do nothing;

-- Same folder convention and the same is_lab_member/can_write_lab policy
-- shape as lab-reports above.
drop policy if exists submission_files_select on storage.objects;
create policy submission_files_select on storage.objects
  for select using (
    bucket_id = 'submission-files'
    and public.is_lab_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists submission_files_insert on storage.objects;
create policy submission_files_insert on storage.objects
  for insert with check (
    bucket_id = 'submission-files'
    and public.can_write_lab(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists submission_files_update on storage.objects;
create policy submission_files_update on storage.objects
  for update using (
    bucket_id = 'submission-files'
    and public.can_write_lab(((storage.foldername(name))[1])::uuid)
  ) with check (
    bucket_id = 'submission-files'
    and public.can_write_lab(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists submission_files_delete on storage.objects;
create policy submission_files_delete on storage.objects
  for delete using (
    bucket_id = 'submission-files'
    and public.can_write_lab(((storage.foldername(name))[1])::uuid)
  );


-- ============================================================================
-- Subscription plan overhaul (2026): max_labs + list prices
-- Safe to re-run. Prefer running THIS block alone if the full file fails.
-- ============================================================================

do $$
begin
  if to_regclass('public.plan_limits') is not null
     and not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'plan_limits'
         and column_name = 'max_labs'
     )
  then
    alter table public.plan_limits add column max_labs integer;
  end if;
end $$;

insert into public.plan_limits (plan, max_labs, max_members, max_experiments, max_datasets, ai_enabled)
values
  ('free', 1,    5,    10,   null, true),
  ('pro',  10,   100,  200,  null, true),
  ('team', null, null, null, null, true)
on conflict (plan) do update set
  max_labs        = excluded.max_labs,
  max_members     = excluded.max_members,
  max_experiments = excluded.max_experiments,
  max_datasets    = excluded.max_datasets,
  ai_enabled      = excluded.ai_enabled;

insert into public.plan_prices (plan) values ('free'), ('pro'), ('team')
on conflict (plan) do nothing;

-- Reset list prices to the new catalogue. Clear Stripe price ids only when
-- the cached yen amount still differs, so re-running after stripe:setup does
-- not wipe freshly created prices.
update public.plan_prices
set
  stripe_price_id = case
    when amount_jpy is distinct from (case plan
      when 'free' then 30000
      when 'pro'  then 50000
      when 'team' then 50000
    end) then null
    else stripe_price_id
  end,
  amount_jpy = case plan
    when 'free' then 30000
    when 'pro'  then 50000
    when 'team' then 50000
  end,
  updated_at = now()
where plan in ('free', 'pro', 'team');

-- Reloads PostgREST so new columns (e.g. reagents.experiment_id) are visible
-- to the API immediately after this migration runs.
notify pgrst, 'reload schema';

-- ============================================================================
-- Admin users page: "currently logged in" status
-- Safe to re-run.
-- ============================================================================

-- `auth.sessions` is not exposed over PostgREST, so the admin users page has
-- no way to tell which accounts have a live (unexpired) session. This reads
-- it under SECURITY DEFINER and hands back only the set of user ids with at
-- least one session where `not_after` is still in the future. Execute is
-- granted to `service_role` only - the admin page already calls this through
-- the service-role client, and no other role should be able to enumerate who
-- is currently online.
create or replace function public.admin_active_session_user_ids()
returns setof uuid
language sql
security definer
set search_path = public, auth
as $$
  select distinct user_id
  from auth.sessions
  where not_after is null or not_after > now();
$$;

revoke all on function public.admin_active_session_user_ids() from public;
grant execute on function public.admin_active_session_user_ids() to service_role;

-- Reloads PostgREST so the new function is callable via RPC immediately.
notify pgrst, 'reload schema';

-- ============================================================================
-- Lab chat: channels, DMs, messages, calls
-- Safe to re-run.
--
-- Channels are public within their lab (any member can see/post, matching
-- how every other lab-scoped table already works) - there is no separate
-- channel_members table. Only the lab owner may create a channel. DMs are a
-- private pair scoped to one lab, since the whole feature nests under
-- "labs" rather than being a cross-lab global inbox.
-- ============================================================================

create table if not exists public.channels (
  id          uuid primary key default gen_random_uuid(),
  lab_id      uuid not null references public.laboratories (id) on delete cascade,
  name        text not null,
  topic       text,
  created_by  uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (lab_id, name)
);
create index if not exists channels_lab_idx on public.channels (lab_id);

create table if not exists public.dm_conversations (
  id         uuid primary key default gen_random_uuid(),
  lab_id     uuid not null references public.laboratories (id) on delete cascade,
  user_a     uuid not null references auth.users (id) on delete cascade,
  user_b     uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a < user_b),
  unique (lab_id, user_a, user_b)
);
create index if not exists dm_conversations_lab_idx on public.dm_conversations (lab_id);

create table if not exists public.messages (
  id                 uuid primary key default gen_random_uuid(),
  -- Denormalized from channel/dm_conversation so RLS and indexes on this,
  -- the highest-volume table in the feature, never need a join.
  lab_id             uuid not null references public.laboratories (id) on delete cascade,
  channel_id         uuid references public.channels (id) on delete cascade,
  dm_conversation_id uuid references public.dm_conversations (id) on delete cascade,
  sender_id          uuid references auth.users (id) on delete set null,
  body               text,
  attachment_path    text,
  attachment_name    text,
  attachment_mime    text,
  edited_at          timestamptz,
  -- Soft delete: keep the row, blank the body, so a deleted message renders
  -- as a "message deleted" placeholder the way Slack's does rather than
  -- leaving a gap in the thread.
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  check (
    (channel_id is not null and dm_conversation_id is null) or
    (channel_id is null and dm_conversation_id is not null)
  ),
  check (body is not null or attachment_path is not null)
);
create index if not exists messages_channel_idx on public.messages (channel_id, created_at);
create index if not exists messages_dm_idx on public.messages (dm_conversation_id, created_at);

create table if not exists public.calls (
  id                 uuid primary key default gen_random_uuid(),
  lab_id             uuid not null references public.laboratories (id) on delete cascade,
  channel_id         uuid references public.channels (id) on delete cascade,
  dm_conversation_id uuid references public.dm_conversations (id) on delete cascade,
  kind               text not null check (kind in ('audio', 'video')),
  started_by         uuid references auth.users (id) on delete set null,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,
  check (
    (channel_id is not null and dm_conversation_id is null) or
    (channel_id is null and dm_conversation_id is not null)
  )
);
create index if not exists calls_channel_active_idx on public.calls (channel_id) where ended_at is null;
create index if not exists calls_dm_active_idx on public.calls (dm_conversation_id) where ended_at is null;

create table if not exists public.call_participants (
  call_id   uuid not null references public.calls (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at   timestamptz,
  primary key (call_id, user_id)
);

-- touch_updated_at() already exists (see the Identity section near the top
-- of this file) - channels is the only new table with an updated_at column.
drop trigger if exists channels_touch_updated_at on public.channels;
create trigger channels_touch_updated_at
  before update on public.channels
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helper functions - same shape as is_lab_member/can_write_lab/
-- is_lab_admin above (language sql stable security definer).
-- ---------------------------------------------------------------------------

create or replace function public.is_lab_owner(target_lab uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lab_members m
    where m.lab_id = target_lab and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

create or replace function public.is_dm_participant(target_dm uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dm_conversations d
    where d.id = target_dm and auth.uid() in (d.user_a, d.user_b)
  );
$$;

-- Thin wrappers so the storage policy below (keyed on a channel/dm id, not a
-- lab id directly) can compose with is_lab_member/can_write_lab.
create or replace function public.is_channel_member(target_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channels c
    where c.id = target_channel and public.is_lab_member(c.lab_id)
  );
$$;

create or replace function public.can_write_channel(target_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channels c
    where c.id = target_channel and public.can_write_lab(c.lab_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.channels enable row level security;
drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels
  for select using (public.is_lab_member(lab_id));
drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels
  for insert with check (public.is_lab_owner(lab_id));
drop policy if exists channels_update on public.channels;
create policy channels_update on public.channels
  for update using (public.is_lab_admin(lab_id));
drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels
  for delete using (public.is_lab_admin(lab_id));

alter table public.dm_conversations enable row level security;
drop policy if exists dm_conversations_select on public.dm_conversations;
create policy dm_conversations_select on public.dm_conversations
  for select using (auth.uid() in (user_a, user_b));
drop policy if exists dm_conversations_insert on public.dm_conversations;
create policy dm_conversations_insert on public.dm_conversations
  for insert with check (
    auth.uid() in (user_a, user_b)
    and public.is_lab_member(lab_id)
    and exists (
      select 1 from public.lab_members m
      where m.lab_id = dm_conversations.lab_id
        and m.user_id = case when user_a = auth.uid() then user_b else user_a end
    )
  );
-- No update/delete policy - a DM conversation is permanent once created,
-- same posture as lab_invites' append-only rows.

alter table public.messages enable row level security;
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (
    (channel_id is not null and public.is_lab_member(lab_id))
    or (dm_conversation_id is not null and public.is_dm_participant(dm_conversation_id))
  );
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    sender_id = auth.uid()
    and (
      (channel_id is not null and public.can_write_lab(lab_id))
      or (dm_conversation_id is not null and public.is_dm_participant(dm_conversation_id))
    )
  );
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update using (sender_id = auth.uid());
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete using (sender_id = auth.uid());

alter table public.calls enable row level security;
drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls
  for select using (
    (channel_id is not null and public.is_lab_member(lab_id))
    or (dm_conversation_id is not null and public.is_dm_participant(dm_conversation_id))
  );
drop policy if exists calls_insert on public.calls;
create policy calls_insert on public.calls
  for insert with check (
    started_by = auth.uid()
    and (
      (channel_id is not null and public.can_write_lab(lab_id))
      or (dm_conversation_id is not null and public.is_dm_participant(dm_conversation_id))
    )
  );
drop policy if exists calls_update on public.calls;
create policy calls_update on public.calls
  for update using (
    started_by = auth.uid()
    or exists (
      select 1 from public.call_participants cp
      where cp.call_id = calls.id and cp.user_id = auth.uid()
    )
  );

alter table public.call_participants enable row level security;
drop policy if exists call_participants_select on public.call_participants;
create policy call_participants_select on public.call_participants
  for select using (
    exists (
      select 1 from public.calls c
      where c.id = call_id
        and (
          (c.channel_id is not null and public.is_lab_member(c.lab_id))
          or (c.dm_conversation_id is not null and public.is_dm_participant(c.dm_conversation_id))
        )
    )
  );
drop policy if exists call_participants_insert on public.call_participants;
create policy call_participants_insert on public.call_participants
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.calls c
      where c.id = call_id
        and (
          (c.channel_id is not null and public.is_lab_member(c.lab_id))
          or (c.dm_conversation_id is not null and public.is_dm_participant(c.dm_conversation_id))
        )
    )
  );
drop policy if exists call_participants_update on public.call_participants;
create policy call_participants_update on public.call_participants
  for update using (user_id = auth.uid());

-- Durable message delivery goes over Postgres Changes; call state is
-- ephemeral (Broadcast/Presence only) and deliberately left off this
-- publication. Enabling Realtime on a table needs BOTH publication
-- membership (this line) AND a select policy Realtime's authorizer can
-- evaluate (messages_select above already provides it).
-- `alter publication ... add table` errors if the table is already a
-- member, so this checks pg_publication_tables first to stay re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Default "general" channel for every lab, existing and future. New labs
-- get one from createLabAction/ensurePersonalLab at creation time; this
-- backfills labs that already exist.
-- ---------------------------------------------------------------------------

insert into public.channels (lab_id, name, created_by)
select l.id, 'general', l.owner_id
from public.laboratories l
where not exists (select 1 from public.channels c where c.lab_id = l.id)
on conflict (lab_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- chat-attachments storage bucket
--
-- Path convention: {lab_id}/{channel_id_or_dm_conversation_id}/{filename},
-- same shape as the submission-files bucket. Unlike that bucket, the policy
-- here checks BOTH path segments, not just the lab-id one: a DM's messages
-- row is correctly locked to its two participants via is_dm_participant,
-- but if the storage policy only checked the lab segment, any lab member
-- could read another pair's DM attachments by guessing the conversation-id
-- folder. Checking the second segment against either "is a channel of this
-- lab" or "is a DM I'm part of" keeps the file layer as private as the row
-- layer.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

drop policy if exists chat_attachments_select on storage.objects;
create policy chat_attachments_select on storage.objects for select using (
  bucket_id = 'chat-attachments'
  and public.is_lab_member(((storage.foldername(name))[1])::uuid)
  and (
    public.is_channel_member(((storage.foldername(name))[2])::uuid)
    or public.is_dm_participant(((storage.foldername(name))[2])::uuid)
  )
);
drop policy if exists chat_attachments_insert on storage.objects;
create policy chat_attachments_insert on storage.objects for insert with check (
  bucket_id = 'chat-attachments'
  and public.can_write_lab(((storage.foldername(name))[1])::uuid)
  and (
    public.can_write_channel(((storage.foldername(name))[2])::uuid)
    or public.is_dm_participant(((storage.foldername(name))[2])::uuid)
  )
);
drop policy if exists chat_attachments_delete on storage.objects;
create policy chat_attachments_delete on storage.objects for delete using (
  bucket_id = 'chat-attachments'
  and public.can_write_lab(((storage.foldername(name))[1])::uuid)
  and (
    public.can_write_channel(((storage.foldername(name))[2])::uuid)
    or public.is_dm_participant(((storage.foldername(name))[2])::uuid)
  )
);

-- ============================================================================
-- Experiment ownership + invited-user limit
-- ============================================================================
--
-- The laboratory creator/owner may open as many experiments as needed.
-- Everyone else invited into that laboratory may create at most one
-- experiment there, and ordinary client-side deletes are limited to the
-- experiment's creator. Admin pages still use the service role and therefore
-- remain an explicit override path.
-- ============================================================================

create or replace function public.enforce_experiment_creator_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user uuid := auth.uid();
  lab_owner uuid;
  existing_count bigint;
begin
  -- Service-role writes bypass ordinary browser rules intentionally.
  if current_user is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    return new;
  end if;

  new.created_by := current_user;

  select l.owner_id
    into lab_owner
    from public.laboratories l
   where l.id = new.lab_id;

  if lab_owner = current_user then
    return new;
  end if;

  select count(*)
    into existing_count
    from public.experiments e
   where e.lab_id = new.lab_id
     and e.created_by = current_user;

  if existing_count > 0 then
    raise exception '招待されたユーザーは、同じ研究室で作成できる実験は1件までです。'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_experiment_creator_rules on public.experiments;
create trigger enforce_experiment_creator_rules
  before insert or update on public.experiments
  for each row execute function public.enforce_experiment_creator_rules();

drop policy if exists experiments_insert on public.experiments;
create policy experiments_insert on public.experiments
  for insert with check (public.can_write_lab(lab_id));

drop policy if exists experiments_update on public.experiments;
create policy experiments_update on public.experiments
  for update using (public.can_write_lab(lab_id)) with check (public.can_write_lab(lab_id));

drop policy if exists experiments_delete on public.experiments;
create policy experiments_delete on public.experiments
  for delete using (
    created_by = auth.uid()
    and public.can_write_lab(lab_id)
  );

-- Reloads PostgREST so the new tables/functions are visible to the API
-- immediately after this migration runs.
notify pgrst, 'reload schema';

-- ============================================================================
-- Fix: personal-workspace auto-provisioning race
--
-- getSessionContext() is called from several places on the same page load
-- (the layout, the page, /api/me, /api/notifications, /api/notebook/today),
-- and each one independently ran "does this user have a lab? no -> create
-- one" with no locking between them. A brand-new account's first page load
-- could fire several of those checks before the first insert committed, so
-- every one of them saw zero labs and created its own - confirmed in
-- production: one real account ended up owning 5 duplicate "workspace"
-- labs. This wraps the check-and-create in a single function that takes a
-- Postgres advisory transaction lock keyed on the user id, so concurrent
-- callers serialize and only the first one actually creates anything.
-- Safe to re-run.
-- ============================================================================

create or replace function public.ensure_personal_lab(target_user uuid, workspace_name text)
returns table (lab_id uuid, lab_name text, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing record;
  new_lab record;
begin
  perform pg_advisory_xact_lock(hashtext(target_user::text));

  select l.id, l.name into existing
    from public.lab_members m
    join public.laboratories l on l.id = m.lab_id
   where m.user_id = target_user
   order by m.joined_at asc
   limit 1;

  if found then
    lab_id := existing.id;
    lab_name := existing.name;
    created := false;
    return next;
    return;
  end if;

  insert into public.laboratories (name, description, owner_id)
  values (
    workspace_name,
    '個人用に自動作成されたワークスペースです。チームで共有する場合は管理者に研究室へ招待してもらってください。',
    target_user
  )
  returning id, name into new_lab;

  insert into public.lab_members (lab_id, user_id, role)
  values (new_lab.id, target_user, 'owner');

  lab_id := new_lab.id;
  lab_name := new_lab.name;
  created := true;
  return next;
end;
$$;

revoke all on function public.ensure_personal_lab(uuid, text) from public;
grant execute on function public.ensure_personal_lab(uuid, text) to service_role;

-- Reloads PostgREST so the new function is callable via RPC immediately.
notify pgrst, 'reload schema';


-- ============================================================================
-- Chat conversation read cursors (delivery / read checkmarks)
-- Safe to re-run.
--
-- One row per viewer per conversation. When a viewer opens a channel or DM,
-- their `last_read_at` advances to now; senders then show a second checkmark
-- on any of their messages created at-or-before that cursor.
-- ============================================================================

create table if not exists public.chat_conversation_reads (
  id                 uuid primary key default gen_random_uuid(),
  lab_id             uuid not null references public.laboratories (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  channel_id         uuid references public.channels (id) on delete cascade,
  dm_conversation_id uuid references public.dm_conversations (id) on delete cascade,
  last_read_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (
    (channel_id is not null and dm_conversation_id is null)
    or (channel_id is null and dm_conversation_id is not null)
  )
);

create unique index if not exists chat_conversation_reads_channel_user_uidx
  on public.chat_conversation_reads (channel_id, user_id)
  where channel_id is not null;

create unique index if not exists chat_conversation_reads_dm_user_uidx
  on public.chat_conversation_reads (dm_conversation_id, user_id)
  where dm_conversation_id is not null;

create index if not exists chat_conversation_reads_channel_idx
  on public.chat_conversation_reads (channel_id, last_read_at desc)
  where channel_id is not null;

create index if not exists chat_conversation_reads_dm_idx
  on public.chat_conversation_reads (dm_conversation_id, last_read_at desc)
  where dm_conversation_id is not null;

alter table public.chat_conversation_reads enable row level security;

drop policy if exists chat_conversation_reads_select on public.chat_conversation_reads;
create policy chat_conversation_reads_select on public.chat_conversation_reads
  for select using (
    (channel_id is not null and public.is_lab_member(lab_id))
    or (dm_conversation_id is not null and public.is_dm_participant(dm_conversation_id))
  );

drop policy if exists chat_conversation_reads_insert on public.chat_conversation_reads;
create policy chat_conversation_reads_insert on public.chat_conversation_reads
  for insert with check (
    user_id = auth.uid()
    and (
      (channel_id is not null and public.is_lab_member(lab_id))
      or (dm_conversation_id is not null and public.is_dm_participant(dm_conversation_id))
    )
  );

drop policy if exists chat_conversation_reads_update on public.chat_conversation_reads;
create policy chat_conversation_reads_update on public.chat_conversation_reads
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_conversation_reads'
  ) then
    alter publication supabase_realtime add table public.chat_conversation_reads;
  end if;
exception when undefined_object then
  null;
end;
$$;

notify pgrst, 'reload schema';

-- ============================================================================
-- Private channels
-- Safe to re-run.
--
-- A channel is public by default (every lab member can see and post in it,
-- as before). Setting `is_private` scopes visibility to an explicit
-- `channel_members` roster instead - matching Slack's public/private
-- distinction. Only a lab owner or admin may create a channel (loosened
-- from owner-only); the creator and lab admins may invite/remove people
-- from a private channel's roster, and any member may leave one themselves.
-- ============================================================================

alter table public.channels add column if not exists is_private boolean not null default false;

create table if not exists public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  added_by   uuid references auth.users (id) on delete set null,
  added_at   timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index if not exists channel_members_user_idx on public.channel_members (user_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_private_channel_member(target_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channel_members cm
    where cm.channel_id = target_channel and cm.user_id = auth.uid()
  );
$$;

-- Redefines the two helpers introduced with the original chat migration
-- (previously "is a member of the channel's lab", used only by the
-- chat-attachments storage policy) to also account for a channel being
-- private. Every caller of these two functions - the storage policies
-- below (unchanged, since the function they call is what changed) plus the
-- channel/message/call/read-cursor policies further down - inherits correct
-- private-channel behavior without needing its own SQL rewritten.
create or replace function public.is_channel_member(target_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channels c
    where c.id = target_channel
      and (
        (not c.is_private and public.is_lab_member(c.lab_id))
        or public.is_private_channel_member(c.id)
      )
  );
$$;

create or replace function public.can_write_channel(target_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channels c
    where c.id = target_channel
      and (
        (not c.is_private and public.can_write_lab(c.lab_id))
        or (public.is_private_channel_member(c.id) and public.can_write_lab(c.lab_id))
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- channels: select respects privacy; insert loosened from owner-only to
-- owner-or-admin ("lab administrator"); update/delete unchanged (still
-- owner-or-admin, i.e. is_lab_admin).
-- ---------------------------------------------------------------------------

drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels
  for select using (
    (not is_private and public.is_lab_member(lab_id))
    or public.is_private_channel_member(id)
    or created_by = auth.uid()
  );

drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels
  for insert with check (public.is_lab_admin(lab_id));

-- ---------------------------------------------------------------------------
-- channel_members: a member (or the channel's creator, or a lab admin) may
-- read the roster; only the creator or a lab admin may add/remove someone
-- else; anyone may remove their own row (leaving the channel).
-- ---------------------------------------------------------------------------

alter table public.channel_members enable row level security;

drop policy if exists channel_members_select on public.channel_members;
create policy channel_members_select on public.channel_members
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.channels c
      where c.id = channel_id and (c.created_by = auth.uid() or public.is_lab_admin(c.lab_id))
    )
  );

drop policy if exists channel_members_insert on public.channel_members;
create policy channel_members_insert on public.channel_members
  for insert with check (
    exists (
      select 1 from public.channels c
      where c.id = channel_id and (c.created_by = auth.uid() or public.is_lab_admin(c.lab_id))
    )
  );

drop policy if exists channel_members_delete on public.channel_members;
create policy channel_members_delete on public.channel_members
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.channels c
      where c.id = channel_id and (c.created_by = auth.uid() or public.is_lab_admin(c.lab_id))
    )
  );

-- ---------------------------------------------------------------------------
-- messages / calls / call_participants / chat_conversation_reads: the
-- channel branch of each policy now goes through is_channel_member /
-- can_write_channel instead of is_lab_member(lab_id) / can_write_lab(lab_id)
-- directly, so a private channel's messages, calls, and read cursors are
-- exactly as private as the channel itself. The DM branch of every policy
-- is untouched.
-- ---------------------------------------------------------------------------

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (
    (channel_id is not null and public.is_channel_member(channel_id))
    or (dm_conversation_id is not null and public.is_dm_participant(dm_conversation_id))
  );

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    sender_id = auth.uid()
    and (
      (channel_id is not null and public.can_write_channel(channel_id))
      or (dm_conversation_id is not null and public.is_dm_participant(dm_conversation_id))
    )
  );

drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls
  for select using (
    (channel_id is not null and public.is_channel_member(channel_id))
    or (dm_conversation_id is not null and public.is_dm_participant(dm_conversation_id))
  );

drop policy if exists calls_insert on public.calls;
create policy calls_insert on public.calls
  for insert with check (
    started_by = auth.uid()
    and (
      (channel_id is not null and public.can_write_channel(channel_id))
      or (dm_conversation_id is not null and public.is_dm_participant(dm_conversation_id))
    )
  );

drop policy if exists call_participants_select on public.call_participants;
create policy call_participants_select on public.call_participants
  for select using (
    exists (
      select 1 from public.calls c
      where c.id = call_id
        and (
          (c.channel_id is not null and public.is_channel_member(c.channel_id))
          or (c.dm_conversation_id is not null and public.is_dm_participant(c.dm_conversation_id))
        )
    )
  );

drop policy if exists call_participants_insert on public.call_participants;
create policy call_participants_insert on public.call_participants
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.calls c
      where c.id = call_id
        and (
          (c.channel_id is not null and public.can_write_channel(c.channel_id))
          or (c.dm_conversation_id is not null and public.is_dm_participant(c.dm_conversation_id))
        )
    )
  );

drop policy if exists chat_conversation_reads_select on public.chat_conversation_reads;
create policy chat_conversation_reads_select on public.chat_conversation_reads
  for select using (
    (channel_id is not null and public.is_channel_member(channel_id))
    or (dm_conversation_id is not null and public.is_dm_participant(dm_conversation_id))
  );

drop policy if exists chat_conversation_reads_insert on public.chat_conversation_reads;
create policy chat_conversation_reads_insert on public.chat_conversation_reads
  for insert with check (
    user_id = auth.uid()
    and (
      (channel_id is not null and public.is_channel_member(channel_id))
      or (dm_conversation_id is not null and public.is_dm_participant(dm_conversation_id))
    )
  );

notify pgrst, 'reload schema';
