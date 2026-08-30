"use client";

import {
  Archive,
  Bold,
  BookCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock3,
  Eye,
  File,
  FilePenLine,
  FilePlus2,
  Folder,
  FolderOpen,
  Hash,
  Link2,
  List,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Quote,
  RotateCcw,
  Save,
  Send,
  ShieldAlert,
  Table2,
  Tag,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { changeDocumentStatus, createDocument, getDocument, listDocuments, listDocumentVersions, listMembers, restoreDocumentVersion, updateDocument, type OsMember } from "@/lib/api-client";
import { KNOWLEDGE_CATEGORIES } from "@/lib/company-settings";
import { DEMO_DOCUMENTS } from "@/lib/demo-data";
import type { DocumentStatus, DocumentVersion, KnowledgeDocument } from "@/lib/types";
import { statusLabel } from "./dashboard";
import { useSession } from "./session-provider";

const STATUS_FLOW: DocumentStatus[] = ["draft", "team", "canonical"];

const OWNER_FILTERS = [
  { id: "mine_company", label: "내 문서 + 회사 정본" },
  { id: "mine", label: "내 문서" },
  { id: "canonical", label: "회사 정본" },
  { id: "team", label: "팀 공유" },
  { id: "all", label: "전체" },
  { id: "review", label: "검토" },
  { id: "archived", label: "휴지통" },
];

interface FolderTreeNode { name: string; path: string; count: number; children: FolderTreeNode[]; documents: KnowledgeDocument[] }
type TreeRow = { type: "folder"; folder: FolderTreeNode; depth: number } | { type: "document"; document: KnowledgeDocument; depth: number };

function documentFolder(document: KnowledgeDocument) {
  if (document.folder) return document.folder;
  const sourcePath = document.source_ref?.replace(/\\/g, "/");
  if (sourcePath?.includes("/")) return sourcePath.slice(0, sourcePath.lastIndexOf("/"));
  return "분류 없음";
}

function buildFolderTree(documents: KnowledgeDocument[], sortAscending: boolean) {
  const roots: FolderTreeNode[] = [];
  for (const document of documents) {
    const parts = documentFolder(document).split("/").filter(Boolean);
    let level = roots; let path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let node = level.find((item) => item.name === part);
      if (!node) { node = { name: part, path, count: 0, children: [], documents: [] }; level.push(node); }
      node.count += 1; level = node.children;
    }
    const folder = parts.reduce<FolderTreeNode | undefined>((current, part) => (current?.children ?? roots).find((item) => item.name === part), undefined);
    folder?.documents.push(document);
  }
  const sort = (nodes: FolderTreeNode[]) => nodes.sort((a, b) => a.name.localeCompare(b.name, "ko")).forEach((node) => {
    node.documents.sort((a, b) => sortAscending ? a.updated_at.localeCompare(b.updated_at) : b.updated_at.localeCompare(a.updated_at));
    sort(node.children);
  });
  sort(roots); return roots;
}

function wikiLinks(content: string) {
  return [...new Set([...content.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]+)?\]\]/g)].map((match) => match[1].trim()).filter(Boolean))];
}

interface ReadingContent { body: string; metadata: Array<{ label: string; value: string }> }

function prepareReadingContent(content: string): ReadingContent {
  const body: string[] = [];
  const metadata = new Map<string, string[]>();
  let metadataSection: string | null = null;
  const metaHeading = /^#{1,6}\s*(날짜|주제|위계|출처(?:\([^)]*\))?|연결문서|메모)\s*(?::|：)?\s*(.*)$/;

  for (const line of content.split("\n")) {
    const heading = line.match(metaHeading);
    if (heading) {
      const rawLabel = heading[1];
      const label = rawLabel.startsWith("출처") ? "출처" : rawLabel;
      if (label === "메모") { metadataSection = null; continue; }
      metadataSection = label;
      const inline = heading[2].trim();
      if (inline) metadata.set(label, [...(metadata.get(label) ?? []), inline]);
      continue;
    }
    if (metadataSection && /^#{1,6}\s+/.test(line)) metadataSection = null;
    if (metadataSection) {
      const value = line.trim().replace(/^[-*]\s+/, "");
      if (value && !/^[-*_]{3,}$/.test(value)) metadata.set(metadataSection, [...(metadata.get(metadataSection) ?? []), value]);
      continue;
    }
    if (/^\s*[-*_]{3,}\s*$/.test(line)) continue;
    body.push(line);
  }

  return {
    body: body.join("\n").replace(/^\s+|\s+$/g, ""),
    metadata: [...metadata.entries()].map(([label, values]) => ({ label, value: values.join(" · ") })).filter((item) => item.value),
  };
}

function WikiInline({ text, onOpenLink }: { text: string; onOpenLink: (title: string) => void }) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return <>{parts.map((part, index) => {
    const match = part.match(/^\[\[([^\]|#]+)(?:[#|]([^\]]+))?\]\]$/);
    if (!match) return <span key={index}>{part}</span>;
    const title = match[1].trim();
    return <button className="wiki-link" type="button" key={index} onClick={() => onOpenLink(title)}>{match[2]?.trim() || title}</button>;
  })}</>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function nextStatus(status: DocumentStatus): DocumentStatus | null {
  const index = STATUS_FLOW.indexOf(status);
  return index >= 0 && index < STATUS_FLOW.length - 1 ? STATUS_FLOW[index + 1] : null;
}

function statusActionLabel(status: DocumentStatus) {
  return ({ draft: "팀에 공유", team: "", review: "", reviewed: "", canonical: "", archived: "" })[status];
}

function MarkdownView({ content, onOpenLink }: { content: string; onOpenLink: (title: string) => void }) {
  const blocks = content.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="markdown-view">
      {blocks.map((block, index) => {
        const heading = block.match(/^(#{1,4})\s+(.+)/);
        if (heading) {
          const level = heading[1].length;
          const text = heading[2].split("\n")[0];
          const rest = block.split("\n").slice(1).join("\n");
          return (
            <div key={index}>
              {level === 1 ? <h1><WikiInline text={text} onOpenLink={onOpenLink} /></h1> : level === 2 ? <h2><WikiInline text={text} onOpenLink={onOpenLink} /></h2> : <h3><WikiInline text={text} onOpenLink={onOpenLink} /></h3>}
              {rest ? <p><WikiInline text={rest} onOpenLink={onOpenLink} /></p> : null}
            </div>
          );
        }
        if (block.split("\n").every((line) => /^[-*]\s+/.test(line))) {
          return <ul key={index}>{block.split("\n").map((line, itemIndex) => <li key={itemIndex}><WikiInline text={line.replace(/^[-*]\s+/, "")} onOpenLink={onOpenLink} /></li>)}</ul>;
        }
        return <p key={index}><WikiInline text={block} onOpenLink={onOpenLink} /></p>;
      })}
    </div>
  );
}

interface DraftState {
  title: string;
  content: string;
  folder: string;
  brand: string;
  team: string;
  tags: string;
}

interface MarkdownImportItem {
  id: string;
  fileName: string;
  title: string;
  content: string;
  bytes: number;
  duplicate: boolean;
}

const MAX_IMPORT_FILES = 50;
const MAX_MARKDOWN_BYTES = 1_500_000;

function markdownTitle(fileName: string, content: string) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || fileName.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function toDraft(document: KnowledgeDocument): DraftState {
  return {
    title: document.title,
    content: document.content_md,
    folder: document.folder,
    brand: document.brand,
    team: document.team,
    tags: document.tags.join(", "),
  };
}

function WorkspaceContent() {
  const searchParams = useSearchParams();
  const { demo, accessToken, profile } = useSession();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>(demo ? DEMO_DOCUMENTS : []);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("document"));
  const [ownerFilter, setOwnerFilter] = useState(searchParams.get("document") ? "all" : "mine_company");
  const [members, setMembers] = useState<OsMember[]>([]);
  const [mode, setMode] = useState<"read" | "edit" | "info">("read");
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [newOpen, setNewOpen] = useState(searchParams.get("new") === "1");
  const [importOpen, setImportOpen] = useState(false);
  const [importItems, setImportItems] = useState<MarkdownImportItem[]>([]);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [canonicalGate, setCanonicalGate] = useState(false);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["00_Skills", "02_Wiki"]));
  const [sortAscending, setSortAscending] = useState(false);
  const [listLoading, setListLoading] = useState(!demo);
  const [backlinks, setBacklinks] = useState<KnowledgeDocument[]>([]);
  const [focusMode, setFocusMode] = useState(true);
  const [treeOpen, setTreeOpen] = useState(true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const savedFocus = window.localStorage.getItem("brandy-knowledge-focus");
    setFocusMode(savedFocus === null ? true : savedFocus === "true");
    setTreeOpen(window.localStorage.getItem("brandy-knowledge-tree") !== "false");
    setPreferencesReady(true);
    return () => { window.dispatchEvent(new CustomEvent("brandy-knowledge-focus", { detail: false })); };
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    window.localStorage.setItem("brandy-knowledge-focus", String(focusMode));
    window.localStorage.setItem("brandy-knowledge-tree", String(treeOpen));
    window.dispatchEvent(new CustomEvent("brandy-knowledge-focus", { detail: focusMode }));
  }, [focusMode, preferencesReady, treeOpen]);

  useEffect(() => {
    if (demo) {
      if (profile) setMembers([{ id: profile.id, email: profile.email, display_name: profile.displayName, role: profile.role, team: profile.team, is_active: true, affiliation: "브랜디액션", roles: [], onboarding: {}, finance_access: profile.role === "admin" }]);
      return;
    }
    listMembers(accessToken).then((result) => setMembers(result.members.filter((member) => member.is_active))).catch(() => setMembers([]));
  }, [accessToken, demo, profile]);

  const reload = useCallback(async () => {
    if (demo) return;
    setListLoading(true);
    try {
      const all: KnowledgeDocument[] = [];
      const first = await listDocuments(accessToken, "view=summary&limit=200&offset=0");
      all.push(...first.documents);
      setDocuments([...all]);
      setSelectedId((current) => current ?? all[0]?.id ?? null);
      setListLoading(false);
      const offsets = Array.from(
        { length: Math.max(0, Math.ceil(first.total / 200) - 1) },
        (_, index) => (index + 1) * 200,
      );
      const remaining = await Promise.all(
        offsets.map((offset) =>
          listDocuments(accessToken, `view=summary&limit=200&offset=${offset}`),
        ),
      );
      remaining.forEach((result) => all.push(...result.documents));
      setDocuments(all);
      setSelectedId((current) => current ?? all[0]?.id ?? null);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "문서를 불러오지 못했습니다.");
    } finally {
      setListLoading(false);
    }
  }, [accessToken, demo]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!selectedId && documents[0]) setSelectedId(documents[0].id);
  }, [documents, selectedId]);

  const selected = documents.find((document) => document.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected || selected.content_md || demo) return;
    getDocument(accessToken, selected.id)
      .then(({ document }) => setDocuments((current) => current.map((item) => item.id === document.id ? document : item)))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "문서 본문을 불러오지 못했습니다."));
  }, [accessToken, demo, selected]);
  useEffect(() => {
    if (selected) setDraft(toDraft(selected));
  }, [selected]);

  useEffect(() => {
    if (!selected || mode !== "info" || demo) return;
    setVersionsLoading(true);
    listDocumentVersions(accessToken, selected.id)
      .then((result) => setVersions(result.versions))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "변경 이력을 불러오지 못했습니다."))
      .finally(() => setVersionsLoading(false));
  }, [accessToken, demo, mode, selected]);

  useEffect(() => {
    if (!selected || demo) { setBacklinks([]); return; }
    const params = new URLSearchParams({ view: "summary", limit: "50", q: `[[${selected.title}` });
    listDocuments(accessToken, params.toString())
      .then((result) => setBacklinks(result.documents.filter((item) => item.id !== selected.id)))
      .catch(() => setBacklinks([]));
  }, [accessToken, demo, selected]);

  const filtered = useMemo(() => {
    return documents.filter((document) => {
      if (ownerFilter === "mine_company" && document.owner_id !== profile?.id && document.status !== "canonical") return false;
      if (ownerFilter === "canonical" && document.status !== "canonical") return false;
      if (ownerFilter === "mine" && document.owner_id !== profile?.id) return false;
      if (ownerFilter === "team" && document.status !== "team") return false;
      if (ownerFilter === "review" && !["review", "reviewed"].includes(document.status)) return false;
      if (ownerFilter === "archived" && document.status !== "archived") return false;
      if (ownerFilter.startsWith("member:") && document.owner_id !== ownerFilter.slice(7)) return false;
      if (ownerFilter !== "archived" && document.status === "archived") return false;
      return true;
    });
  }, [documents, ownerFilter, profile?.id]);

  const folderTree = useMemo(() => buildFolderTree(filtered, sortAscending), [filtered, sortAscending]);
  const treeRows = useMemo(() => {
    const rows: TreeRow[] = [];
    const visit = (nodes: FolderTreeNode[], depth: number) => nodes.forEach((folder) => {
      rows.push({ type: "folder", folder, depth });
      if (!expandedFolders.has(folder.path)) return;
      visit(folder.children, depth + 1);
      folder.documents.forEach((document) => rows.push({ type: "document", document, depth: depth + 1 }));
    });
    visit(folderTree, 0); return rows;
  }, [expandedFolders, folderTree]);
  const ownerNames = useMemo(() => new Map(members.map((member) => [member.id, member.display_name || member.email.split("@")[0]])), [members]);
  const readingContent = useMemo(() => prepareReadingContent(selected?.content_md ?? ""), [selected?.content_md]);

  useEffect(() => {
    if (searchParams.get("document") || !filtered.length) return;
    if (!selectedId || !filtered.some((document) => document.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, searchParams, selectedId]);

  const moveDocument = async (documentId: string, folder: string) => {
    const item = documents.find((document) => document.id === documentId);
    if (!item || item.folder === folder) return;
    setBusy(true); setError("");
    try {
      const { document } = await updateDocument(accessToken, { id: item.id, expectedVersion: item.current_version, folder, reason: `폴더 이동: ${folder}` });
      setDocuments((current) => current.map((row) => row.id === document.id ? document : row));
      setToast(`“${document.title}” 문서를 ${folder}(으)로 이동했습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "폴더로 이동하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const applyMarkdown = (before: string, after = before, placeholder = "텍스트") => {
    if (!draft || !editorRef.current) return;
    const textarea = editorRef.current; const start = textarea.selectionStart; const end = textarea.selectionEnd;
    const selectedText = draft.content.slice(start, end) || placeholder;
    const content = `${draft.content.slice(0, start)}${before}${selectedText}${after}${draft.content.slice(end)}`;
    setDraft({ ...draft, content });
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + before.length, start + before.length + selectedText.length); });
  };

  const save = async () => {
    if (!selected || !draft) return;
    setBusy(true); setError("");
    try {
      if (demo) {
        const updated: KnowledgeDocument = {
          ...selected,
          title: draft.title,
          content_md: draft.content,
          folder: draft.folder,
          brand: draft.brand,
          team: draft.team,
          tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          current_version: selected.current_version + 1,
          updated_at: new Date().toISOString(),
        };
        setDocuments((current) => current.map((document) => document.id === updated.id ? updated : document));
      } else {
        const { document } = await updateDocument(accessToken, {
          id: selected.id,
          expectedVersion: selected.current_version,
          title: draft.title,
          content: draft.content,
          folder: draft.folder,
          brand: draft.brand,
          team: draft.team,
          tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          reason: "OS 문서 작업공간에서 수정",
        });
        setDocuments((current) => current.map((item) => item.id === document.id ? document : item));
      }
      setMode("read"); setToast("새 버전으로 저장했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const moveStatus = async (target: DocumentStatus) => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      let updated: KnowledgeDocument;
      if (demo) updated = { ...selected, status: target, updated_at: new Date().toISOString() };
      else ({ document: updated } = await changeDocumentStatus(accessToken, selected.id, target));
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item));
      setToast(`${statusLabel(target)} 상태로 변경했습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "상태를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const beginEdit = () => {
    if (!selected) return;
    if (selected.status === "canonical") setCanonicalGate(true);
    else setMode("edit");
  };

  const restoreVersion = async (version: DocumentVersion) => {
    if (!selected || !window.confirm(`v${version.version_no} 내용으로 되돌릴까요? 현재 내용도 새 버전으로 보존됩니다.`)) return;
    setBusy(true); setError("");
    try {
      let restored: KnowledgeDocument;
      if (demo) restored = { ...selected, title: version.title, content_md: version.content_md, current_version: selected.current_version + 1, updated_at: new Date().toISOString() };
      else ({ document: restored } = await restoreDocumentVersion(accessToken, selected.id, version.version_no, selected.current_version));
      setDocuments((current) => current.map((item) => item.id === restored.id ? restored : item));
      setDraft(toDraft(restored)); setToast(`v${version.version_no} 내용을 새 버전으로 복원했습니다.`);
      if (!demo) {
        const result = await listDocumentVersions(accessToken, selected.id);
        setVersions(result.versions);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "버전을 되돌리지 못했습니다."); }
    finally { setBusy(false); }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      title: String(data.get("title") ?? ""),
      content: String(data.get("content") ?? ""),
      folder: String(data.get("folder") ?? ""),
      brand: String(data.get("brand") ?? ""),
      team: String(data.get("team") ?? ""),
      tags: String(data.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
      source: "wiki",
    };
    setBusy(true); setError("");
    try {
      let document: KnowledgeDocument;
      if (demo) {
        const now = new Date().toISOString();
        document = { id: `demo-${Date.now()}`, ...input, content_md: input.content, status: "draft", source_ref: null, owner_id: profile?.id ?? "demo-ricky", created_by: profile?.id ?? "demo-ricky", current_version: 1, created_at: now, updated_at: now };
      } else ({ document } = await createDocument(accessToken, input));
      setDocuments((current) => [document, ...current]);
      setSelectedId(document.id); setNewOpen(false); setMode("read"); setToast("개인 초안으로 저장했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "문서를 만들지 못했습니다."); }
    finally { setBusy(false); }
  };

  const selectMarkdownFiles = async (files: FileList | null) => {
    if (!files) return;
    setError("");
    const selectedFiles = [...files].slice(0, MAX_IMPORT_FILES);
    const invalid = selectedFiles.filter((file) => !file.name.toLowerCase().endsWith(".md") || file.size > MAX_MARKDOWN_BYTES);
    const existingSources = new Set(documents.map((document) => document.source_ref?.toLocaleLowerCase("ko-KR")).filter(Boolean));
    const existingTitles = new Set(documents.map((document) => document.title.toLocaleLowerCase("ko-KR")));
    const batchSources = new Set<string>();
    const batchTitles = new Set<string>();
    const items: MarkdownImportItem[] = [];

    for (const file of selectedFiles) {
      if (!file.name.toLowerCase().endsWith(".md") || file.size > MAX_MARKDOWN_BYTES) continue;
      const content = await file.text();
      if (!content.trim()) continue;
      const title = markdownTitle(file.name, content);
      const sourceKey = file.name.toLocaleLowerCase("ko-KR");
      const titleKey = title.toLocaleLowerCase("ko-KR");
      const duplicate = existingSources.has(sourceKey) || existingTitles.has(titleKey) || batchSources.has(sourceKey) || batchTitles.has(titleKey);
      items.push({ id: `${file.name}-${file.lastModified}-${file.size}`, fileName: file.name, title, content, bytes: file.size, duplicate });
      batchSources.add(sourceKey);
      batchTitles.add(titleKey);
    }
    setImportItems(items);
    setImportProgress({ done: 0, total: items.filter((item) => !item.duplicate).length });
    if (files.length > MAX_IMPORT_FILES || invalid.length || items.length < selectedFiles.length - invalid.length) {
      setError(`Markdown은 한 번에 ${MAX_IMPORT_FILES}개, 파일당 ${formatBytes(MAX_MARKDOWN_BYTES)} 이하의 내용 있는 파일만 가져올 수 있습니다.`);
    }
  };

  const importMarkdown = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ready = importItems.filter((item) => !item.duplicate);
    if (!ready.length) return;
    const data = new FormData(event.currentTarget);
    const folder = String(data.get("folder") ?? "").trim();
    const team = String(data.get("team") ?? "").trim();
    const brand = String(data.get("brand") ?? "").trim();
    const tags = String(data.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const created: KnowledgeDocument[] = [];
    const failed: string[] = [];
    setBusy(true); setError(""); setImportProgress({ done: 0, total: ready.length });

    for (const item of ready) {
      try {
        let document: KnowledgeDocument;
        if (demo) {
          const now = new Date().toISOString();
          document = { id: `demo-import-${Date.now()}-${created.length}`, title: item.title, content_md: item.content, folder, brand, team, tags, status: "draft", source: "markdown", source_ref: item.fileName, owner_id: profile?.id ?? "demo-ricky", created_by: profile?.id ?? "demo-ricky", current_version: 1, created_at: now, updated_at: now };
        } else {
          ({ document } = await createDocument(accessToken, { title: item.title, content: item.content, folder, brand, team, tags, source: "markdown", sourceRef: item.fileName }));
        }
        created.push(document);
      } catch {
        failed.push(item.fileName);
      }
      setImportProgress((current) => ({ ...current, done: current.done + 1 }));
    }

    if (demo) setDocuments((current) => [...created, ...current]);
    else await reload();
    setBusy(false);
    if (created[0]) setSelectedId(created[0].id);
    if (failed.length) {
      setImportItems((current) => current.filter((item) => failed.includes(item.fileName)));
      setError(`${created.length}개를 가져왔고 ${failed.length}개는 실패했습니다. 실패 파일만 다시 시도할 수 있습니다.`);
    } else {
      setImportOpen(false); setImportItems([]); setImportProgress({ done: 0, total: 0 });
      setToast(`${created.length}개 Markdown 문서를 개인 초안으로 가져왔습니다.`);
    }
  };

  const openWikiLink = (title: string) => {
    const normalized = title.normalize("NFC").trim().toLocaleLowerCase("ko-KR");
    const target = documents.find((document) => document.status !== "archived" && document.title.normalize("NFC").trim().toLocaleLowerCase("ko-KR") === normalized);
    if (!target) { setToast(`“${title}” 문서가 없어 깨진 링크로 표시됩니다.`); return; }
    setOwnerFilter("all"); setSelectedId(target.id); setMode("read");
  };

  return (
    <>
      <header className="page-header workspace-page-header">
        <div className="page-title-group"><span className="eyebrow">지식 작업공간</span><h1>문서 작업공간</h1><p>개인의 경험을 쌓고, 검토를 거쳐 회사가 함께 쓰는 정본으로 만듭니다.</p></div>
        <div className="header-actions"><button className="secondary-button knowledge-tree-toggle" aria-pressed={treeOpen} onClick={() => setTreeOpen((value) => !value)}>{treeOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />} {treeOpen ? "파일 트리 숨기기" : "파일 트리 보기"}</button><button className="secondary-button" aria-pressed={focusMode} onClick={() => setFocusMode((value) => !value)}>{focusMode ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />} {focusMode ? "전체 메뉴 보기" : "집중 모드"}</button><button className="secondary-button" onClick={() => setImportOpen(true)}><Upload size={16} /> Markdown 가져오기</button><button className="primary-button" onClick={() => setNewOpen(true)}><FilePlus2 size={16} /> 새 문서</button></div>
      </header>
      <datalist id="knowledge-category-options">
        {KNOWLEDGE_CATEGORIES.map((category) => <option value={category} key={category} />)}
      </datalist>

      {focusMode ? <nav className="knowledge-focus-tabs" aria-label="지식 메뉴"><Link aria-current="page" href="/knowledge">문서 작업공간</Link><Link href="/knowledge/search">지식 검색</Link><Link href="/knowledge/review">검토함</Link><Link href="/knowledge/skills">Skill 관리</Link><Link href="/knowledge/graph">지식 연결</Link></nav> : null}

      <div className="owner-chips">
        {OWNER_FILTERS.map((item) => <button key={item.id} className={ownerFilter === item.id ? "active" : ""} onClick={() => setOwnerFilter(item.id)}>{item.label}</button>)}
        {members.length > 1 ? <label className={ownerFilter.startsWith("member:") ? "active" : ""}><UserRound size={13} /><select aria-label="문서 소유자" value={ownerFilter.startsWith("member:") ? ownerFilter : ""} onChange={(event) => event.target.value && setOwnerFilter(event.target.value)}><option value="">소유자 선택</option>{members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.display_name || member.email.split("@")[0]}</option>)}</select></label> : null}
      </div>
      {error ? <div className="inline-alert danger">{error}<button onClick={() => setError("")}><X size={14} /></button></div> : null}

      <section className={`knowledge-workspace${!treeOpen ? " tree-hidden" : ""}`}>
        {treeOpen ? <button className="knowledge-tree-scrim" aria-label="파일 트리 닫기" onClick={() => setTreeOpen(false)} /> : null}
        <aside className={`folder-pane knowledge-tree-pane${treeOpen ? " mobile-open" : ""}`}>
          <div className="pane-title"><span><FolderOpen size={15} /><strong>파일 트리</strong><small>{filtered.length}개</small></span><button onClick={() => setSortAscending((value) => !value)}>{sortAscending ? "오래된 순" : "최근 순"} <ChevronDown size={12} /></button></div>
          <div className="knowledge-tree-scroll">
            {listLoading && !documents.length ? <div className="list-empty"><File size={22} /><span>문서 불러오는 중</span></div> : null}
            {treeRows.map((row) => row.type === "folder" ? (
              <button
                className="folder-row folder-tree-row"
                style={{ paddingLeft: 10 + row.depth * 16 }} key={`folder-${row.folder.path}`}
                onClick={() => setExpandedFolders((current) => { const next = new Set(current); if (next.has(row.folder.path)) next.delete(row.folder.path); else next.add(row.folder.path); return next; })}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); moveDocument(event.dataTransfer.getData("text/document-id"), row.folder.path); }}
              >{expandedFolders.has(row.folder.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={15} /><span>{row.folder.name}</span><small>{row.folder.count}</small></button>
            ) : (
              <button draggable key={row.document.id} className={`folder-row document-tree-row${row.document.id === selectedId ? " active" : ""}`} style={{ paddingLeft: 20 + row.depth * 16 }} onDragStart={(event) => event.dataTransfer.setData("text/document-id", row.document.id)} onClick={() => { setSelectedId(row.document.id); setMode("read"); if (window.innerWidth < 900) setTreeOpen(false); }}>
                <span className="tree-spacer" /><File size={14} /><span><strong>{row.document.title}</strong><em>{ownerNames.get(row.document.owner_id) || "소유자 미지정"}</em></span><i className={`mini-status status-${row.document.status}`} />
              </button>
            ))}
            {!treeRows.length && !listLoading ? <div className="list-empty"><File size={22} /><span>조건에 맞는 문서가 없습니다.</span></div> : null}
          </div>
          <div className="folder-divider" />
          <button className={`folder-row${ownerFilter === "archived" ? " active" : ""}`} onClick={() => setOwnerFilter("archived")}><Trash2 size={15} /><span>휴지통</span><small>{documents.filter((item) => item.status === "archived").length}</small></button>
        </aside>

        <article className="editor-pane">
          {selected && draft ? (
            <>
              <div className="editor-toolbar">
                <div className="editor-tabs">
                  <button className={mode === "read" ? "active" : ""} onClick={() => setMode("read")}><Eye size={15} /> 읽기</button>
                  <button className={mode === "edit" ? "active" : ""} onClick={beginEdit}><Pencil size={15} /> {selected.status === "canonical" ? "정본 편집" : "편집"}</button>
                  <button className={mode === "info" ? "active" : ""} onClick={() => setMode("info")}><Clock3 size={15} /> 정보</button>
                </div>
                <div className="editor-actions">
                  {mode === "edit" ? <button className="primary-button compact" onClick={save} disabled={busy}><Save size={14} /> 저장</button> : null}
                  {nextStatus(selected.status) && statusActionLabel(selected.status) ? <button className="secondary-button compact" onClick={() => moveStatus(nextStatus(selected.status)!)} disabled={busy}><Send size={14} /> {statusActionLabel(selected.status)}</button> : null}
                  {selected.owner_id === profile?.id && ["draft", "team", "review", "reviewed"].includes(selected.status) ? <button className="primary-button compact" onClick={() => moveStatus("canonical")} disabled={busy}><BookCheck size={14} /> 회사 정본으로</button> : null}
                  <button className="icon-button" title="문서 정보" aria-label="문서 정보" onClick={() => setMode("info")}><MoreHorizontal size={17} /></button>
                </div>
              </div>
              <div className="document-meta-line"><span className={`status-pill status-${selected.status}`}>{statusLabel(selected.status)}</span><span>v{selected.current_version}</span><span>마지막 수정 {formatDate(selected.updated_at)}</span></div>
              {mode === "edit" ? (
                <div className="document-editor">
                  {selected.status === "canonical" ? <div className="canonical-edit-banner"><ShieldAlert size={18} /><span><strong>회사 정본을 편집하고 있습니다.</strong><small>저장하면 전 직원과 AI 검색에 반영되며, 이전 내용은 버전으로 보존됩니다.</small></span></div> : null}
                  <input className="title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} aria-label="문서 제목" />
                  <div className="meta-input-grid">
                    <label><span><Folder size={13} /> 폴더</span><input list="knowledge-category-options" value={draft.folder} onChange={(event) => setDraft({ ...draft, folder: event.target.value })} /></label>
                    <label><span><UserRound size={13} /> 팀</span><input value={draft.team} onChange={(event) => setDraft({ ...draft, team: event.target.value })} /></label>
                    <label><span><BookCheck size={13} /> 브랜드</span><input value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label>
                    <label><span><Tag size={13} /> 태그</span><input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="쉼표로 구분" /></label>
                  </div>
                  <div className="markdown-toolbar" aria-label="마크다운 도구"><button type="button" title="제목" onClick={() => applyMarkdown("## ", "", "제목")}><Hash size={14} /></button><button type="button" title="굵게" onClick={() => applyMarkdown("**", "**")}><Bold size={14} /></button><button type="button" title="목록" onClick={() => applyMarkdown("- ", "")}><List size={14} /></button><button type="button" title="인용" onClick={() => applyMarkdown("> ", "")}><Quote size={14} /></button><button type="button" title="표" onClick={() => applyMarkdown("| 항목 | 내용 |\n| --- | --- |\n| ", " |", "값")}><Table2 size={14} /></button><button type="button" title="위키링크" onClick={() => applyMarkdown("[[", "]]", "문서명")}><Link2 size={14} /></button></div>
                  <textarea ref={editorRef} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} aria-label="문서 본문" spellCheck="false" />
                </div>
              ) : mode === "info" ? (
                <div className="document-info">
                  <h2>문서 정보</h2>
                  <dl><div><dt>상태</dt><dd>{statusLabel(selected.status)}</dd></div><div><dt>소유자</dt><dd>{ownerNames.get(selected.owner_id) || "소유자 미지정"}</dd></div><div><dt>현재 버전</dt><dd>v{selected.current_version}</dd></div><div><dt>폴더</dt><dd>{selected.folder || "분류 없음"}</dd></div><div><dt>브랜드</dt><dd>{selected.brand || "전체"}</dd></div><div><dt>담당 팀</dt><dd>{selected.team || "전체"}</dd></div><div><dt>원본</dt><dd>{selected.source}</dd></div></dl>
                  <h3>정본 승격 단계</h3><div className="status-flow">{STATUS_FLOW.map((status, index) => <div key={status} className={selected.status === "canonical" || STATUS_FLOW.indexOf(selected.status) >= index ? "done" : ""}><span>{index + 1}</span><small>{statusLabel(status)}</small></div>)}</div>
                  <h3>변경 이력</h3>
                  <div className="version-history">{versionsLoading ? <div className="quiet-state">변경 이력을 불러오는 중입니다.</div> : versions.map((version) => <div key={version.version_no}><span><strong>v{version.version_no} · {version.author_name}</strong><small>{formatDate(version.created_at)}{version.reason ? ` · ${version.reason}` : ""}</small></span>{version.version_no !== selected.current_version ? <button className="ghost-button" disabled={busy} onClick={() => restoreVersion(version)}><RotateCcw size={13} /> 되돌리기</button> : <em>현재</em>}</div>)}</div>
                  <h3>문서 연결</h3><div className="knowledge-links"><div><strong>나가는 링크</strong>{wikiLinks(selected.content_md).map((link) => <span key={link}><Link2 size={12} /> {link}</span>)}{!wikiLinks(selected.content_md).length ? <small>본문에 [[문서명]]을 입력하면 연결됩니다.</small> : null}</div><div><strong>백링크</strong>{backlinks.map((item) => <button key={item.id} onClick={() => { setSelectedId(item.id); setMode("read"); }}><Link2 size={12} /> {item.title}</button>)}{!backlinks.length ? <small>이 문서를 가리키는 문서가 없습니다.</small> : null}</div></div>
                  {selected.status !== "archived" ? <button className="ghost-button archive-action" onClick={() => moveStatus("archived")}><Archive size={15} /> 문서 보관</button> : <button className="ghost-button archive-action" onClick={() => moveStatus("draft")}><RotateCcw size={15} /> 초안으로 복원</button>}
                </div>
              ) : (
                <div className="document-reader"><h1>{selected.title}</h1><div className="reader-tags">{selected.tags.map((tag) => <span key={tag}><Hash size={11} />{tag}</span>)}</div>{readingContent.metadata.length ? <details className="reader-metadata"><summary>문서 속성 {readingContent.metadata.length}개</summary><dl>{readingContent.metadata.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><WikiInline text={item.value} onOpenLink={openWikiLink} /></dd></div>)}</dl></details> : null}<MarkdownView content={readingContent.body} onOpenLink={openWikiLink} /></div>
              )}
            </>
          ) : (
            <div className="empty-state"><div><span><FilePenLine /></span><h3>문서를 선택하세요</h3><p>파일 트리에서 열거나 새 문서를 만들어 시작할 수 있습니다.</p><button className="primary-button" onClick={() => setNewOpen(true)}>새 문서</button></div></div>
          )}
        </article>
      </section>

      {newOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setNewOpen(false)}>
          <form className="form-modal new-document-modal" onSubmit={create}>
            <header><div><span className="eyebrow">새 지식</span><h2>새 문서 만들기</h2></div><button type="button" onClick={() => setNewOpen(false)}><X size={18} /></button></header>
            <div className="form-fields">
              <label className="wide"><span>문서 제목</span><input name="title" required autoFocus placeholder="무엇을 남길지 명확하게 적어주세요" /></label>
              <label><span>폴더</span><input list="knowledge-category-options" name="folder" placeholder="회사 공통" /></label>
              <label><span>담당 팀</span><input name="team" placeholder="콘텐츠" /></label>
              <label><span>브랜드</span><input name="brand" placeholder="브랜디액션" /></label>
              <label><span>태그</span><input name="tags" placeholder="지식, 운영, 자동화" /></label>
              <label className="wide"><span>본문</span><textarea name="content" required placeholder="# 핵심 내용\n\n문서의 맥락과 실행 기준을 적어주세요." /></label>
            </div>
            <footer><span>처음에는 개인 초안으로 안전하게 저장됩니다.</span><div><button type="button" className="ghost-button" onClick={() => setNewOpen(false)}>취소</button><button className="primary-button" disabled={busy}>{busy ? "저장 중…" : "초안 저장"}</button></div></footer>
          </form>
        </div>
      ) : null}
      {canonicalGate ? <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setCanonicalGate(false)}><div className="canonical-gate-modal"><ShieldAlert size={28} /><h2>회사 정본을 편집합니다</h2><p>이 문서는 전 직원과 AI가 함께 사용하는 회사 기준입니다. 수정하면 검색 결과와 연결된 업무에 반영됩니다.</p><div className="drawer-actions"><button className="ghost-button" onClick={() => setCanonicalGate(false)}>취소</button><button className="primary-button" onClick={() => { setCanonicalGate(false); setMode("edit"); }}>내용을 확인했고 편집하기</button></div></div></div> : null}
      {importOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && !busy && setImportOpen(false)}>
          <form className="form-modal import-modal" onSubmit={importMarkdown}>
            <header><div><span className="eyebrow">마크다운 가져오기</span><h2>회사 지식 가져오기</h2></div><button type="button" disabled={busy} onClick={() => setImportOpen(false)}><X size={18} /></button></header>
            <div className="import-body">
              {error ? <div className="inline-alert danger import-alert">{error}</div> : null}
              <label className="import-dropzone"><Upload size={24} /><strong>Markdown 파일 선택</strong><span>여러 개의 .md 파일 · 파일당 최대 {formatBytes(MAX_MARKDOWN_BYTES)}</span><input type="file" accept=".md,text/markdown" multiple disabled={busy} onChange={(event) => selectMarkdownFiles(event.target.files)} /></label>
              {importItems.length ? <div className="import-summary"><strong>{importItems.length}개 선택</strong><span>{importItems.filter((item) => item.duplicate).length}개 중복 제외 · {formatBytes(importItems.reduce((sum, item) => sum + item.bytes, 0))}</span></div> : null}
              {importItems.length ? <div className="import-file-list">{importItems.map((item) => <div className={item.duplicate ? "duplicate" : ""} key={item.id}><File size={15} /><span><strong>{item.title}</strong><small>{item.fileName} · {formatBytes(item.bytes)}</small></span><em>{item.duplicate ? "중복 제외" : "초안"}</em></div>)}</div> : null}
              <div className="form-fields import-meta">
                <label><span>저장 폴더</span><input list="knowledge-category-options" name="folder" placeholder="회사 공통" /></label>
                <label><span>담당 팀</span><input name="team" defaultValue={profile?.team ?? ""} /></label>
                <label><span>브랜드</span><input name="brand" placeholder="브랜디액션" /></label>
                <label><span>공통 태그</span><input name="tags" placeholder="가져오기, 운영" /></label>
              </div>
            </div>
            <footer><span>{busy ? `${importProgress.done} / ${importProgress.total} 처리 중` : "중복 문서는 건너뛰며 모두 개인 초안으로 저장됩니다."}</span><div><button type="button" className="ghost-button" disabled={busy} onClick={() => setImportOpen(false)}>취소</button><button className="primary-button" disabled={busy || !importItems.some((item) => !item.duplicate)}>{busy ? "가져오는 중…" : `${importItems.filter((item) => !item.duplicate).length}개 가져오기`}</button></div></footer>
          </form>
        </div>
      ) : null}
      {toast ? <button className="toast" onClick={() => setToast("")}><CircleCheck size={16} /> {toast}</button> : null}
    </>
  );
}

export function KnowledgeWorkspace() {
  return <Suspense><WorkspaceContent /></Suspense>;
}
