"use client";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { OsRecord, RecordType } from "@/lib/record-types";
import { useSession } from "./session-provider";
/** Read one linked record through the same RLS API as its workspace list. */
export function useRecordDeepLink(key: string, type: RecordType, onOpen: (record: OsRecord) => void, onError: (message: string) => void) {
  const id = useSearchParams().get(key);
  const { accessToken, demo } = useSession();
  const callbacks = useRef({onOpen,onError}); callbacks.current={onOpen,onError};
  useEffect(() => {
    if (!id || !accessToken || demo) return;
    const controller = new AbortController();
    void (async()=>{
      try {
        const response = await fetch(`/api/v1/records?type=${type}&id=${encodeURIComponent(id)}&limit=1`,{headers:{Authorization:`Bearer ${accessToken}`},signal:controller.signal,cache:"no-store"});
        const result = await response.json();
        const record = result.records?.[0];
        if (!response.ok || !record || record.metadata?.kind === "development_request") throw new Error("연결된 항목이 없거나 접근할 수 없습니다.");
        if (!controller.signal.aborted) callbacks.current.onOpen(record);
      } catch { if (!controller.signal.aborted) callbacks.current.onError("연결된 항목이 없거나 접근할 수 없습니다."); }
    })();
    return ()=>controller.abort();
  },[id,type,accessToken,demo]);
}
