import { authenticateRequest } from "@/lib/server/auth";
import { SYSTEM_ONE_DOCUMENT_FIELDS, type SystemOneDocumentDependencies } from "@/lib/server/system-one-document-source";

// Deliberately not wired to a route or the local mock UI yet. DEV auth/RLS and
// policy-registry qualification must be verified before enabling connected use.
export function createSystemOneUserDocumentSource(request: Request): SystemOneDocumentDependencies {
  return {
    async authenticate() {
      // allowAgent=false rejects PATs before their service-role lookup/write.
      // Human authentication freshly checks Auth, active profile and password gate.
      const actor = await authenticateRequest(request, { allowAgent: false, allowPasswordChangeRequired: false });
      if (actor.type !== "user" || !actor.user || actor.user.id !== actor.id || actor.mustChangePassword) {
        throw new Error("SYSTEM_ONE_USER_REQUIRED");
      }
      return {
        principal: {
          type: "user", id: actor.id, role: actor.role, team: actor.team,
          active: true, mustChangePassword: false,
        },
        async readHeads(ids) {
          // Same user's JWT client, one SELECT for a consistent row-set snapshot.
          // No service client, historical fallback, writes, RPC, or model request.
          const { data, error } = await actor.supabase.from("os_documents")
            .select(SYSTEM_ONE_DOCUMENT_FIELDS).in("id", [...ids])
            .abortSignal(AbortSignal.timeout(10_000));
          if (error) throw new Error("SYSTEM_ONE_DOCUMENT_READ_FAILED");
          return data;
        },
      };
    },
  };
}
