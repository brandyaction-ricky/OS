"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/session-provider";
import { apiRequest, getDocument } from "@/lib/api-client";
import { applyKnowledgeCommand, createDemoKnowledge, visibleState } from "@/lib/knowledge/demo";
import { emptyKnowledgeState, type Command, type KnowledgeState, type WorkspaceSnapshot } from "@/lib/knowledge/model";
import type { KnowledgeActor } from "@/lib/knowledge/access";
import type { KnowledgeDocument } from "@/lib/types";

import { KnowledgeShortcuts } from "./shortcuts";

interface WorkspaceContext { state: KnowledgeState; actor: KnowledgeActor; loading: boolean; error: string; demo: boolean; token: string | null; refresh: () => Promise<void>; command: (command: Command) => Promise<{ id?: string }>; loadDocument: (id: string) => Promise<KnowledgeDocument>; notify: (message: string) => void }
const Context = createContext<WorkspaceContext | null>(null);
export function KnowledgeBoundary({children}:{children:ReactNode}) {
  const pathname=usePathname();
  const {profile,demo}=useSession();
  return pathname.startsWith("/knowledge/development") ? children : <KnowledgeProvider key={`${demo ? "demo" : "connected"}:${profile?.id ?? "signed-out"}`}>{children}</KnowledgeProvider>;
}
export function KnowledgeProvider({ children }: { children: ReactNode }) {
  const { profile, accessToken: token, demo, loading: sessionLoading } = useSession();
  const [state, setState] = useState<KnowledgeState>(emptyKnowledgeState);
  const [remoteActor, setRemoteActor] = useState<KnowledgeActor | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [toast, notify] = useState("");
  const actor = useMemo<KnowledgeActor>(() => remoteActor ?? ({ ownerId: profile?.id ?? "", type: "user", role: profile?.role ?? "member", memberKind: profile?.memberKind ?? "staff", active: profile?.isActive === true, allowedStatuses: ["draft", "team", "review", "reviewed", "canonical"], canApprove: demo && profile?.role === "admin" }), [remoteActor, profile, demo]);
  const storageKey = `brandyos:knowledge:v1:${actor.ownerId}`;
  const stateRef = useRef(state); stateRef.current = state;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (sessionLoading || !profile) return;
    const request = ++generation.current;
    try {
      if (demo) {
        const stored = localStorage.getItem(storageKey);
        let next = createDemoKnowledge(actor);
        if (stored) { try { const value = JSON.parse(stored); if (Object.entries(emptyKnowledgeState()).every(([key,initial]) => Array.isArray(initial) ? Array.isArray(value[key]) : value[key] && typeof value[key]==="object")) next = value; } catch { /* Invalid local demo data is never sent to a server. */ } }
        setState(next); stateRef.current = next;
      } else {
        const result = await apiRequest<WorkspaceSnapshot>("/api/v1/knowledge/workspace", { token });
        if (request !== generation.current) return;
        setRemoteActor(prior=>JSON.stringify(prior)===JSON.stringify(result.actor)?prior:result.actor);
        setState(current => ({ ...result.state, documents: result.state.documents.map(doc => { const cached = current.documents.find(row => row.id === doc.id && row.current_version === doc.current_version); return cached?.content_md ? { ...doc, content_md: cached.content_md } : doc; }) }));
      }
      setError("");
    } catch (e) { if (request === generation.current) { if (!demo) { setState(emptyKnowledgeState()); setRemoteActor(null); } setError(e instanceof Error ? e.message : "회사 문서를 불러오지 못했습니다."); } }
    finally { if (request === generation.current) setLoading(false); }
  }, [sessionLoading, profile, demo, storageKey, actor, token]);
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => { void refreshRef.current(); const requests=generation; return () => { requests.current++; }; }, [profile?.id, demo, sessionLoading]);
  useEffect(() => { const focus = () => { void refreshRef.current(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => notify(""), 5000); return () => clearTimeout(timer); }, [toast]);
  const command = useCallback((input: Command): Promise<{ id?: string }> => {
    const operation = async () => {
      if (demo) {
        const result = applyKnowledgeCommand(stateRef.current, actor, input);
        // A failed storage write must never be presented as a saved document.
        localStorage.setItem(storageKey, JSON.stringify(result.state));
        stateRef.current = result.state; setState(result.state); return { id: result.id };
      }
      const result = await apiRequest<{ id?: string }>("/api/v1/knowledge/workspace", { token, method: "POST", body: JSON.stringify(input) });
      await refreshRef.current(); return result;
    };
    const result = queue.current.then(operation, operation); queue.current = result.catch(() => undefined); return result;
  }, [actor, demo, storageKey, token]);
  const loadDocument = useCallback(async (id: string) => {
    if (demo) { const document = visibleState(stateRef.current, actor).documents.find(doc => doc.id === id); if (!document) throw new Error("이 문서를 볼 권한이 없습니다."); return document; }
    const { document } = await getDocument(token, id);
    setState(state => ({ ...state, documents: [document, ...state.documents.filter(doc => doc.id !== id)] })); return document;
  }, [demo, actor, token]);
  const visible = useMemo(() => demo ? visibleState(state, actor) : state, [demo, state, actor]);
  return <Context.Provider value={{ state: visible, actor, loading, error, demo, token, refresh, command, loadDocument, notify }}><div className="kw-root">{error && <div className="kw-alert" role="alert">{error}<button onClick={() => void refresh()}>다시 불러오기</button></div>}{children}<KnowledgeShortcuts/>{toast && <div className="kw-toast" role="status">{toast}<button aria-label="알림 닫기" onClick={() => notify("")}>×</button></div>}</div></Context.Provider>;
}
export function useKnowledge() { const value = useContext(Context); if (!value) throw new Error("KnowledgeProvider required"); return value; }
