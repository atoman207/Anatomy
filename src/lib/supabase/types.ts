/**
 * Database types.
 *
 * Hand-written to match supabase/migrations/0001_init.sql. Keep them in step
 * when the schema changes, or regenerate with:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type LabRole = "owner" | "admin" | "member" | "viewer";
export type ExperimentStatus = "planned" | "in_progress" | "complete" | "archived";
export type AnalysisKind =
  | "ttest" | "anova" | "pca" | "kmeans" | "hierarchical" | "differential" | "descriptive";
export type FigureKind = "volcano" | "heatmap" | "pca" | "other";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  date_of_birth: string | null;
  phone_number: string | null;
  major: string | null;
  created_at: string;
  updated_at: string;
}

export type Laboratory = {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export type LabMember = {
  lab_id: string;
  user_id: string;
  role: LabRole;
  joined_at: string;
}

export type Project = {
  id: string;
  lab_id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type Experiment = {
  id: string;
  lab_id: string;
  project_id: string | null;
  name: string;
  experiment_date: string;
  operator: string | null;
  purpose: string | null;
  status: ExperimentStatus;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type NotebookTemplateRow = {
  id: string;
  lab_id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  fields: Json;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type NotebookEntry = {
  id: string;
  lab_id: string;
  experiment_id: string;
  template_id: string | null;
  template_slug: string | null;
  title: string;
  values: Json;
  body_md: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type RawFileRow = {
  id: string;
  lab_id: string;
  experiment_id: string | null;
  name: string;
  stem: string | null;
  extension: string | null;
  platform: string | null;
  path: string | null;
  size_bytes: number | null;
  modified_at: string | null;
  inferred_sample: string | null;
  inferred_group: string | null;
  inferred_replicate: number | null;
  inferred_batch: string | null;
  inferred_order: number | null;
  issues: Json;
  created_at: string;
}

export type SampleSheetRow = {
  id: string;
  lab_id: string;
  experiment_id: string | null;
  name: string;
  rows: Json;
  extra_columns: Json;
  issues: Json;
  is_valid: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type RenameOperation = {
  id: string;
  lab_id: string;
  experiment_id: string | null;
  rules: Json;
  mapping: Json;
  file_count: number;
  applied: boolean;
  reverted_at: string | null;
  created_by: string | null;
  created_at: string;
}

export type Dataset = {
  id: string;
  lab_id: string;
  experiment_id: string | null;
  name: string;
  source_filename: string | null;
  source_sheet: string | null;
  feature_count: number;
  sample_count: number;
  matrix: Json;
  profile: Json;
  notes: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type Analysis = {
  id: string;
  lab_id: string;
  experiment_id: string | null;
  dataset_id: string | null;
  kind: AnalysisKind;
  title: string | null;
  params: Json;
  result: Json;
  created_by: string | null;
  created_at: string;
}

export type Figure = {
  id: string;
  lab_id: string;
  experiment_id: string | null;
  analysis_id: string | null;
  kind: FigureKind;
  title: string;
  options: Json;
  svg: string | null;
  created_by: string | null;
  created_at: string;
}

export type AuditLog = {
  id: number;
  lab_id: string | null;
  user_id: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  detail: Json;
  created_at: string;
}

/** Insert shapes: server-generated columns are optional. */
type Generated = "id" | "created_at" | "updated_at";
type Insert<T, K extends keyof T = never> = Omit<T, Extract<keyof T, Generated> | K> &
  Partial<Pick<T, Extract<keyof T, Generated>>> &
  Partial<Pick<T, Extract<K, keyof T>>>;

type TableDef<Row, I = Insert<Row>> = {
  Row: Row;
  Insert: I;
  Update: Partial<Row>;
  Relationships: [];
}

export type Database = {
  public: {
    Tables: {
      profiles: TableDef<Profile>;
      laboratories: TableDef<Laboratory>;
      lab_members: TableDef<LabMember, Omit<LabMember, "joined_at"> & { joined_at?: string }>;
      projects: TableDef<Project>;
      experiments: TableDef<Experiment, Insert<Experiment, "status" | "tags" | "experiment_date">>;
      notebook_templates: TableDef<NotebookTemplateRow>;
      notebook_entries: TableDef<NotebookEntry>;
      raw_files: TableDef<RawFileRow>;
      sample_sheets: TableDef<SampleSheetRow>;
      rename_operations: TableDef<RenameOperation>;
      datasets: TableDef<Dataset>;
      analyses: TableDef<Analysis>;
      figures: TableDef<Figure>;
      audit_logs: TableDef<AuditLog, Omit<AuditLog, "id" | "created_at"> & { created_at?: string }>;
    };
    Views: Record<string, never>;
    Functions: {
      create_laboratory: {
        Args: { lab_name: string; lab_description?: string | null };
        Returns: Laboratory;
      };
      is_lab_member: { Args: { target_lab: string }; Returns: boolean };
      can_write_lab: { Args: { target_lab: string }; Returns: boolean };
      is_lab_admin: { Args: { target_lab: string }; Returns: boolean };
    };
    Enums: {
      lab_role: LabRole;
      experiment_status: ExperimentStatus;
      analysis_kind: AnalysisKind;
      figure_kind: FigureKind;
    };
    CompositeTypes: Record<string, never>;
  };
}
