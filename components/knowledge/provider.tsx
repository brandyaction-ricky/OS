"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/session-provider";
import { apiRequest, getDocument, recentRead } from "@/lib/api-client";
import { applyKnowledgeCommand, createDemoKnowledge, visibleState } from "@/lib/knowledge/demo";
import { emptyKnowledgeState, kstDay, type Command, type KnowledgeState, type Meeting, type WorkspaceSnapshot } from "@/lib/knowledge/model";
import type { KnowledgeActor } from "@/lib/knowledge/access";
import type { KnowledgeDocument } from "@/lib/types";
import type { CanonListSnapshot } from "@/lib/knowledge/canon-list";

import { KnowledgeShortcuts } from "./shortcuts";

type ReadScope = "canon" | "meetings" | "workspace";
interface WorkspaceContext { state: KnowledgeState; canonList: CanonListSnapshot | null; actor: KnowledgeActor; loading: boolean; workspaceReady: boolean; draftsReady: boolean; error: string; demo: boolean; token: string | null; refresh: () => Promise<void>; ensureWorkspace: () => Promise<void>; command: (command: Command, options?: { fastCreate?: boolean }) => Promise<{ id?: string }>; loadDocument: (id: string) => Promise<KnowledgeDocument>; notify: (message: string) => void }
const Context = createContext<WorkspaceContext | null>(null);
export function KnowledgeBoundary({children}:{children:ReactNode}) {
  const pathname=usePathname();
  const {profile,demo}=useSession();
  return pathname.startsWith("/knowledge/development") || pathname === "/knowledge/vault" ? children : <KnowledgeProvider key={`${demo ? "demo" : "connected"}:${profile?.id ?? "signed-out"}`}>{children}</KnowledgeProvider>;
}
export function KnowledgeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile, accessToken: token, demo, loading: sessionLoading } = useSession();
  const scope: ReadScope = pathname === "/knowledge/canon" ? "canon" : pathname === "/knowledge/meetings" ? "meetings" : "workspace";
  const [state, setState] = useState<KnowledgeState>(emptyKnowledgeState);
  const [canonList, setCanonList] = useState<CanonListSnapshot | null>(null);
  const [remoteActor, setRemoteActor] = useState<KnowledgeActor | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false), [partialMeetingId, setPartialMeetingId] = useState("");
  // Lists may render from a remembered snapshot; editors wait for the fresh one.
  const [workspaceFresh, setWorkspaceFresh] = useState(false);
  const [error, setError] = useState(""), [toast, notify] = useState("");
  const workspaceReadyRef = useRef(false);
  const actor = useMemo<KnowledgeActor>(() => remoteActor ?? ({ ownerId: profile?.id ?? "", type: "user", role: profile?.role ?? "member", memberKind: profile?.memberKind ?? "staff", active: profile?.isActive === true, allowedStatuses: ["draft", "team", "review", "reviewed", "canonical"], canApprove: demo && profile?.role === "admin" }), [remoteActor, profile, demo]);
  const storageKey = `brandyos:knowledge:v1:${actor.ownerId}`;
  const stateRef = useRef(state); stateRef.current = state;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef({ canon: 0, workspace: 0 });
  const routeEpoch = useRef(0);
  const initialMeetingRead = useRef(false);
  const refresh = useCallback(async (requestedScope: ReadScope = scope) => {
    if (sessionLoading || !profile) return;
    // The meeting list owns its lightweight read. Its supporting workspace is
    // requested only by a detail route, creation dialog or global shortcut.
    if (!demo && requestedScope === "meetings") return;
    const requestScope = requestedScope === "canon" ? "canon" : "workspace";
    const request = ++generation.current[requestScope], epoch = routeEpoch.current;
    const isCurrent = () => request === generation.current[requestScope] && epoch === routeEpoch.current;
    try {
      if (demo) {
        const stored = localStorage.getItem(storageKey);
        let next = createDemoKnowledge(actor);
        if (stored) { try { const value = JSON.parse(stored); if (Object.entries(emptyKnowledgeState()).every(([key,initial]) => Array.isArray(initial) ? Array.isArray(value[key]) : value[key] && typeof value[key]==="object")) next = value; } catch { /* Invalid local demo data is never sent to a server. */ } }
        setState(next); stateRef.current = next;
        workspaceReadyRef.current = true; setWorkspaceReady(true); setWorkspaceFresh(true);
      } else if (requestedScope === "canon") {
        const applyCanon = (result: CanonListSnapshot) => {
          setCanonList(result);
          setRemoteActor(prior => JSON.stringify(prior) === JSON.stringify(result.actor) ? prior : result.actor);
        };
        // A revisit shows this tab's last list at once; the fresh read below replaces it.
        const recent = recentRead<CanonListSnapshot>("/api/v1/knowledge/canon", token);
        if (recent) applyCanon(recent);
        const result = await apiRequest<CanonListSnapshot>("/api/v1/knowledge/canon", { token });
        if (!isCurrent()) return;
        applyCanon(result);
      } else {
        const applyWorkspace = (result: WorkspaceSnapshot) => {
          setRemoteActor(prior=>JSON.stringify(prior)===JSON.stringify(result.actor)?prior:result.actor);
          setState(current => {
            const cachedDocuments = new Map(current.documents.map(doc => [doc.id, doc]));
            return { ...result.state, documents: result.state.documents.map(doc => {
              const cached = cachedDocuments.get(doc.id);
              return cached?.current_version === doc.current_version && cached.content_md ? { ...doc, content_md: cached.content_md } : doc;
            }) };
          });
          workspaceReadyRef.current = true; setWorkspaceReady(true);
          setCanonList(null);
        };
        // Drafts in a remembered snapshot are this tab's own: any save clears the memory.
        const recent = workspaceReadyRef.current ? undefined : recentRead<WorkspaceSnapshot>("/api/v1/knowledge/workspace", token);
        if (recent) applyWorkspace(recent);
        const meetingId = /^\/knowledge\/meetings\/([0-9a-f-]{36})$/i.exec(pathname)?.[1];
        if (meetingId && !initialMeetingRead.current && !stateRef.current.meetings.some(row => row.id === meetingId)) {
          try {
            const detail = await apiRequest<{meeting: Meeting; people: KnowledgeState["people"]; actor: KnowledgeActor}>(`/api/v1/knowledge/meetings/${meetingId}`, { token });
            if (!isCurrent()) return;
            initialMeetingRead.current = true;
            setRemoteActor(detail.actor);
            setState(current => ({ ...current, meetings: [detail.meeting, ...current.meetings.filter(row => row.id !== meetingId)], people: detail.people }));
            setPartialMeetingId(meetingId);
          } catch { /* The full workspace read below remains the fallback for old or inaccessible meetings. */ }
        }
        const result = await apiRequest<WorkspaceSnapshot>("/api/v1/knowledge/workspace", { token });
        if (!isCurrent()) return;
        applyWorkspace(result); setWorkspaceFresh(true);
      }
      setError("");
    } catch (e) { if (isCurrent()) { if (!demo) { setState(emptyKnowledgeState()); setRemoteActor(null); setCanonList(null); workspaceReadyRef.current = false; setWorkspaceReady(false); setWorkspaceFresh(false); setPartialMeetingId(""); } setError(e instanceof Error ? e.message : "회사 문서를 불러오지 못했습니다."); } }
  }, [sessionLoading, profile, demo, storageKey, actor, token, pathname, scope]);
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => { void refreshRef.current(); const epoch=routeEpoch; return () => { epoch.current++; }; }, [profile?.id, demo, sessionLoading, scope]);
  const ensureWorkspace = useCallback(async () => {
    if (!workspaceReadyRef.current) await refreshRef.current("workspace");
  }, []);
  useEffect(() => { const focus = () => { void refreshRef.current(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => notify(""), 5000); return () => clearTimeout(timer); }, [toast]);
  const command = useCallback((input: Command, options?: { fastCreate?: boolean }): Promise<{ id?: string }> => {
    const operation = async () => {
      if (demo) {
        const result = applyKnowledgeCommand(stateRef.current, actor, input);
        // A failed storage write must never be presented as a saved document.
        localStorage.setItem(storageKey, JSON.stringify(result.state));
        stateRef.current = result.state; setState(result.state); return { id: result.id };
      }
      const result = await apiRequest<{ id?: string }>("/api/v1/knowledge/workspace", { token, method: "POST", body: JSON.stringify(input) });
      if (input.action === "meeting.save" && input.id) {
        const detail = await apiRequest<{ meeting: Meeting; people: KnowledgeState["people"]; actor: KnowledgeActor }>(`/api/v1/knowledge/meetings/${input.id}`, { token });
        const next = { ...stateRef.current,
          meetings: [detail.meeting, ...stateRef.current.meetings.filter(row => row.id !== detail.meeting.id)],
          people: [...detail.people, ...stateRef.current.people.filter(row => !detail.people.some(person => person.id === row.id))],
        };
        stateRef.current = next; setState(next); setRemoteActor(detail.actor);
        return result;
      }
      if (options?.fastCreate && result.id && (input.action === "meeting.create" || input.action === "document.create")) {
        if (input.action === "meeting.create") {
          const now = new Date().toISOString();
          const meeting: Meeting = {
            id: result.id, title: String(input.title || "").trim() || `회의 — ${kstDay(new Date(now))}`,
            description: "", status: "planned", version: 1, owner_id: actor.ownerId, created_by: actor.ownerId,
            created_at: now, updated_at: now, starts_at: null, attendees: [actor.ownerId],
            metadata: { workspace: "knowledge", visibility: actor.memberKind === "partner" || input.visibility === "attendees" ? "attendees" : "team", agenda: "", items: [] },
          };
          const next = { ...stateRef.current, meetings: [meeting, ...stateRef.current.meetings.filter(row => row.id !== meeting.id)] };
          stateRef.current = next;
          setState(next);
        }
        // The destination can render immediately; reconcile the full list without blocking navigation.
        void refreshRef.current("workspace");
        return result;
      }
      await refreshRef.current("workspace"); return result;
    };
    const result = queue.current.then(operation, operation); queue.current = result.catch(() => undefined); return result;
  }, [actor, demo, storageKey, token]);
  const loadDocument = useCallback(async (id: string) => {
    if (demo) { const document = visibleState(stateRef.current, actor).documents.find(doc => doc.id === id); if (!document) throw new Error("이 문서를 볼 권한이 없습니다."); return document; }
    const { document } = await getDocument(token, id);
    setState(state => ({ ...state, documents: [document, ...state.documents.filter(doc => doc.id !== id)] })); return document;
  }, [demo, actor, token]);
  const visible = useMemo(() => demo ? visibleState(state, actor) : state, [demo, state, actor]);
  const scopeReady = workspaceReady || (!demo && scope === "meetings") || (scope === "canon" && canonList !== null) || (Boolean(partialMeetingId) && pathname === `/knowledge/meetings/${partialMeetingId}`);
  const loading = sessionLoading || (!scopeReady && !error);
  return <Context.Provider value={{ state: visible, canonList, actor, loading, workspaceReady, draftsReady: workspaceFresh, error, demo, token, refresh, ensureWorkspace, command, loadDocument, notify }}><div className="kw-root">{error && <div className="kw-alert" role="alert">{error}<button onClick={() => void refresh()}>다시 불러오기</button></div>}{children}<KnowledgeShortcuts/>{toast && <div className="kw-toast" role="status">{toast}<button aria-label="알림 닫기" onClick={() => notify("")}>×</button></div>}</div></Context.Provider>;
}
export function useKnowledge() { const value = useContext(Context); if (!value) throw new Error("KnowledgeProvider required"); return value; }
