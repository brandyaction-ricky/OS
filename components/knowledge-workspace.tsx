"use client";

import { insertTag, markdownBlocks, markdownCodeBody, markdownSections, treeWidth, type MarkdownSection } from "@/lib/markdown-sections";

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
  FolderCog,
  FolderOpen,
  FolderPlus,
  Hash,
  Link2,
  List,
  MoreHorizontal,
  MoveRight,
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
import { ApiRequestError, apiRequest, changeDocumentStatus, createDocument, getDocument, listDocuments, listDocumentVersions, listMembers, restoreDocumentVersion, updateDocument, type OsMember } from "@/lib/api-client";
import { resolveWikiLink } from "@/lib/knowledge-links";
import { knowledgeFolderOptions, normalizeKnowledgeFolder } from "@/lib/knowledge-folders";
import { documentCreateSchema } from "@/lib/validation";
import { updateFolderInventory, inKnowledgeScope } from "@/lib/knowledge-workspace-state";
import { useKnowledgeDraft } from "@/hooks/use-knowledge-draft";
import { KnowledgeFolderPicker } from "./knowledge-folder-picker";
import { WikiInline } from "./knowledge-inline";
import { KnowledgeReviewHistory } from "./knowledge-review-history";
import { KnowledgeDocumentMover } from "./knowledge-document-mover";
import { KnowledgeFolderManager } from "./knowledge-folder-manager";
import { KnowledgeDocumentFinder } from "./knowledge-document-finder";
import { KnowledgeImport } from "./knowledge-import";
import { KnowledgeVersionComparison } from "./knowledge-version-comparison";
import { KnowledgeModal } from "./knowledge-modal";
import { getDemoKnowledgeDocuments, getDemoKnowledgeVersions, saveDemoKnowledgeDocument, addDemoKnowledgeEvent } from "@/lib/demo-knowledge-store";
import type { DocumentStatus, DocumentVersion, KnowledgeDocument } from "@/lib/types";
import { statusLabel } from "./dashboard";
import { DevelopmentDocumentLiveLog } from "./development-document-live-log";
import { useSession } from "./session-provider";

const STATUS_FLOW: DocumentStatus[] = ["draft", "team", "review", "reviewed", "canonical"];

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
  return "분류 없음";
}

function buildFolderTree(documents: KnowledgeDocument[], sortAscending: boolean, inventory: Array<{path: string; count: number}> = []) {
  const roots: FolderTreeNode[] = [];
  const entries = inventory.length ? inventory : documents.map(document => ({path: documentFolder(document), count: 1}));
  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    let level = roots; let path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let node = level.find((item) => item.name === part);
      if (!node) { node = { name: part, path, count: 0, children: [], documents: [] }; level.push(node); }
      node.count += entry.count; level = node.children;
    }
  }
  for (const document of documents) {
    const parts = documentFolder(document).split("/").filter(Boolean);
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
  return [...new Set([...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => wikiTarget(match[1])).filter(Boolean))];
}

function wikiTarget(raw: string) {
  const target = raw.split("|")[0].split("#")[0].trim().replace(/\\/g, "/");
  return target.replace(/\.md$/i, "");
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function nextStatus(status: DocumentStatus): DocumentStatus | null {
  const index = STATUS_FLOW.indexOf(status);
  return index >= 0 && index < STATUS_FLOW.length - 1 ? STATUS_FLOW[index + 1] : null;
}

function statusActionLabel(status: DocumentStatus) {
  return ({ draft: "팀에 공유", team: "검토 요청", review: "", reviewed: "", canonical: "", archived: "" })[status];
}

function MarkdownBlocks({ content, onOpenLink }: { content: string; onOpenLink: (title: string) => void }) {
  const blocks = markdownBlocks(content);
  return (
    <div className="markdown-view">
      {blocks.map((block, index) => {
        const heading = block.match(/^(#{1,4})\s+(.+)/);
        if (heading) {
          const level = heading[1].length;
          const text = heading[2].split("\n")[0];
          const rest = block.split("\n").slice(1).join("\n");
          return (
            <div key={index} id={`wiki-heading-${text.normalize("NFC").trim()}`}>
              {level === 1 ? <h1><WikiInline text={text} onOpenLink={onOpenLink} /></h1> : level === 2 ? <h2><WikiInline text={text} onOpenLink={onOpenLink} /></h2> : <h3><WikiInline text={text} onOpenLink={onOpenLink} /></h3>}
              {rest ? <p><WikiInline text={rest} onOpenLink={onOpenLink} /></p> : null}
            </div>
          );
        }
        const lines = block.split("\n");
        if (lines.length >= 2 && /^\s*\|.+\|\s*$/.test(lines[0]) && /^\s*\|?\s*:?-{3,}/.test(lines[1])) {
          const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
          const headers = cells(lines[0]);
          return <div className="markdown-table-wrap" key={index}><table><thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}><WikiInline text={cell} onOpenLink={onOpenLink} /></th>)}</tr></thead><tbody>{lines.slice(2).map((line, rowIndex) => <tr key={rowIndex}>{cells(line).map((cell, cellIndex) => <td key={cellIndex}><WikiInline text={cell} onOpenLink={onOpenLink} /></td>)}</tr>)}</tbody></table></div>;
        }
        if (lines.every((line) => /^[-*]\s+/.test(line))) {
          return <ul key={index}>{block.split("\n").map((line, itemIndex) => <li key={itemIndex} className={/^[-*]\s+\[[ xX]\]/.test(line) ? "knowledge-task-item" : undefined}>{/^[-*]\s+\[[ xX]\]/.test(line) ? <input type="checkbox" checked={/^[-*]\s+\[[xX]\]/.test(line)} disabled aria-label={line.replace(/^[-*]\s+\[[ xX]\]\s*/, "")} /> : null}<WikiInline text={line.replace(/^[-*]\s+/, "").replace(/^\[[ xX]\]\s*/, "")} onOpenLink={onOpenLink} /></li>)}</ul>;
        }
        if (lines.every((line) => /^\d+[.)]\s+/.test(line))) return <ol key={index}>{lines.map((line, itemIndex) => <li key={itemIndex}><WikiInline text={line.replace(/^\d+[.)]\s+/, "")} onOpenLink={onOpenLink} /></li>)}</ol>;
        if (lines.every((line) => /^>\s?/.test(line))) return <blockquote key={index}><CopyMarkdown text={lines.map((line) => line.replace(/^>\s?/, "")).join("\n")} /><WikiInline text={lines.map((line) => line.replace(/^>\s?/, "")).join("\n")} onOpenLink={onOpenLink} /></blockquote>;
        if (/^\s*(?:`{3,}|~{3,})/.test(block)) return <div key={index}><CopyMarkdown text={markdownCodeBody(block)} /><pre className="markdown-code"><code>{markdownCodeBody(block)}</code></pre></div>;
        return <p key={index}><WikiInline text={block} onOpenLink={onOpenLink} /></p>;
      })}
    </div>
  );
}

function CopyMarkdown({ text }: { text: string }) {
  const [notice, setNotice] = useState("");
  return <><button type="button" className="ghost-button" onClick={() => { void navigator.clipboard.writeText(text).then(() => setNotice("복사됨")).catch(() => setNotice("복사 권한을 확인해 주세요.")); }}>복사</button>{notice ? <small role="status">{notice}</small> : null}</>;
}

function revealHeading(id: string) {
  const element = document.getElementById(id);
  for (let node = element; node; node = node.parentElement) if (node instanceof HTMLDetailsElement) node.open = true;
  element?.scrollIntoView({ block: "start" });
}

function MarkdownSectionView({ section, onOpenLink }: { section: MarkdownSection; onOpenLink: (title: string) => void }) {
  return <details className="markdown-section" open id={`wiki-heading-${section.title.normalize("NFC").trim()}`}>
    <summary><span role="heading" aria-level={section.level}><WikiInline text={section.title} onOpenLink={onOpenLink} /></span></summary>
    <MarkdownBlocks content={section.body} onOpenLink={onOpenLink} />
    {section.children.map((child, index) => <MarkdownSectionView key={index} section={child} onOpenLink={onOpenLink} />)}
  </details>;
}

function MarkdownView({ content, onOpenLink }: { content: string; onOpenLink: (title: string) => void }) {
  const root = useMemo(() => markdownSections(content), [content]);
  const headings: MarkdownSection[] = [];
  const collect = (section: MarkdownSection) => { if (section.title) headings.push(section); section.children.forEach(collect); };
  collect(root);
  return <>{headings.length ? <details className="document-outline"><summary>문서 목차 · {headings.length}개</summary><nav aria-label="문서 목차">{headings.map((heading, index) => <button key={index} className="ghost-button" style={{ paddingLeft: heading.level * 10 }} onClick={() => revealHeading(`wiki-heading-${heading.title.normalize("NFC").trim()}`)}>{heading.title}</button>)}</nav></details> : null}<MarkdownBlocks content={root.body} onOpenLink={onOpenLink} />{root.children.map((section, index) => <MarkdownSectionView key={index} section={section} onOpenLink={onOpenLink} />)}</>;
}

function WorkspaceContent() {
  const searchParams = useSearchParams();
  const { demo, accessToken, profile } = useSession();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>(() => demo ? getDemoKnowledgeDocuments() : []);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("document"));
  const [ownerFilter, setOwnerFilter] = useState(searchParams.get("document") ? "all" : "mine_company");
  const [members, setMembers] = useState<OsMember[]>([]);
  const [mode, setMode] = useState<"read" | "edit" | "info">("read");
  const selected = documents.find((document) => document.id === selectedId) ?? null;
  const { draft, setDraft, dirty, discard, rebase, expectedVersion } = useKnowledgeDraft(selected);
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const bypassUnload = useRef(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [pendingNewAction, setPendingNewAction] = useState<(() => void) | null>(null);
  const [newValues, setNewValues] = useState({ title: "", content: "", brand: "", team: "", tags: "" });
  const [newError, setNewError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>( {} );
  const [revision, setRevision] = useState(0);
  const [allFolders, setAllFolders] = useState<string[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [newOpen, setNewOpen] = useState(searchParams.get("new") === "1");
  const [newFolderPath, setNewFolderPath] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [moveIds, setMoveIds] = useState<string[]>([]);
  const [folderManagerOpen, setFolderManagerOpen] = useState(searchParams.get("folders") === "1");
  const [managedFolder, setManagedFolder] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [finderOpen, setFinderOpen] = useState(false);
  const [compareVersion, setCompareVersion] = useState<DocumentVersion | null>(null);
  const [compareBase, setCompareBase] = useState<KnowledgeDocument | null>(null);
  const [conflict, setConflict] = useState<KnowledgeDocument | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
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
  const [inventory, setInventory] = useState<Array<{path: string; count: number}>>([]);
  const [hoverTree, setHoverTree] = useState(false);
  const [paneWidth, setPaneWidth] = useState(280);
  const [tagQuery, setTagQuery] = useState<string | null>(null);
  const [treeScroll, setTreeScroll] = useState(0);
  const [linkQuery, setLinkQuery] = useState<string | null>(null);
  const [linkChoices, setLinkChoices] = useState<KnowledgeDocument[]>([]);
  const [pendingAnchor, setPendingAnchor] = useState<{ id: string; heading: string } | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const openFinderRef = useRef<() => void>(() => {});
  openFinderRef.current = () => guardAction(() => setFinderOpen(true));
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const epoch = useRef(0);
  const loadedFolders = useRef(new Set<string>());
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const selectDocumentNow = useCallback((id: string) => {
    setMode("read");
    setSelectedId(id);
    const params = new URLSearchParams(window.location.search);
    params.set("document", id);
    if (window.location.search !== `?${params.toString()}`) window.history.pushState(window.history.state, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, []);

  useEffect(() => {
    const id = searchParams.get("document");
    if (id !== selectedIdRef.current) { setSelectedId(id); setMode("read"); }
  }, [searchParams]);

  useEffect(() => {
    const savedFocus = window.localStorage.getItem("brandy-knowledge-focus");
    setFocusMode(savedFocus === null ? true : savedFocus === "true");
    setTreeOpen(window.localStorage.getItem("brandy-knowledge-tree") !== "false");
    const savedWidth = window.localStorage.getItem("brandy-knowledge-width-v1");
    if (savedWidth) setPaneWidth(treeWidth(Number(savedWidth)));
    setPreferencesReady(true);
    return () => { window.dispatchEvent(new CustomEvent("brandy-knowledge-focus", { detail: false })); };
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    window.localStorage.setItem("brandy-knowledge-focus", String(focusMode));
    window.localStorage.setItem("brandy-knowledge-tree", String(treeOpen));
    window.localStorage.setItem("brandy-knowledge-width-v1", String(paneWidth));
    window.dispatchEvent(new CustomEvent("brandy-knowledge-focus", { detail: focusMode }));
  }, [focusMode, preferencesReady, treeOpen, paneWidth]);

  useEffect(() => {
    if (demo) {
      if (profile) setMembers([{ id: profile.id, email: profile.email, display_name: profile.displayName, role: profile.role, team: profile.team, is_active: true, affiliation: "브랜디액션", roles: [], onboarding: {}, finance_access: profile.role === "admin" }]);
      return;
    }
    listMembers(accessToken).then((result) => setMembers(result.members.filter((member) => member.is_active))).catch(() => setMembers([]));
  }, [accessToken, demo, profile]);

  const loadFolder = useCallback(async (path: string) => {
    const key = `${ownerFilter}:${path}`;
    if (demo || loadedFolders.current.has(key)) return;
    loadedFolders.current.add(key);
    const revision = epoch.current;
    try {
      const items: KnowledgeDocument[] = [];
      for (let offset = 0; ; offset += 200) {
        const params = new URLSearchParams({view: "summary", limit: "200", offset: String(offset), folder: path, exactFolder: "true", scope: ownerFilter});
        if (ownerFilter.startsWith("member:")) params.set("owner", ownerFilter.slice(7));
        const result = await listDocuments(accessToken, params.toString());
        items.push(...result.documents);
        if (items.length >= result.total || !result.documents.length) break;
      }
      if (revision !== epoch.current) return;
      setDocuments(current => [...current, ...items.filter(item => !current.some(row => row.id === item.id))]);
    } catch (reason) {
      loadedFolders.current.delete(key);
      setError(reason instanceof Error ? reason.message : "폴더를 열지 못했습니다.");
    }
  }, [accessToken, demo, ownerFilter]);

  const reload = useCallback(async () => {
    if (demo) return;
    const revision = ++epoch.current;
    loadedFolders.current.clear();
    setListLoading(true);
    try {
      const result = await apiRequest<{folders: Array<{path: string; count: number}>}>(`/api/v1/documents/index?folders=true&scope=${encodeURIComponent(ownerFilter)}`, {token: accessToken});
      if (revision !== epoch.current) return;
      setInventory(result.folders);
      setDocuments(current => current.filter(row => row.id === selectedIdRef.current));
      await Promise.all([...expandedFolders].map(loadFolder));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "문서를 불러오지 못했습니다."); }
    finally { if (revision === epoch.current) setListLoading(false); }
  // Selection and expansion do not reload the folder inventory.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, demo, ownerFilter, loadFolder]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") { event.preventDefault(); openFinderRef.current(); }
      if (event.key === "Escape") { setQuickOpen(false); setLinkQuery(null); }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => {
    if (linkQuery === null || demo) { setLinkChoices([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      apiRequest<{documents: KnowledgeDocument[]}>(`/api/v1/documents/index?q=${encodeURIComponent(linkQuery)}`, {token: accessToken})
        .then(result => { if (active) setLinkChoices(result.documents); }).catch(() => { if (active) setLinkChoices([]); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [linkQuery, demo, accessToken]);
  useEffect(() => {
    if (!pendingAnchor || selected?.id !== pendingAnchor.id || selected.content_md === undefined) return;
    const frame = window.requestAnimationFrame(() => { revealHeading(`wiki-heading-${pendingAnchor.heading.normalize("NFC").trim()}`); setPendingAnchor(null); });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingAnchor, selected]);
  useEffect(() => {
    if (!selectedId || selected?.content_md !== undefined || demo) return;
    let active = true;
    getDocument(accessToken, selectedId)
      .then(({ document }) => { if (active) setDocuments(current => [...current.filter(item => item.id !== document.id), document]); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "문서 본문을 불러오지 못했습니다."));
    return () => { active = false; };
  }, [accessToken, demo, selected, selectedId]);

  useEffect(() => {
    if (!selected || mode !== "info") return;
    if (demo) { setVersions(getDemoKnowledgeVersions(selected.id)); return; }
    let active = true;
    setVersions([]);
    setVersionsLoading(true);
    listDocumentVersions(accessToken, selected.id)
      .then((result) => { if (active) setVersions(result.versions); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "변경 이력을 불러오지 못했습니다."))
      .finally(() => { if (active) setVersionsLoading(false); });
    return () => { active = false; };
  }, [accessToken, demo, mode, selected]);

  useEffect(() => {
    if (!selected || demo) { setBacklinks([]); return; }
    const params = new URLSearchParams({ view: "summary", limit: "50", q: `[[${selected.title}` });
    listDocuments(accessToken, params.toString())
      .then((result) => setBacklinks(result.documents.filter((item) => item.id !== selected.id)))
      .catch(() => setBacklinks([]));
  }, [accessToken, demo, selected]);

  const filtered = useMemo(() => documents.filter(document => inKnowledgeScope(document, ownerFilter, profile?.id)), [documents, ownerFilter, profile?.id]);

  const folderTree = useMemo(() => buildFolderTree(filtered, sortAscending, demo ? [] : inventory), [filtered, sortAscending, inventory, demo]);
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
  const readingContent = useMemo(() => prepareReadingContent(dirty ? draft?.content ?? "" : selected?.content_md ?? ""), [selected?.content_md, dirty, draft?.content]);
  const existingFolderOptions = useMemo(() => knowledgeFolderOptions([
    ...(demo ? [] : allFolders),
    ...inventory.map((item) => item.path),
    ...documents.map((document) => documentFolder(document)),
  ].filter((path) => path !== "분류 없음")), [documents, inventory, allFolders, demo]);
  const folderOptions = useMemo(() => existingFolderOptions, [existingFolderOptions]);

  useEffect(() => {
    if (searchParams.get("document") || selectedId || !filtered.length) return;
    if (!selectedId || !filtered.some((document) => document.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, searchParams, selectedId]);

  const openNewDocument = (folder = managedFolder || selected?.folder || "") => guardAction(() => {
    setNewFolderPath(folder); setNewError(""); setFieldErrors({}); setNewOpen(true);
  });
  const newDirty = Object.values(newValues).some(Boolean);
  const closeNewDocument = () => {
    if (busy) return;
    const close = () => { setNewValues({ title: "", content: "", brand: "", team: "", tags: "" }); setNewOpen(false); setNewError(""); };
    if (newDirty) setPendingNewAction(() => close); else close();
  };
  function guardAction(action: () => void) {
    if (busy) return;
    if (dirty) setPendingAction(() => action); else action();
  }
  const selectDocument = (id: string) => { if (id !== selectedId) guardAction(() => selectDocumentNow(id)); };
  function commitDocument(document: KnowledgeDocument, previous?: KnowledgeDocument) {
    if (demo) saveDemoKnowledgeDocument(document);
    const before = previous ?? documentsRef.current.find(row => row.id === document.id);
    documentsRef.current = [document, ...documentsRef.current.filter(row => row.id !== document.id)];
    setDocuments(documentsRef.current);
    setInventory(current => updateFolderInventory(current, before, document, ownerFilter, profile?.id));
    setAllFolders(current => knowledgeFolderOptions([...current, document.folder]));
    setExpandedFolders(current => new Set([...current, ...knowledgeFolderOptions([document.folder || "분류 없음"])]));
    epoch.current += 1; setListLoading(false);
    loadedFolders.current.clear();
    setRevision(value => value + 1);
  }
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 4500); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!dirty && !(newOpen && newDirty) && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (bypassUnload.current) return; event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const target = new URL(anchor.href); if (target.href === window.location.href || (target.pathname === location.pathname && target.search === location.search && target.hash)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (busy) return;
      if (newOpen && newDirty) setPendingNewAction(() => () => { bypassUnload.current = true; window.location.assign(anchor.href); });
      else guardAction(() => { bypassUnload.current = true; window.location.assign(anchor.href); });
    };
    const route = window.location.href; const routeState = window.history.state;
    const popstate = (event: PopStateEvent) => {
      const destination = window.location.href;
      event.stopImmediatePropagation(); window.history.pushState(routeState, "", route);
      if (busy) return;
      if (newOpen && newDirty) setPendingNewAction(() => () => { bypassUnload.current = true; window.location.assign(destination); });
      else guardAction(() => { bypassUnload.current = true; window.location.assign(destination); });
    };
    // Cancel traversal before the router sees popstate, keeping the edit screen mounted.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => {
      const traversal = event as Event & { navigationType: string; destination: {url: string} };
      if (bypassUnload.current || !["traverse", "reload"].includes(traversal.navigationType) || !event.cancelable) return;
      event.preventDefault();
      if (busy) return;
      const leave = () => { bypassUnload.current = true; window.location.assign(traversal.destination.url); };
      if (newOpen && newDirty) setPendingNewAction(() => leave); else guardAction(leave);
    };
    navigation?.addEventListener("navigate", navigate);
    window.addEventListener("popstate", popstate, true);
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => { navigation?.removeEventListener("navigate", navigate); window.removeEventListener("popstate", popstate, true); window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); };
  });
  useEffect(() => {
    if (demo || !accessToken || busy) return;
    let active = true;
    Promise.all([
      apiRequest<{ folders: Array<{path: string; count: number}> }>(`/api/v1/documents/index?folders=true&scope=${encodeURIComponent(ownerFilter)}`, { token: accessToken }),
      apiRequest<{ folders: Array<{path: string; count: number}> }>("/api/v1/documents/index?folders=true&scope=all", { token: accessToken }),
      apiRequest<{ total: number; folders: Array<{path: string; count: number}> }>("/api/v1/documents/index?folders=true&scope=archived", { token: accessToken }),
    ]).then(([current, all, archived]) => { if (active) { setInventory(current.folders); setAllFolders([...all.folders, ...archived.folders].map(item => item.path).filter(path => path !== "분류 없음")); setArchivedCount(archived.total); } }).catch(() => { if (active) setError("폴더 목록을 갱신하지 못했습니다. 목록 새로고침으로 다시 확인해 주세요."); });
    return () => { active = false; };
  }, [accessToken, demo, ownerFilter, revision, busy]);

  const moveDocument = async (documentId: string, folder: string) => {
    const item = documentsRef.current.find(document => document.id === documentId);
    if (!item || busy) return;
    setBusy(true); setError("");
    try {
      const destination = folder.trim() ? normalizeKnowledgeFolder(folder) : "";
      if (item.folder === destination) { setMoveOpen(false); return; }
      const document = demo ? { ...item, folder: destination, current_version: item.current_version + 1, updated_at: new Date().toISOString() } : (await updateDocument(accessToken, { id: item.id, expectedVersion: item.current_version, folder: destination, reason: "문서 위치 이동" })).document;
      commitDocument(document); discard(document.id); setMoveOpen(false);
      setToast(`문서를 ${destination || "분류 없음"}(으)로 이동했습니다.`);
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
    if (!selected || !draft || busy) return false;
    setBusy(true); setError("");
    try {
      const input = documentCreateSchema.parse({ ...draft, folder: draft.folder.trim() ? normalizeKnowledgeFolder(draft.folder) : "", tags: draft.tags.split(",").map(tag => tag.trim()).filter(Boolean) });
      const document = demo ? { ...selected, ...input, content_md: input.content, current_version: selected.current_version + 1, updated_at: new Date().toISOString() } : (await updateDocument(accessToken, { ...input, id: selected.id, expectedVersion: expectedVersion!, reason: "OS 문서 작업공간에서 수정" })).document;
      commitDocument(document); discard(document.id);
      setMode("read"); setToast("새 버전으로 저장했습니다."); return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "저장하지 못했습니다. 작성 내용은 유지됩니다.");
      if (reason instanceof ApiRequestError && reason.code === "VERSION_CONFLICT") {
        try { setConflict((await getDocument(accessToken, selected.id)).document); } catch { setError("최신 버전을 불러오지 못했습니다. 작성 내용은 유지됩니다. 다시 저장해 비교를 시도하세요."); }
      }
      return false;
    }
    finally { setBusy(false); }
  };

  const moveStatus = async (target: DocumentStatus) => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      let updated: KnowledgeDocument;
      if (demo) updated = { ...(documentsRef.current.find(item => item.id === selected.id) ?? selected), status: target, updated_at: new Date().toISOString() };
      else ({ document: updated } = await changeDocumentStatus(accessToken, selected.id, target));
      if (demo) addDemoKnowledgeEvent(updated, target === "review" ? "동료 검토를 요청했습니다." : target === "draft" && selected.status === "review" ? "작성자가 검토를 회수했습니다." : target === "draft" && selected.status === "archived" ? "휴지통 문서를 초안으로 복원했습니다." : "");
      commitDocument(updated);
      setArchiveConfirm(false);
      setToast(target === "archived" ? "휴지통으로 이동했습니다. 휴지통에서 초안으로 복원할 수 있습니다." : `${statusLabel(target)} 상태로 변경했습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "상태를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const beginEdit = () => {
    if (!selected) return;
    if (selected.status === "canonical") setCanonicalGate(true);
    else setMode("edit");
  };

  const restoreVersion = async (version: DocumentVersion) => {
    if (!selected || !compareBase) return;
    setBusy(true); setError("");
    try {
      let restored: KnowledgeDocument;
      const current = documentsRef.current.find(item => item.id === selected.id) ?? selected;
      if (demo) restored = { ...current, title: version.title, content_md: version.content_md, current_version: current.current_version + 1, updated_at: new Date().toISOString() };
      else ({ document: restored } = await restoreDocumentVersion(accessToken, selected.id, version.version_no, compareBase.current_version));
      setCompareVersion(null); setCompareBase(null);
      commitDocument(restored); discard(restored.id); setToast(`v${version.version_no} 내용을 새 버전으로 복원했습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "버전을 되돌리지 못했습니다."); }
    finally { setBusy(false); }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setNewError(""); setFieldErrors({});
    try {
      const parsed = documentCreateSchema.safeParse({ ...newValues, folder: newFolderPath.trim() ? normalizeKnowledgeFolder(newFolderPath) : "", tags: newValues.tags.split(",").map(tag => tag.trim()).filter(Boolean), source: "wiki" });
      if (!parsed.success) {
        const labels: Record<string, string> = { title: "제목은 1~200자", content: "본문은 1~1,500,000자", folder: "폴더 경로는 160자 이하", brand: "브랜드는 120자 이하", team: "팀은 120자 이하", tags: "태그는 최대 30개, 각각 1~60자" };
        setFieldErrors(Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), labels[String(issue.path[0])] || "입력값을 확인해 주세요."])));
        setNewError("표시된 항목을 수정한 뒤 다시 저장해 주세요."); return;
      }
      const input = parsed.data;
      if (!input.content.trim()) { setFieldErrors({content: "본문을 입력해 주세요."}); return; }
      const now = new Date().toISOString();
      const document: KnowledgeDocument = demo ? { id: `demo-${Date.now()}`, ...input, content_md: input.content, status: "draft", source_ref: null, owner_id: profile?.id ?? "demo-ricky", created_by: profile?.id ?? "demo-ricky", current_version: 1, created_at: now, updated_at: now } : (await createDocument(accessToken, input)).document;
      commitDocument(document); setOwnerFilter("all"); selectDocumentNow(document.id); setNewOpen(false);
      setNewValues({title: "", content: "", brand: "", team: "", tags: ""}); setNewFolderPath("");
      setToast("개인 초안으로 저장했습니다.");
    } catch (reason) { setNewError(reason instanceof Error ? reason.message : "문서를 만들지 못했습니다. 입력 내용은 유지됩니다."); }
    finally { setBusy(false); }
  };

  const openWikiLink = async (title: string) => {
    try {
      const target = demo ? resolveWikiLink(title, documents, selected?.folder) :
        (await apiRequest<{document: KnowledgeDocument | null}>(`/api/v1/documents/index?target=${encodeURIComponent(title)}&folder=${encodeURIComponent(selected?.folder ?? "")}`, {token: accessToken})).document;
      if (!target) { setToast(`“${title}” 문서가 없거나 같은 이름이 여러 개입니다. 빠른 열기에서 선택해 주세요.`); return; }
      const heading = title.split("|")[0].split("#").slice(1).join("#");
      if (heading) setPendingAnchor({ id: target.id, heading });
      selectDocument(target.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "연결 문서를 열지 못했습니다."); }
  };
  const chooseLink = (document: KnowledgeDocument) => {
    if (quickOpen) { selectDocument(document.id); setQuickOpen(false); }
    else if (draft && editorRef.current) {
      const end = editorRef.current.selectionStart;
      const start = draft.content.lastIndexOf("[[", end);
      if (start >= 0) setDraft({...draft, content: draft.content.slice(0, start) + `[[${document.source_ref?.replace(/\\/g, "/").replace(/\.md$/i, "") || document.title}]]` + draft.content.slice(end).replace(/^\]\]/, "")});
    }
    setLinkQuery(null);
  };
  const treeStart = Math.max(0, Math.min(Math.floor(treeScroll / 44) - 8, treeRows.length - 45));
  const visibleRows = treeRows.slice(treeStart, treeStart + 45);

  return (
    <>
      <header className="page-header workspace-page-header">
        <div className="page-title-group"><span className="eyebrow">지식 작업공간</span><h1>문서 작업공간</h1><p>개인의 경험을 쌓고, 검토를 거쳐 회사가 함께 쓰는 정본으로 만듭니다.</p></div>
        <div className="header-actions"><button className="secondary-button" onClick={() => guardAction(() => setFinderOpen(true))}>문서 찾기</button><button className="secondary-button knowledge-tree-toggle" aria-pressed={treeOpen} onClick={() => setTreeOpen((value) => !value)}>{treeOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />} {treeOpen ? "파일 트리 숨기기" : "파일 트리 보기"}</button><button className="secondary-button" aria-pressed={focusMode} onClick={() => setFocusMode((value) => !value)}>{focusMode ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />} {focusMode ? "전체 메뉴 보기" : "집중 모드"}</button><button className="secondary-button" onClick={() => guardAction(() => { setImportOpen(true); })}><Upload size={16} /> Markdown 가져오기</button><button className="primary-button" onClick={() => openNewDocument()}><FilePlus2 size={16} /> 새 문서</button></div>
      </header>


      {focusMode ? <nav className="knowledge-focus-tabs" aria-label="지식 메뉴"><Link aria-current="page" href="/knowledge">문서 작업공간</Link><Link href="/knowledge/search">지식 검색</Link><Link href="/knowledge/review">검토함</Link><Link href="/knowledge/development">개발 관리</Link><Link href="/knowledge/skills">Skill 관리</Link><Link href="/knowledge/graph">지식 연결</Link></nav> : null}

      <div className="owner-chips">
        {OWNER_FILTERS.map((item) => <button key={item.id} className={ownerFilter === item.id ? "active" : ""} onClick={() => guardAction(() => { setCheckedIds(new Set()); setOwnerFilter(item.id); })}>{item.label}</button>)}
        {members.length > 1 ? <label className={ownerFilter.startsWith("member:") ? "active" : ""}><UserRound size={13} /><select aria-label="문서 소유자" value={ownerFilter.startsWith("member:") ? ownerFilter : ""} onChange={(event) => { const value = event.target.value; if (value) guardAction(() => setOwnerFilter(value)); }}><option value="">소유자 선택</option>{members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.display_name || member.email.split("@")[0]}</option>)}</select></label> : null}
      </div>
      {error ? <div className="inline-alert danger">{error}<button onClick={() => setError("")}><X size={14} /></button></div> : null}

      <section style={{ "--knowledge-tree-width": `${paneWidth}px` } as React.CSSProperties} className={`knowledge-workspace${!treeOpen ? " tree-hidden" : ""}${hoverTree ? " tree-peek" : ""}`}>
        {!treeOpen ? <button className="tree-peek-handle" aria-label="파일 트리 잠시 보기" onMouseEnter={() => setHoverTree(true)} onFocus={() => setHoverTree(true)} onClick={() => setTreeOpen(true)}><PanelLeftOpen size={16} /></button> : null}
        {treeOpen ? <button className="knowledge-tree-scrim" aria-label="파일 트리 닫기" onClick={() => setTreeOpen(false)} /> : null}
        <aside onMouseLeave={() => setHoverTree(false)} className={`folder-pane knowledge-tree-pane${treeOpen ? " mobile-open" : ""}`}>
          <div role="separator" aria-label="파일 트리 폭" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={460} aria-valuenow={paneWidth} tabIndex={0} className="knowledge-resize-handle" onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setPaneWidth(treeWidth(event.clientX - (event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0))); }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); setPaneWidth((width) => event.key === "Home" ? 220 : event.key === "End" ? 460 : treeWidth(width + (event.key === "ArrowRight" ? 20 : -20))); } }} />
          <div className="pane-title"><span><FolderOpen size={15} /><strong>파일 트리</strong><small>{demo ? filtered.length : inventory.reduce((sum, item) => sum + item.count, 0)}개</small></span>{hoverTree && !treeOpen ? <button onClick={() => { setTreeOpen(true); setHoverTree(false); }} aria-label="파일 트리 고정">고정</button> : null}<button title="폴더 관리" aria-label="폴더 관리" onClick={() => guardAction(() => { setError(""); setManagedFolder((current) => existingFolderOptions.includes(current) ? current : existingFolderOptions[0] ?? ""); setFolderManagerOpen(true); })}><FolderCog size={14} /></button><button aria-label="트리 안에서 접기" onClick={() => { setTreeOpen(false); setHoverTree(false); }}><PanelLeftClose size={14} /></button><button aria-label="폴더 안 문서 정렬" onClick={() => setSortAscending((value) => !value)}>폴더 내 {sortAscending ? "오래된 순" : "최근 순"} <ChevronDown size={12} /></button></div>
          <div className="knowledge-bulk-actions"><button className="ghost-button" disabled={busy} onClick={() => { void reload(); setRevision(value => value + 1); }}>목록 새로고침</button>{checkedIds.size ? <button className="secondary-button" disabled={busy} onClick={() => guardAction(() => { setMoveIds([...checkedIds]); setMoveOpen(true); })}>선택 {checkedIds.size}개 이동</button> : null}</div>
          <div className="knowledge-tree-scroll" onScroll={event => setTreeScroll(event.currentTarget.scrollTop)}>
            {listLoading && !documents.length ? <div className="list-empty"><File size={22} /><span>문서 불러오는 중</span></div> : null}
            {treeStart > 0 ? <div style={{height: treeStart * 44}} /> : null}
            {visibleRows.map((row) => row.type === "folder" ? (
              <div className="folder-tree-item" key={`folder-${row.folder.path}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/document-id"); guardAction(() => { void moveDocument(id, row.folder.path); }); }}>
                <button className={`folder-row folder-tree-row${managedFolder === row.folder.path ? " active" : ""}`} style={{ paddingLeft: 10 + row.depth * 16 }} onClick={() => { const opening = !expandedFolders.has(row.folder.path); setManagedFolder(row.folder.path); setExpandedFolders((current) => { const next = new Set(current); if (opening) next.add(row.folder.path); else next.delete(row.folder.path); return next; }); if (opening) void loadFolder(row.folder.path); }}>{expandedFolders.has(row.folder.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={15} /><span>{row.folder.name}</span><small>{row.folder.count}</small></button>
                <button className="folder-inline-action" title={`${row.folder.path}에 새 문서`} aria-label={`${row.folder.path}에 새 문서`} onClick={() => openNewDocument(row.folder.path)}><FolderPlus size={14} /></button><button className="folder-inline-action" aria-label={`${row.folder.path} 폴더 관리`} onClick={() => guardAction(() => { setManagedFolder(row.folder.path); setFolderManagerOpen(true); })}><FolderCog size={14} /></button>
              </div>
            ) : (
              <div className="document-tree-select-row" key={row.document.id}><input type="checkbox" aria-label={`${row.document.title} 선택`} checked={checkedIds.has(row.document.id)} disabled={busy} onChange={event => { const checked = event.target.checked; setCheckedIds(current => { const next = new Set(current); if (checked) next.add(row.document.id); else next.delete(row.document.id); return next; }); }} /><button draggable className={`folder-row document-tree-row${row.document.id === selectedId ? " active" : ""}`} style={{ paddingLeft: 20 + row.depth * 16 }} onDragStart={(event) => event.dataTransfer.setData("text/document-id", row.document.id)} onClick={() => { selectDocument(row.document.id); if (window.innerWidth < 900) setTreeOpen(false); }}>
                <span className="tree-spacer" /><File size={14} /><span><strong>{row.document.title}</strong>{row.document.owner_id !== profile?.id && row.document.status !== "canonical" ? <em>{ownerNames.get(row.document.owner_id) || "소유자 미지정"}</em> : null}</span><i className={`mini-status status-${row.document.status}`} />
              </button></div>
            ))}
            <div style={{height: Math.max(0, treeRows.length - treeStart - visibleRows.length) * 44}} />
            {!treeRows.length && !listLoading ? <div className="list-empty"><File size={22} /><span>조건에 맞는 문서가 없습니다.</span></div> : null}
          </div>
          <div className="folder-divider" />
          <button className={`folder-row${ownerFilter === "archived" ? " active" : ""}`} onClick={() => guardAction(() => setOwnerFilter("archived"))}><Trash2 size={15} /><span>휴지통</span><small>{demo ? documents.filter((item) => item.status === "archived").length : archivedCount}</small></button>
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
                  {selected.status !== "archived" ? <button className="secondary-button compact" onClick={() => { guardAction(() => { setError(""); setMoveIds(selected ? [selected.id] : []); setMoveOpen(true); }); }} disabled={busy}><MoveRight size={14} /> 위치 이동</button> : null}
                  {(selected.owner_id === profile?.id || profile?.role === "admin") && nextStatus(selected.status) && statusActionLabel(selected.status) ? <button className="secondary-button compact" onClick={() => guardAction(() => moveStatus(nextStatus(selected.status)!))} disabled={busy}><Send size={14} /> {statusActionLabel(selected.status)}</button> : null}
                  {(selected.owner_id === profile?.id || profile?.role === "admin") && ["draft", "team", "review", "reviewed"].includes(selected.status) ? <button className="primary-button compact" onClick={() => guardAction(() => moveStatus("canonical"))} disabled={busy}><BookCheck size={14} /> 회사 정본으로</button> : null}
                  {selected.status === "review" ? <><Link className="secondary-button compact" href={`/knowledge/review?document=${selected.id}`}>검토함에서 보기</Link>{selected.owner_id === profile?.id || profile?.role === "admin" ? <button className="secondary-button compact" disabled={busy} onClick={() => guardAction(() => moveStatus("draft"))}>검토 회수 (초안)</button> : null}</> : null}
                  <button className="icon-button" title="문서 정보" aria-label="문서 정보" onClick={() => setMode("info")}><MoreHorizontal size={17} /></button>
                </div>
              </div>
              <div className="document-meta-line"><span className={`status-pill status-${selected.status}`}>{statusLabel(selected.status)}</span><span>v{selected.current_version}</span><span>마지막 수정 {formatDate(selected.updated_at)}</span>{dirty ? <strong role="status">저장하지 않은 변경 있음</strong> : null}</div>
              {mode === "edit" ? (
                <div className="document-editor">
                  {selected.status === "canonical" ? <div className="canonical-edit-banner"><ShieldAlert size={18} /><span><strong>회사 정본을 편집하고 있습니다.</strong><small>저장하면 전 직원과 AI 검색에 반영되며, 이전 내용은 버전으로 보존됩니다.</small></span></div> : null}
                  <input className="title-input" maxLength={200} disabled={busy} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} aria-label="문서 제목" />
                  <div className="meta-input-grid">
                    <KnowledgeFolderPicker options={folderOptions} value={draft.folder} onChange={folder => setDraft({ ...draft, folder })} disabled={busy} />
                    <label><span><UserRound size={13} /> 팀</span><input list="knowledge-team-options" disabled={busy} maxLength={120} value={draft.team} onChange={(event) => setDraft({ ...draft, team: event.target.value })} /></label>
                    <label><span><BookCheck size={13} /> 브랜드</span><input list="knowledge-brand-options" disabled={busy} maxLength={120} value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label>
                    <label><span><Tag size={13} /> 태그</span><input disabled={busy} maxLength={1859} value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="쉼표로 구분" /></label>
                  </div>
                  <div className="markdown-toolbar" aria-label="마크다운 도구"><button type="button" title="제목" onClick={() => applyMarkdown("## ", "", "제목")}><Hash size={14} /></button><button type="button" title="굵게" onClick={() => applyMarkdown("**", "**")}><Bold size={14} /></button><button type="button" title="목록" onClick={() => applyMarkdown("- ", "")}><List size={14} /></button><button type="button" title="인용" onClick={() => applyMarkdown("> ", "")}><Quote size={14} /></button><button type="button" title="표" onClick={() => applyMarkdown("| 항목 | 내용 |\n| --- | --- |\n| ", " |", "값")}><Table2 size={14} /></button><button type="button" title="위키링크" onClick={() => applyMarkdown("[[", "]]", "문서명")}><Link2 size={14} /></button></div>
                  <textarea disabled={busy} maxLength={1500000} ref={editorRef} value={draft.content} onChange={(event) => { setDraft({ ...draft, content: event.target.value }); setLinkQuery(event.target.value.slice(0, event.target.selectionStart).match(/\[\[([^\]\n]*)$/)?.[1] ?? null); setTagQuery(event.target.value.slice(0, event.target.selectionStart).match(/(?:^|\s)#([^\s#]*)$/u)?.[1] ?? null); }} aria-label="문서 본문" spellCheck="false" />
                  {tagQuery !== null ? <div aria-label="태그 제안">{[...new Set(documents.flatMap((document) => document.tags))].filter((tag) => tag.toLowerCase().includes(tagQuery.toLowerCase())).slice(0, 8).map((tag) => <button key={tag} type="button" className="ghost-button" onClick={() => { const inserted = insertTag(draft.content, editorRef.current?.selectionStart ?? 0, tag); setDraft({ ...draft, content: inserted.content }); setTagQuery(null); requestAnimationFrame(() => { editorRef.current?.focus(); editorRef.current?.setSelectionRange(inserted.caret, inserted.caret); }); }}>#{tag}</button>)}</div> : null}
                </div>
              ) : mode === "info" ? (
                <div className="document-info">
                  <h2>문서 정보</h2>
                  <dl><div><dt>상태</dt><dd>{statusLabel(selected.status)}</dd></div><div><dt>소유자</dt><dd>{ownerNames.get(selected.owner_id) || "소유자 미지정"}</dd></div><div><dt>현재 버전</dt><dd>v{selected.current_version}</dd></div><div><dt>폴더</dt><dd>{selected.folder || "분류 없음"}</dd></div><div><dt>브랜드</dt><dd>{selected.brand || "전체"}</dd></div><div><dt>담당 팀</dt><dd>{selected.team || "전체"}</dd></div><div><dt>원본</dt><dd>{selected.source}</dd></div></dl>
                  <h3>문서 상태 흐름</h3><p>동료 검토는 선택 사항입니다. 작성자는 기존처럼 정본으로 바로 공개할 수 있습니다.</p><div className="status-flow">{STATUS_FLOW.map((status, index) => <div key={status} className={selected.status === "canonical" || STATUS_FLOW.indexOf(selected.status) >= index ? "done" : ""}><span>{index + 1}</span><small>{statusLabel(status)}</small></div>)}</div>
                  <KnowledgeReviewHistory id={selected.id} token={accessToken} demo={demo} revision={selected.updated_at} />
                  <h3>변경 이력</h3>
                  <div className="version-history">{versionsLoading ? <div className="quiet-state">변경 이력을 불러오는 중입니다.</div> : versions.map((version) => <div key={version.version_no}><span><strong>v{version.version_no} · {version.author_name}</strong><small>{formatDate(version.created_at)}{version.reason ? ` · ${version.reason}` : ""}</small></span>{version.version_no !== selected.current_version ? <button className="ghost-button" disabled={busy} onClick={() => guardAction(() => {setError(""); setCompareBase(documentsRef.current.find(item => item.id === selected.id) ?? selected); setCompareVersion(version);})}><RotateCcw size={13} /> 비교·복원</button> : <em>현재</em>}</div>)}</div>
                  <h3>문서 연결</h3><div className="knowledge-links"><div><strong>나가는 링크</strong>{wikiLinks(selected.content_md).map((link) => <span key={link}><Link2 size={12} /> {link}</span>)}{!wikiLinks(selected.content_md).length ? <small>본문에 [[문서명]]을 입력하면 연결됩니다.</small> : null}</div><div><strong>백링크</strong>{backlinks.map((item) => <button key={item.id} onClick={() => { selectDocument(item.id); }}><Link2 size={12} /> {item.title}</button>)}{!backlinks.length ? <small>이 문서를 가리키는 문서가 없습니다.</small> : null}</div></div>
                  {selected.status !== "archived" ? <button className="ghost-button archive-action" onClick={() => guardAction(() => {setError("");setArchiveConfirm(true);})}><Archive size={15} /> 휴지통으로 이동</button> : <button className="ghost-button archive-action" onClick={() => guardAction(() => {setError("");setArchiveConfirm(true);})}><RotateCcw size={15} /> 초안으로 복원</button>}
                </div>
              ) : (
                <div className="document-reader">{dirty ? <p className="inline-alert">미저장 내용 미리보기 · 저장해야 다른 사람에게 반영됩니다.</p> : null}<h1>{dirty ? draft.title : selected.title}</h1><div className="reader-tags">{selected.tags.map((tag) => <span key={tag}><Hash size={11} />{tag}</span>)}</div>{readingContent.metadata.length ? <details className="reader-metadata"><summary>문서 속성 {readingContent.metadata.length}개</summary><dl>{readingContent.metadata.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><WikiInline text={item.value} onOpenLink={openWikiLink} /></dd></div>)}</dl></details> : null}<MarkdownView key={selected.id} content={readingContent.body} onOpenLink={openWikiLink} /><DevelopmentDocumentLiveLog token={accessToken} documentId={selected.id} demo={demo} /></div>
              )}
            </>
          ) : (
            <div className="empty-state"><div><span><FilePenLine /></span><h3>문서를 선택하세요</h3><p>파일 트리에서 열거나 새 문서를 만들어 시작할 수 있습니다.</p><button className="primary-button" onClick={() => openNewDocument()}>새 문서</button></div></div>
          )}
        </article>
      </section>

      {(quickOpen || (mode === "edit" && linkQuery !== null)) ? <div className="document-quick-open" role="dialog" aria-label={quickOpen ? "문서 빠른 열기" : "문서 링크 자동완성"}>
        <button className="icon-button" aria-label="빠른 열기 닫기" onClick={() => { setQuickOpen(false); setLinkQuery(null); }}><X size={16}/></button>
        <input autoFocus aria-label="문서 찾기" value={linkQuery ?? ""} onChange={event => setLinkQuery(event.target.value)} placeholder="문서 이름 또는 원본 파일명" />
        {linkChoices.map(item => <button key={item.id} onClick={() => chooseLink(item)}><strong>{item.title}</strong><small>{item.source_ref || item.folder}</small></button>)}
      </div> : null}
      {newOpen && !pendingNewAction ? <KnowledgeModal title="새 문서 만들기" onClose={closeNewDocument} busy={busy}>
        <form className="form-modal new-document-modal" onSubmit={create}>
          <header><h2>새 문서 만들기</h2><button type="button" aria-label="새 문서 닫기" disabled={busy} onClick={closeNewDocument}><X size={18} /></button></header>
          <div className="form-fields">
            {newError ? <div role="alert" className="inline-alert danger wide">{newError}</div> : null}
            <div className="wide"><KnowledgeFolderPicker options={folderOptions} value={newFolderPath} onChange={setNewFolderPath} disabled={busy} /></div>
            {(["title", "content", "team", "brand", "tags"] as const).map(field => <label key={field} className={["title", "content"].includes(field) ? "wide" : ""}>
              <span>{{title: "문서 제목", content: "본문", team: "담당 팀", brand: "브랜드", tags: "태그 (쉼표로 구분)"}[field]}</span>
              {field === "content" ? <textarea required maxLength={1500000} disabled={busy} value={newValues[field]} onChange={event => setNewValues(current => ({...current, [field]: event.target.value}))} aria-invalid={Boolean(fieldErrors[field])} /> : <input required={field === "title"} maxLength={field === "title" ? 200 : field === "tags" ? 1859 : 120} disabled={busy} value={newValues[field]} onChange={event => setNewValues(current => ({...current, [field]: event.target.value}))} aria-invalid={Boolean(fieldErrors[field])} />}
              {fieldErrors[field] ? <small role="alert">{fieldErrors[field]}</small> : null}
            </label>)}
          </div>
          <footer><span>개인 초안으로 저장됩니다.</span><div><button type="button" className="ghost-button" disabled={busy} onClick={closeNewDocument}>취소</button><button className="primary-button" disabled={busy}>{busy ? "저장 중…" : "초안 저장"}</button></div></footer>
        </form>
      </KnowledgeModal> : null}
      {pendingNewAction ? <KnowledgeModal title="작성 중인 새 문서" onClose={() => setPendingNewAction(null)}>
        <div className="form-modal"><header><h2>작성 중인 새 문서가 있습니다</h2></header><div className="form-fields"><p>아직 저장하지 않았습니다. 계속 작성하거나 내용을 버리고 닫을 수 있습니다.</p></div><footer>
          <button className="ghost-button" onClick={() => setPendingNewAction(null)}>계속 작성</button>
          <button className="secondary-button" onClick={() => { const action = pendingNewAction; setPendingNewAction(null); action(); }}>버리고 닫기</button>
        </footer></div>
      </KnowledgeModal> : null}
      {pendingAction ? <KnowledgeModal title="저장하지 않은 변경" onClose={() => setPendingAction(null)} busy={busy}>
        <div className="form-modal"><header><h2>저장하지 않은 변경이 있습니다</h2></header><div className="form-fields"><p>변경을 저장한 뒤 계속하거나, 버리고 이동할 수 있습니다.</p>{error ? <p role="alert" className="inline-alert danger">{error}</p> : null}</div><footer>
          <button className="ghost-button" disabled={busy} onClick={() => setPendingAction(null)}>계속 편집</button>
          <button className="secondary-button" disabled={busy} onClick={() => { discard(); const action = pendingAction; setPendingAction(null); action(); }}>변경 버리기</button>
          <button className="primary-button" disabled={busy} onClick={async () => { const action = pendingAction; if (await save()) { setPendingAction(null); action(); } }}>저장하고 계속</button>
        </footer></div>
      </KnowledgeModal> : null}
      {moveOpen ? <KnowledgeDocumentMover documents={documents.filter(document => moveIds.includes(document.id))} options={folderOptions} token={accessToken} demo={demo} onSaved={(document, previous) => { commitDocument(document, previous); discard(document.id); }} onBusy={setBusy} onClose={() => { setMoveOpen(false); setCheckedIds(new Set()); }} /> : null}
      {folderManagerOpen ? <KnowledgeFolderManager source={managedFolder} options={folderOptions} documents={documents} token={accessToken} demo={demo} onClose={() => setFolderManagerOpen(false)} onSaved={commitDocument} onBusy={setBusy} onNew={folder => { setFolderManagerOpen(false); openNewDocument(folder); }} /> : null}
      {canonicalGate ? <KnowledgeModal title="회사 정본 편집 안내" onClose={() => setCanonicalGate(false)}><div className="canonical-gate-modal"><ShieldAlert size={28} /><h2>회사 정본을 편집합니다</h2><p>이 문서는 전 직원과 AI가 함께 사용하는 회사 기준입니다. 수정하면 검색 결과와 연결된 업무에 반영됩니다.</p><div className="drawer-actions"><button className="ghost-button" onClick={() => setCanonicalGate(false)}>취소</button><button className="primary-button" onClick={() => { setCanonicalGate(false); setMode("edit"); }}>내용을 확인했고 편집하기</button></div></div></KnowledgeModal> : null}
      {finderOpen ? <KnowledgeDocumentFinder token={accessToken} demo={demo} onClose={() => setFinderOpen(false)} onSelect={document => {setDocuments(current => current.some(row => row.id === document.id) ? current : [document,...current]); setOwnerFilter(document.status === "archived" ? "archived" : "all"); selectDocumentNow(document.id); setFinderOpen(false); setTreeOpen(false);}} /> : null}
      {importOpen ? <KnowledgeImport token={accessToken} demo={demo} ownerId={profile?.id ?? "demo-ricky"} team={profile?.team ?? ""} options={folderOptions} onSaved={commitDocument} onBusy={setBusy} onClose={() => setImportOpen(false)} /> : null}
      {compareVersion && compareBase ? <KnowledgeVersionComparison title="이전 버전 비교·복원" left={{label:`v${compareVersion.version_no} 복원할 내용`,title:compareVersion.title,content:compareVersion.content_md}} right={{label:`현재 v${compareBase.current_version}`,title:compareBase.title,content:compareBase.content_md}} action={`v${compareVersion.version_no} 내용을 새 버전으로 복원`} busy={busy} error={error} onClose={() => {setCompareVersion(null);setCompareBase(null);}} onAction={() => void restoreVersion(compareVersion)} /> : null}
      {conflict && draft ? <KnowledgeVersionComparison title="저장 충돌 · 작성 내용 유지됨" left={{label:`최신 v${conflict.current_version}`,title:conflict.title,content:conflict.content_md,properties:{폴더:conflict.folder,팀:conflict.team,브랜드:conflict.brand,태그:conflict.tags.join(", ")}}} right={{label:"내 미저장 내용",title:draft.title,content:draft.content,properties:{폴더:draft.folder,팀:draft.team,브랜드:draft.brand,태그:draft.tags}}} action="내 내용을 유지하고 최신 버전 기준으로 계속 편집" busy={busy} error="이 버튼은 저장하지 않습니다. 최신 내용과 내 내용을 비교·수정한 뒤 다시 저장하세요. 직접 변경한 값은 유지하고, 변경하지 않은 분류 항목은 최신 값으로 맞춥니다." onClose={() => setConflict(null)} onAction={() => {commitDocument(conflict);rebase(conflict);setConflict(null);setError("");setMode("edit");}} /> : null}
      {archiveConfirm && selected ? <KnowledgeModal title={selected.status === "archived" ? "초안으로 복원" : "휴지통으로 이동"} onClose={() => setArchiveConfirm(false)} busy={busy}><div className="form-modal"><header><h2>{selected.status === "archived" ? "초안으로 복원" : "휴지통으로 이동"}</h2></header><div className="form-fields"><p className="wide"><strong>{selected.title}</strong><br/>{selected.status === "archived" ? "개인 초안으로 복원합니다. 이전 팀 공유·회사 정본 상태는 자동으로 복원하지 않습니다." : "활성 문서 목록과 검색에서 제외합니다. 본문과 변경 이력은 보존되며, 휴지통에서 초안으로 복원할 수 있습니다."}</p>{error ? <p role="alert" className="inline-alert danger">{error}</p> : null}</div><footer><button className="secondary-button" disabled={busy} onClick={() => setArchiveConfirm(false)}>취소</button><button className="primary-button" disabled={busy} onClick={() => void moveStatus(selected.status === "archived" ? "draft" : "archived")}>{busy ? "처리 중…" : selected.status === "archived" ? "초안으로 복원" : "휴지통으로 이동"}</button></footer></div></KnowledgeModal> : null}
      <datalist id="knowledge-team-options">{[...new Set([...members.map(member => member.team), ...documents.map(document => document.team)].filter(Boolean))].sort().map(value => <option key={value} value={value}/>)}</datalist>
      <datalist id="knowledge-brand-options">{[...new Set(documents.map(document => document.brand).filter(Boolean))].sort().map(value => <option key={value} value={value}/>)}</datalist>
      {toast ? <button className="toast" onClick={() => setToast("")}><CircleCheck size={16} /> {toast}</button> : null}
    </>
  );
}

export function KnowledgeWorkspace() {
  return <Suspense><WorkspaceContent /></Suspense>;
}
