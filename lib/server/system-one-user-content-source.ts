import { authenticateRequest } from "@/lib/server/auth";
import { SYSTEM_ONE_CONTENT_FIELDS, type SystemOneContentDependencies } from "@/lib/server/system-one-content-source";
import { SYSTEM_ONE_PACKAGING_FIELDS, type SystemOnePackagingDependencies } from "@/lib/server/system-one-packaging-source";

export function createSystemOneUserPackagingSource(request: Request): SystemOnePackagingDependencies {
  return {
    async authenticate() {
      const actor = await authenticateRequest(request, { allowAgent: false, allowPasswordChangeRequired: false });
      if (actor.type !== "user" || actor.user?.id !== actor.id || actor.mustChangePassword) throw new Error("SYSTEM_ONE_USER_REQUIRED");
      return {
        principal: { id: actor.id, type: "user", active: true, mustChangePassword: false },
        async readPackages(sourceId) {
          const { data, error } = await actor.supabase.from("os_records").select(SYSTEM_ONE_PACKAGING_FIELDS)
            .eq("parent_id", sourceId).eq("record_type", "content_package").eq("owner_id", actor.id).is("archived_at", null)
            .order("id").limit(101).abortSignal(AbortSignal.timeout(10_000));
          if (error) throw new Error("SYSTEM_ONE_PACKAGING_READ_FAILED");
          return data;
        },
      };
    },
  };
}

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
