"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { ReferenceCatalog } from "@/lib/image-creative/reference-canon";
import { useSession } from "./session-provider";

export function useImageReferenceCatalog(local: boolean, enabled = true) {
  const { demo, accessToken } = useSession();
  const offline = demo && !local;
  const path = offline ? "/api/v1/content/image-creatives/references/examples" :
    local && demo ? "/api/dev/image-ad-references" : "/api/v1/content/image-creatives/references";
  const key = JSON.stringify([path, accessToken]);
  const [last, setLast] = useState<{ key: string; catalog?: ReferenceCatalog; error?: string }>();
  const pending = useRef<{key: string; controller: AbortController; response: Promise<ReferenceCatalog>} | undefined>(undefined);
  const refresh = useCallback((): Promise<ReferenceCatalog> => {
    if (!demo && !accessToken) return Promise.reject(new Error("OS 로그인이 필요합니다."));
    if (pending.current?.key === key) return pending.current.response;
    const controller = new AbortController();
    const response = apiRequest<ReferenceCatalog>(path, {token: accessToken, signal: controller.signal}).then(result => {
      if (!Array.isArray(result?.entries)) throw new Error("포맷 창고 원문을 확인하지 못했습니다.");
      if (!controller.signal.aborted) setLast({key, catalog: result});
      return result;
    }).catch(error => {
      if (!controller.signal.aborted) setLast({key, error: "포맷 창고 원문을 확인하지 못했습니다."});
      throw error;
    }).finally(() => { if (pending.current?.controller === controller) pending.current = undefined; });
    pending.current = {key, controller, response};
    return response;
  }, [accessToken, demo, key, path]);

  const loaded = last?.key === key;
  useEffect(() => {
    let active = true;
    if (enabled && !loaded && (demo || accessToken)) queueMicrotask(() => {
      if (active) void refresh().catch(() => {});
    });
    return () => {
      active = false;
      pending.current?.controller.abort();
      pending.current = undefined;
    };
  }, [accessToken, demo, enabled, loaded, refresh]);
  return {catalog: last?.key === key ? last.catalog : undefined,
    error: last?.key === key ? last.error : undefined, offline, refresh};
}
