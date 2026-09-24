import { z } from "zod";
import { loadSystemOneRegistryHead, recheckSystemOneDocumentBundle, type SystemOneDocumentDependencies } from "@/lib/server/system-one-document-source";

// Reuses the generic single-head reader behind registry bootstrap, without
// treating a production document as a registry or requiring canonical status.
export async function readProductionDocument(input: unknown, deps: SystemOneDocumentDependencies) {
  const parsed = z.string().uuid().transform(v => v.toLowerCase()).safeParse(input);
  if (!parsed.success) return { status: "stopped", code: "invalid_input" } as const;
  let raw: unknown, principalId: string;
  try {
    const session = await deps.authenticate();
    principalId = z.object({ id: z.string().uuid() }).parse(session.principal).id;
    raw = await session.readHeads([parsed.data]);
  } catch { return { status: "stopped", code: "read_failed" } as const; }
  const heads = z.array(z.object({ id: z.string().uuid(), current_version: z.number().int().positive().max(2_147_483_647) })).length(1).safeParse(raw);
  if (!heads.success || heads.data[0].id !== parsed.data) return { status: "stopped", code: "unavailable" } as const;
  const loaded = await loadSystemOneRegistryHead({ id: parsed.data, expectedVersion: heads.data[0].current_version }, deps);
  if (loaded.status === "stopped") return loaded;
  if (loaded.bundle.principal.id !== principalId) return { status: "stopped", code: "unavailable" } as const;
  const checked = await recheckSystemOneDocumentBundle(loaded.bundle, deps);
  if (checked.status === "stopped") return checked;
  const document = checked.bundle.source;
  return { status: "ready", document: { id: document.id, title: document.title, version: document.current_version, status: document.status },
    policyStatus: "unverified", judgment: null, executionAllowed: false } as const;
}
