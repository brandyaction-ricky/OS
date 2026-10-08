"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { apiRequest } from "@/lib/api-client";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { canAccessHr } from "@/lib/hr/access";
import { emptyHrData, type HrData } from "@/lib/hr/types";
import { hrBadges, todayKst } from "@/lib/hr/domain";
import { useSession } from "../session-provider";
interface HrContextValue {
  data: HrData;
  today: string;
  loading: boolean;
  error: string;
  demo: boolean;
  allowed: boolean;
  admin: boolean;
  actorId: string;
  refresh: () => Promise<void>;
  save: <T = unknown>(
    action: string,
    body: Record<string, unknown>,
    method?: string,
  ) => Promise<T>;
  read: <T>(action: string) => Promise<T>;
  upload: (file: File, purpose: string, employee?: string) => Promise<string>;
  openFile: (path: string) => Promise<void>;
  toast: (message: string) => void;
}
const HrContext = createContext<HrContextValue | null>(null);
export function HrProvider({ children }: { children: React.ReactNode }) {
  const session = useSession(),
    allowed = canAccessHr(session.profile),
    admin = session.profile?.role === "admin";
  const [data, setData] = useState<HrData>(emptyHrData),
    [today, setToday] = useState(todayKst),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const current = useRef(data),
    token = useRef(session.accessToken),
    generation = useRef(0),
    files = useRef(new Map<string, string>()),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  current.current = data;
  token.current = session.accessToken;
  const toast = useCallback((message: string) => {
    setNotice(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(""), 2500);
  }, []);
  const refresh = useCallback(async () => {
    if (session.loading) return;
    const own = ++generation.current;
    setLoading(true);
    setError("");
    try {
      if (session.demo) {
        const { hrDemo, DEMO_TODAY } = await import("@/lib/hr/demo");
        if (own !== generation.current) return;
        if (!current.current.profiles.length) setData(hrDemo());
        setToday(DEMO_TODAY);
      } else {
        const result = await apiRequest<{ data: HrData; today: string }>(
          `/api/v1/hr/${allowed ? "workspace" : "me/leave"}`,
          { token: token.current },
        );
        if (own !== generation.current) return;
        setData(result.data);
        setToday(result.today);
      }
    } catch (e) {
      if (own === generation.current)
        setError(
          e instanceof Error ? e.message : "인사 자료를 불러오지 못했습니다.",
        );
    } finally {
      if (own === generation.current) setLoading(false);
    }
  }, [session.loading, session.demo, allowed]);
  useEffect(() => {
    setData(emptyHrData());
    current.current = emptyHrData();
    void refresh();
    const requestGeneration = generation.current;
    return () => {
      generation.current = requestGeneration + 1;
    };
  }, [refresh, session.profile?.id]);
  useEffect(() => {
    const map = files.current;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      for (const url of map.values()) URL.revokeObjectURL(url);
    };
  }, []);
  async function save<T>(
    action: string,
    body: Record<string, unknown>,
    method = "POST",
  ): Promise<T> {
    if (session.demo) {
      const { demoCommand } = await import("@/lib/hr/demo-commands");
      const result = demoCommand(current.current, action, body, method, today);
      current.current = result.data;
      setData(result.data);
      return result.result as T;
    }
    const result = await apiRequest<T>(`/api/v1/hr/${action}`, {
      method,
      token: token.current,
      body: method === "DELETE" ? undefined : JSON.stringify(body),
    });
    await refresh();
    window.dispatchEvent(new Event("hr-data-changed"));
    return result;
  }
  useEffect(() => {
    if (session.demo && data.profiles.length) {
      window.dispatchEvent(
        new CustomEvent("hr-demo-badges", { detail: hrBadges(data, today) }),
      );
    }
  }, [session.demo, data, today]);
  async function read<T>(action: string): Promise<T> {
    if (session.demo) {
      if (action.startsWith("forms/history?")) {
        const id = new URLSearchParams(action.split("?")[1]).get("form");
        return {
          rows: current.current.events.filter(
            (x) => x.action === "form.updated" && x.detail.form === id,
          ),
        } as T;
      }
      if (action.includes("/history")) {
        const id = action.split("/")[1],
          e = current.current.employees.find(
            (e) => e.id === id || e.profile_id === id,
          );
        return {
          rows: current.current.events.filter(
            (x) => x.hr_employee_id === e?.id || x.profile_id === id,
          ),
        } as T;
      }
      return { rows: [] } as T;
    }
    return apiRequest<T>(`/api/v1/hr/${action}`, { token: token.current });
  }
  async function upload(file: File, purpose: string, employee?: string) {
    if (file.size > 10485760)
      throw new Error("파일은 10MB까지 올릴 수 있습니다.");
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type))
      throw new Error("PDF, JPG, PNG 파일만 올릴 수 있습니다.");
    if (session.demo) {
      const path = `${purpose}/${employee || "form"}/${crypto.randomUUID()}.${file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg"}`;
      files.current.set(path, URL.createObjectURL(file));
      return path;
    }
    const result = await apiRequest<{
      path: string;
      token: string;
      mime: string;
    }>("/api/v1/hr/files/upload-url", {
      method: "POST",
      token: token.current,
      body: JSON.stringify({
        purpose,
        employee: employee || null,
        size: file.size,
        mime: file.type,
      }),
    });
    const client = getBrowserSupabase();
    if (!client) throw new Error("첨부 저장소에 연결하지 못했습니다.");
    const { error } = await client.storage
      .from("hr-documents")
      .uploadToSignedUrl(result.path, result.token, file, {
        contentType: result.mime,
        upsert: false,
      });
    if (error) throw new Error("파일을 올리지 못했습니다. 다시 시도해 주세요.");
    return result.path;
  }
  async function openFile(path: string) {
    let url: string;
    if (session.demo) {
      url = files.current.get(path) || "";
      if (!url) {
        toast("체험 자료에는 실제 첨부 파일이 없습니다.");
        return;
      }
    } else {
      url = (await read<{ url: string }>(`files/${path}`)).url;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }
  return (
    <HrContext.Provider
      value={{
        data,
        today,
        loading,
        error,
        demo: session.demo,
        allowed,
        admin,
        actorId: session.profile?.id || "",
        refresh,
        save,
        read,
        upload,
        openFile,
        toast,
      }}
    >
      {children}
      {notice ? (
        <div className="hr-toast" role="status">
          {notice}
        </div>
      ) : null}
    </HrContext.Provider>
  );
}
export function useHr() {
  const value = useContext(HrContext);
  if (!value) throw new Error("HR context missing");
  return value;
}
