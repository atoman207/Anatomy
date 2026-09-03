/**
 * Database types.
 *
 * Hand-written to match supabase/migrations/all.sql. Keep them in step
 * when the schema changes, or regenerate with:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type LabRole = "owner" | "admin" | "member" | "viewer";
/** Deployment-wide role. Distinct from LabRole, which scopes a single laboratory. */
export type PlatformRole = "admin" | "user";
export type ExperimentStatus = "planned" | "in_progress" | "complete" | "archived";
export type AnalysisKind =
  | "ttest" | "anova" | "pca" | "kmeans" | "hierarchical" | "differential" | "descriptive";
export type FigureKind = "volcano" | "heatmap" | "pca" | "other" | "ai_image";
/** Billing plan and Stripe subscription status; mirror of migration 0002. */
export type BillingPlan = "free" | "solo" | "pro" | "team";
export type BillingStatus =
  | "active" | "trialing" | "past_due" | "canceled"
  | "incomplete" | "incomplete_expired" | "unpaid" | "paused";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  platform_role: PlatformRole;
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

/** A promise that `email` will hold `role` in `lab_id` once they sign up; see acceptPendingLabInvites. */
export type LabInvite = {
  id: string;
  lab_id: string;
  email: string;
  role: LabRole;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
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
  kind: "raw" | "report_preview" | "report_final" | "figure" | "table" | "video" | "article";
  storage_path: string | null;
  mime_type: string | null;
  created_by: string | null;
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

export type VoiceNote = {
  id: string;
  lab_id: string;
  experiment_id: string | null;
  engine: string | null;
  model: string | null;
  audio_seconds: number | null;
  raw_transcript: string | null;
  transcribed_at: string | null;
  edited_transcript: string | null;
  edited_at: string | null;
  ai_note: Json;
  ai_structured_at: string | null;
  final_markdown: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type SavedPaper = {
  id: string;
  lab_id: string;
  experiment_id: string | null;
  pmid: string | null;
  doi: string | null;
  title: string;
  journal: string | null;
  pub_year: number | null;
  authors: Json;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  url: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export type Reagent = {
  id: string;
  lab_id: string;
  experiment_id: string | null;
  name: string;
  category: string | null;
  vendor: string | null;
  lot: string | null;
  received_at: string | null;
  expires_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/* Billing - see supabase/migrations/all.sql (billing section). */

export type PlanLimitRow = {
  plan: BillingPlan;
  max_members: number | null;
  max_experiments: number | null;
  max_datasets: number | null;
  ai_enabled: boolean;
}

export type LabSubscription = {
  lab_id: string;
  plan: BillingPlan;
  status: BillingStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

export type BillingEvent = {
  id: string;
  type: string;
  lab_id: string | null;
  user_id: string | null;
  payload: Json;
  received_at: string;
}

/* AI Peer Review - see supabase/migrations/all.sql (peer review section). */

export type DocumentKind = "paper";

export type PeerReviewRow = {
  id: string;
  /** Nullable since the AI査読credit gate replaced the lab-Pro-plan gate: a review no longer has to belong to a laboratory or an experiment. */
  lab_id: string | null;
  experiment_id: string | null;
  document_kind: DocumentKind;
  title: string;
  source_filename: string | null;
  extracted_text: string;
  reviewer_results: Json;
  category_scores: Json;
  overall_score: number;
  previous_review_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/* Reviewer personas - see supabase/migrations/all.sql (reviewer profiles section). */

export type ReviewerProfileRole = "methods" | "novelty" | "structure";

export type ReviewerProfileRow = {
  role: ReviewerProfileRole;
  name: string;
  rubric_notes: string;
  updated_by: string | null;
  updated_at: string;
}

/* Plan prices - see the plan_prices section of supabase/migrations/all.sql. */

export type PlanPriceRow = {
  plan: BillingPlan;
  stripe_price_id: string | null;
  /** Cached from Stripe for display; Stripe remains the authority on charges. */
  amount_jpy: number | null;
  updated_by: string | null;
  updated_at: string;
}

/* AI Peer Review credits - see supabase/migrations/all.sql (peer review credits section). */

export type PeerReviewCreditsRow = {
  user_id: string;
  free_remaining: number;
  purchased_balance: number;
  used_count: number;
  total_purchased: number;
  updated_at: string;
}

export type PeerReviewCreditPackId = "single" | "thirty" | "monthly";

export type PeerReviewCreditPriceRow = {
  pack_id: PeerReviewCreditPackId;
  credits: number;
  amount_jpy: number;
  stripe_price_id: string | null;
  updated_by: string | null;
  updated_at: string;
}

/* Public contact form - see supabase/migrations/all.sql (contact messages section). */

export type ContactMessageRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  submitted_by: string | null;
  created_at: string;
}

/* Site news - see supabase/migrations/all.sql (site news section). */

export type SiteNewsRow = {
  id: string;
  slug: string | null;
  title: string;
  summary: string;
  body_md: string;
  is_published: boolean;
  published_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/* Administrator email broadcasts - see supabase/migrations/all.sql
   (administrator email broadcasts section). */

export type AdminEmailMessageRow = {
  id: string;
  subject: string;
  body: string;
  body_format: string;
  from_address: string;
  reply_to: string | null;
  audience: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  sent_by: string | null;
  created_at: string;
}

export type AdminEmailRecipientRow = {
  id: string;
  message_id: string;
  email: string;
  user_id: string | null;
  ok: boolean;
  error: string | null;
  created_at: string;
}

export type ChannelRow = {
  id: string;
  lab_id: string;
  name: string;
  topic: string | null;
  created_by: string | null;
  archived_at: string | null;
  is_private: boolean;
  created_at: string;
  updated_at: string;
}

export type ChannelMemberRow = {
  channel_id: string;
  user_id: string;
  added_by: string | null;
  added_at: string;
}

export type DmConversationRow = {
  id: string;
  lab_id: string;
  user_a: string;
  user_b: string;
  created_at: string;
}

export type MessageRow = {
  id: string;
  lab_id: string;
  channel_id: string | null;
  dm_conversation_id: string | null;
  sender_id: string | null;
  body: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export type ChatConversationReadRow = {
  id: string;
  lab_id: string;
  user_id: string;
  channel_id: string | null;
  dm_conversation_id: string | null;
  last_read_at: string;
  updated_at: string;
}

export type CallRow = {
  id: string;
  lab_id: string;
  channel_id: string | null;
  dm_conversation_id: string | null;
  kind: "audio" | "video";
  started_by: string | null;
  started_at: string;
  ended_at: string | null;
}

export type CallParticipantRow = {
  call_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
}

/**
 * Insert shapes: server-generated columns are optional, and so is any column
 * that is nullable in the database (a caller may simply omit it and let it
 * default to null) - mirroring actual Postgres insert semantics. `K` covers
 * the remaining case: non-null columns that still have a DB-side default
 * (e.g. `status default 'in_progress'`), which TS can't infer from the type
 * alone.
 */
type Generated = "id" | "created_at" | "updated_at";
type NullableKeys<T> = { [P in keyof T]: null extends T[P] ? P : never }[keyof T];
type Insert<T, K extends keyof T = never> =
  Omit<T, Extract<keyof T, Generated> | NullableKeys<T> | K> &
  Partial<Pick<T, Extract<keyof T, Generated>>> &
  Partial<Pick<T, NullableKeys<T>>> &
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
      lab_invites: TableDef<LabInvite, Insert<LabInvite, "role">>;
      projects: TableDef<Project>;
      experiments: TableDef<Experiment, Insert<Experiment, "status" | "tags" | "experiment_date">>;
      notebook_templates: TableDef<NotebookTemplateRow>;
      notebook_entries: TableDef<NotebookEntry>;
      raw_files: TableDef<RawFileRow, Insert<RawFileRow, "kind">>;
      sample_sheets: TableDef<SampleSheetRow>;
      rename_operations: TableDef<RenameOperation>;
      datasets: TableDef<Dataset>;
      analyses: TableDef<Analysis>;
      figures: TableDef<Figure>;
      audit_logs: TableDef<AuditLog, Omit<AuditLog, "id" | "created_at"> & { created_at?: string }>;
      voice_notes: TableDef<VoiceNote>;
      saved_papers: TableDef<SavedPaper>;
      reagents: TableDef<Reagent>;
      plan_limits: TableDef<PlanLimitRow, PlanLimitRow>;
      lab_subscriptions: TableDef<
        LabSubscription,
        Insert<LabSubscription, "plan" | "status" | "cancel_at_period_end">
      >;
      billing_events: TableDef<
        BillingEvent,
        Omit<BillingEvent, "received_at" | "lab_id" | "user_id" | "payload"> &
          Partial<Pick<BillingEvent, "received_at" | "lab_id" | "user_id" | "payload">>
      >;
      peer_reviews: TableDef<PeerReviewRow, Insert<PeerReviewRow, "document_kind">>;
      reviewer_profiles: TableDef<ReviewerProfileRow, Insert<ReviewerProfileRow, "rubric_notes">>;
      plan_prices: TableDef<PlanPriceRow, Insert<PlanPriceRow>>;
      peer_review_credits: TableDef<PeerReviewCreditsRow, Insert<PeerReviewCreditsRow>>;
      peer_review_credit_prices: TableDef<PeerReviewCreditPriceRow, Insert<PeerReviewCreditPriceRow>>;
      contact_messages: TableDef<ContactMessageRow, Insert<ContactMessageRow>>;
      channels: TableDef<ChannelRow, Insert<ChannelRow, "is_private">>;
      channel_members: TableDef<ChannelMemberRow, Insert<ChannelMemberRow, "added_at">>;
      dm_conversations: TableDef<DmConversationRow>;
      messages: TableDef<MessageRow>;
      chat_conversation_reads: TableDef<
        ChatConversationReadRow,
        Insert<ChatConversationReadRow, "last_read_at" | "updated_at">
      >;
      calls: TableDef<CallRow, Insert<CallRow, "started_at">>;
      call_participants: TableDef<CallParticipantRow, Insert<CallParticipantRow, "joined_at">>;
      site_news: TableDef<
        SiteNewsRow,
        Insert<SiteNewsRow, "summary" | "body_md" | "is_published" | "published_at">
      >;
      admin_email_messages: TableDef<
        AdminEmailMessageRow,
        Insert<
          AdminEmailMessageRow,
          | "body_format"
          | "from_address"
          | "audience"
          | "recipient_count"
          | "sent_count"
          | "failed_count"
        >
      >;
      admin_email_recipients: TableDef<
        AdminEmailRecipientRow,
        Insert<AdminEmailRecipientRow, "ok">
      >;
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
      lab_plan: { Args: { target_lab: string }; Returns: BillingPlan };
      lab_ai_enabled: { Args: { target_lab: string }; Returns: boolean };
      consume_peer_review_credit: { Args: Record<string, never>; Returns: boolean };
      grant_peer_review_credits: { Args: { target_user: string; amount: number }; Returns: undefined };
      admin_active_session_user_ids: { Args: Record<string, never>; Returns: string[] };
      ensure_personal_lab: {
        Args: { target_user: string; workspace_name: string };
        Returns: { lab_id: string; lab_name: string; created: boolean }[];
      };
    };
    Enums: {
      lab_role: LabRole;
      experiment_status: ExperimentStatus;
      analysis_kind: AnalysisKind;
      figure_kind: FigureKind;
      billing_plan: BillingPlan;
      billing_status: BillingStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
