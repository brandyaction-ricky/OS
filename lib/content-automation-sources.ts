import type { OsRecord } from "./record-types";

// A linked planning topic is readable before the user starts its pipeline.
// This is a view filter, never a metadata mutation or an approval.
export function automationSourcesFor(topics: OsRecord[], linkedSourceId: string | null) {
  return topics.filter(record => record.record_type === "content_topic" && !record.archived_at &&
    (record.id === linkedSourceId || record.metadata.automationSource === true || record.metadata.pipelineEnabled === true));
}

export function selectedAutomationSource(sources: OsRecord[], selectedId: string) {
  return selectedId ? sources.find(source => source.id === selectedId) ?? null : sources[0] ?? null;
}
