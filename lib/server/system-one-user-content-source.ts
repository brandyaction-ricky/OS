import { authenticateRequest } from "@/lib/server/auth";
import { SYSTEM_ONE_CONTENT_FIELDS, type SystemOneContentDependencies } from "@/lib/server/system-one-content-source";

// Internal adapter only. A future endpoint must use the DEV preflight gate.
export function createSystemOneUserContentSource(request: Request): SystemOneContentDependencies {
  return {
    async authenticate() {
      const actor = await authenticateRequest(request, { allowAgent: false, allowPasswordChangeRequired: false });
      if (actor.type !== "user" || actor.user?.id !== actor.id || actor.mustChangePassword) throw new Error("SYSTEM_ONE_USER_REQUIRED");
      return {
        principal: { id: actor.id, type: "user", active: true, mustChangePassword: false },
        async readHead(id) {
          const { data, error } = await actor.supabase.from("os_records").select(SYSTEM_ONE_CONTENT_FIELDS)
            .eq("id", id).eq("record_type", "content_topic").eq("owner_id", actor.id).is("archived_at", null)
            .abortSignal(AbortSignal.timeout(10_000)).maybeSingle();
          if (error) throw new Error("SYSTEM_ONE_CONTENT_READ_FAILED");
          return data;
        },
      };
    },
  };
}
