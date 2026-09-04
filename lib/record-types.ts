export const RECORD_TYPES = [
  "project", "task", "goal", "kpi", "decision", "meeting", "ai_job",
  "development_log", "deployment",
  "content_topic", "content_script", "content_package", "content_short",
  "content_publish", "content_metric", "skill", "knowledge_link",
  "revenue", "funnel", "crm_action", "customer", "brand",
  "connection", "access_rule", "company_setting", "channel",
  "leave_balance", "leave_request", "expense", "contract", "subscription", "company_document",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];
export type RecordPriority = "low" | "normal" | "high" | "urgent";

export interface OsRecord {
  id: string;
  record_type: RecordType;
  title: string;
  description: string;
  status: string;
  priority: RecordPriority;
  stage: string;
  brand: string;
  team: string;
  owner_id: string | null;
  assignee_id: string | null;
  parent_id: string | null;
  due_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  progress: number;
  metric_target: number | null;
  metric_current: number | null;
  metric_unit: string;
  amount: number | null;
  currency: string;
  source_url: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface RecordEvent {
  id: number;
  record_id: string;
  actor_id: string | null;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  changed_fields: string[];
  note: string;
  created_at: string;
}
