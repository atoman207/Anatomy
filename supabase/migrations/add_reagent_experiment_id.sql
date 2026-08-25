-- Add experiment scoping to reagents (fixes:
-- "Could not find the 'experiment_id' column of 'reagents' in the schema cache")
--
-- Paste this into: Supabase Dashboard → SQL Editor → New query → Run

alter table public.reagents
  add column if not exists experiment_id uuid references public.experiments (id) on delete cascade;

create index if not exists reagents_experiment_idx on public.reagents (experiment_id);

-- Reload PostgREST schema cache so the API sees the new column immediately.
notify pgrst, 'reload schema';
