import type { DocumentStatus } from "./types";
export type AgentKeyAccess = "read" | "draft" | "write";
export function agentKeyPolicy(access: AgentKeyAccess) {
  return { scopes: access === "read" ? ["knowledge.read", "records.read"] : ["knowledge.read", "knowledge.write", "records.read", "records.write"],
    allowedStatuses: (access === "read" ? ["team", "canonical"] : access === "draft" ? ["draft", "team", "review", "reviewed"] : ["draft", "team", "review", "reviewed", "canonical"]) as DocumentStatus[] };
}
export function agentKeyAccessLabel(key: { scopes: string[]; allowed_statuses: string[]; enforce_write_statuses?: boolean }) {
  return !key.scopes.includes("knowledge.write") ? "읽기" : key.enforce_write_statuses === false ? "읽기·쓰기 (기존)" : key.allowed_statuses.includes("canonical") ? "정본 쓰기" : "초안 쓰기";
}
export function defaultAgentExpiry(now = new Date()) { return new Date(now.getTime() + 90 * 86_400_000).toISOString().slice(0, 10); }

export function isMissingAgentWritePolicy(error: { code?: string; message?: string } | null) {
  return Boolean(error && ["42703", "PGRST204"].includes(error.code ?? "") && error.message?.includes("enforce_write_statuses"));
}
