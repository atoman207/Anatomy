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

grant execute on function public.create_laboratory(text, text) to authenticated;

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
drop policy if exists labs_insert on public.laboratories;
create policy labs_insert on public.laboratories
  for insert with check (owner_id = auth.uid());
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
    'projects', 'experiments', 'notebook_templates', 'notebook_entries',
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

-- audit_logs: readable by lab members, append-only for them, never updated.
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs
  for select using (lab_id is not null and public.is_lab_member(lab_id));
drop policy if exists audit_insert on public.audit_logs;
create policy audit_insert on public.audit_logs
  for insert with check (lab_id is not null and public.is_lab_member(lab_id));

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
  insert into public.profiles (id, email, display_name, avatar_url, date_of_birth, phone_number, major)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    nullif(new.raw_user_meta_data ->> 'date_of_birth', '')::date,
    new.raw_user_meta_data ->> 'phone_number',
    new.raw_user_meta_data ->> 'major'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
