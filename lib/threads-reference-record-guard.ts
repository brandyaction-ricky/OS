import { THREADS_REFERENCE_KIND, THREADS_REFERENCE_WORKFLOW } from "./threads-reference";

// Generic record writes replace metadata. Keep reference evidence and its
// workflow markers behind the dedicated collection and topic APIs.
export function protectedThreadsReferenceTopic(recordType: string, metadata: Record<string, unknown> = {}) {
  return recordType === "content_topic" && metadata.space === "personal"
    && (metadata.kind === THREADS_REFERENCE_KIND || metadata.editorial_workflow === THREADS_REFERENCE_WORKFLOW
      || Object.hasOwn(metadata, "reference_items"));
}
