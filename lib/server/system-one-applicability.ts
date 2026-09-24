import { z } from "zod";

// Internal proposal evaluator only. No route consumes this yet. Callers must
// independently authenticate, read current OS sources and qualify the declared
// rules/evidence. Valid JSON, a matching hash or canonical status is not approval.
const key = z.string().regex(/^[a-z][a-z0-9_.-]*$/).max(100);
const snapshot = z.object({
  id: z.string().uuid(), version: z.number().int().positive().max(2_147_483_647),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const condition = z.object({ fact: key, equals: z.boolean() }).strict();
const rule = z.object({
  key, source: snapshot, section: z.string().trim().min(1).max(500),
  requirement: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("required") }).strict(),
    z.object({ kind: z.literal("conditional"), when: condition }).strict(),
  ]),
}).strict();
const inputSchema = z.object({
  contractVersion: z.literal("scope-proposal-v1"),
  context: z.object({
    brand: key, stage: key, source: snapshot,
    facts: z.array(z.object({
      key, value: z.boolean().nullable(),
      // A pointer, not proof: the future trusted interpreter must verify it.
      evidenceSection: z.string().trim().min(1).max(500).nullable(),
    }).strict()).max(30),
  }).strict(),
  plan: z.object({ brand: key, stage: key, registry: snapshot, rules: z.array(rule).min(1).max(30) }).strict(),
  current: z.object({ source: snapshot, registry: snapshot, documents: z.array(snapshot).min(1).max(30) }).strict(),
}).strict().superRefine((input, ctx) => {
  for (const [name, values] of [
    ["facts", input.context.facts.map((fact) => fact.key)],
    ["rules", input.plan.rules.map((item) => item.key)],
    ["documents", input.current.documents.map((item) => item.id.toLowerCase())],
  ] as const) {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", message: `duplicate ${name}` });
  }
  for (const fact of input.context.facts) {
    if (fact.value !== null && !fact.evidenceSection) ctx.addIssue({ code: "custom", message: "missing fact evidence" });
  }
});
type Snapshot = z.infer<typeof snapshot>;
const same = (a: Snapshot, b: Snapshot) => a.id.toLowerCase() === b.id.toLowerCase()
  && a.version === b.version && a.fingerprint === b.fingerprint;
type Item = Readonly<{ key: string; applicability: "applies" | "not_applicable" | "unknown";
  reason: "required" | "condition_met" | "condition_not_met" | "context_missing" }>;
type Code = "invalid_input" | "unsupported_context" | "stale" | "reference_missing";
const stop = (code: Code) => ({ status: "stopped" as const, code, judgment: null, executionAllowed: false as const });

export function proposeSystemOneApplicability(value: unknown) {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) return stop("invalid_input");
  const { context, plan, current } = parsed.data;
  if (context.brand !== plan.brand || context.stage !== plan.stage) return stop("unsupported_context");
  if (!same(context.source, current.source) || !same(plan.registry, current.registry)) return stop("stale");
  // Validate every referenced source before evaluating conditions; an excluded
  // rule cannot conceal a stale or missing policy source.
  for (const item of plan.rules) {
    const document = current.documents.find((doc) => doc.id.toLowerCase() === item.source.id.toLowerCase());
    if (!document) return stop("reference_missing");
    if (!same(item.source, document)) return stop("stale");
  }
  const items: readonly Item[] = Object.freeze(plan.rules.map((item): Item => {
    if (item.requirement.kind === "required") return Object.freeze({ key: item.key, applicability: "applies", reason: "required" });
    const when = item.requirement.when;
    const fact = context.facts.find((candidate) => candidate.key === when.fact);
    if (!fact || fact.value === null) return Object.freeze({ key: item.key, applicability: "unknown", reason: "context_missing" });
    return Object.freeze(fact.value === when.equals
      ? { key: item.key, applicability: "applies", reason: "condition_met" }
      : { key: item.key, applicability: "not_applicable", reason: "condition_not_met" });
  }));
  // Even all-excluded / all-known proposals are not a pass or execution grant.
  // Partial draft approval, semantic interpretation and exceptions are not
  // inferred here; a subsequent trusted qualification layer is still required.
  return Object.freeze({ status: "proposal" as const, contractVersion: "scope-proposal-v1" as const,
    needsContext: items.some((item) => item.applicability === "unknown"),
    policyStatus: "unverified" as const, judgment: null, executionAllowed: false as const, items });
}
