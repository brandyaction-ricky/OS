"use client";

import { PageTitle } from "./page-title";

import { markdownBlocks, markdownCodeBody, markdownSections, treeWidth, type MarkdownSection } from "@/lib/markdown-sections";
import { parseKnowledgeToggle } from "@/lib/knowledge-toggle";
import { canReparentKnowledgePage, knowledgePageDescendants } from "@/lib/knowledge-pages";

import {
  Archive,
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
  Images,
  Link2,
  MoreHorizontal,
  MoveRight,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldAlert,
  Tag,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiRequestError, apiRequest, changeDocumentStatus, createDocument, createKnowledgeAttachmentUpload, deleteKnowledgeAttachment, finalizeKnowledgeAssetUpload, getDocument, knowledgeAssetSha256, listDocuments, listDocumentVersions, listMembers, moveKnowledgePage, prepareKnowledgeAssetUpload, restoreDocumentVersion, setDocumentSteward, updateDocument, uploadKnowledgeAttachment, type OsMember } from "@/lib/api-client";
import { knowledgeAttachmentMarkdown } from "@/lib/knowledge-attachments";
import { resolveWikiLink } from "@/lib/knowledge-links";
import { knowledgeFolderOptions, normalizeKnowledgeFolder } from "@/lib/knowledge-folders";
import { PERSONAL_VAULT_ROOTS, stableWikiLink } from "@/lib/knowledge-vault";
import { canEditVaultDocument, matchesVaultName, newVaultFolder, selectedVaultDocuments, vaultFolderKey } from "@/lib/knowledge-vault-interactions";
import { useVaultFolders } from "@/hooks/use-vault-folders";
import { KnowledgeVaultFolderChooser } from "./knowledge-vault-folder-chooser";
import { KnowledgeVaultProperties } from "./knowledge-vault-properties";
import { documentCreateSchema } from "@/lib/validation";
import { updateFolderInventory, inKnowledgeScope } from "@/lib/knowledge-workspace-state";
import { useKnowledgeDraft } from "@/hooks/use-knowledge-draft";
import { KnowledgeFolderPicker } from "./knowledge-folder-picker";
import { KnowledgeInlineProvider, WikiInline } from "./knowledge-inline";
import { KnowledgeReviewHistory } from "./knowledge-review-history";
import { KnowledgeDocumentMover } from "./knowledge-document-mover";
import { KnowledgeFolderManager } from "./knowledge-folder-manager";
import { KnowledgeDocumentFinder } from "./knowledge-document-finder";
import { KnowledgeImport } from "./knowledge-import";
import { KnowledgeVersionComparison } from "./knowledge-version-comparison";
import { KnowledgeModal } from "./knowledge-modal";
import { KnowledgeRichEditor, type KnowledgeRichEditorMethods } from "./knowledge-rich-editor";
import { KnowledgeGallery } from "./knowledge-gallery";
import { KnowledgeVaultFolderView } from "./knowledge-vault-folder-view";
import { KnowledgeImageRecovery } from "./knowledge-image-recovery";
import { dispatchKnowledgeFileDropPosition } from "./knowledge-image-drag-plugin";
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
type TreeRow = { type: "folder"; folder: FolderTreeNode; depth: number } | { type: "document"; document: KnowledgeDocument; depth: number; childCount: number };

function documentFolder(document: KnowledgeDocument) {
  if (document.folder) return document.folder;
  return "분류 없음";
}

function buildFolderTree(documents: KnowledgeDocument[], sortAscending: boolean, inventory: Array<{path: string; count: number}> = [], defaults: readonly string[] = []) {
  const roots: FolderTreeNode[] = [];
  const entries = [...defaults.map(path => ({path, count: 0})), ...(inventory.length ? inventory : documents.map(document => ({path: documentFolder(document), count: 1})))];
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
        const toggle = parseKnowledgeToggle(block);
        if (toggle) return <details className="knowledge-toggle-block" key={index}><summary><WikiInline text={toggle.title} onOpenLink={onOpenLink} /></summary><MarkdownBlocks content={toggle.body} onOpenLink={onOpenLink} /></details>;
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

export function MarkdownView({ content, onOpenLink }: { content: string; onOpenLink: (title: string) => void }) {
  const root = useMemo(() => markdownSections(content), [content]);
  const headings: MarkdownSection[] = [];
  const collect = (section: MarkdownSection) => { if (section.title) headings.push(section); section.children.forEach(collect); };
  collect(root);
  return <>{headings.length ? <details className="document-outline"><summary>문서 목차 · {headings.length}개</summary><nav aria-label="문서 목차">{headings.map((heading, index) => <button key={index} className="ghost-button" style={{ paddingLeft: heading.level * 10 }} onClick={() => revealHeading(`wiki-heading-${heading.title.normalize("NFC").trim()}`)}>{heading.title}</button>)}</nav></details> : null}<MarkdownBlocks content={root.body} onOpenLink={onOpenLink} />{root.children.map((section, index) => <MarkdownSectionView key={index} section={section} onOpenLink={onOpenLink} />)}</>;
}

function WorkspaceContent({ vault = false }: { vault?: boolean }) {
  const searchParams = useSearchParams();
  const { demo, accessToken, profile } = useSession();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>(() => demo ? getDemoKnowledgeDocuments() : []);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("document"));
  const [ownerFilter, setOwnerFilter] = useState(vault || Boolean(searchParams.get("document")) ? "all" : "mine_company");
  const [members, setMembers] = useState<OsMember[]>([]);
  const [mode, setMode] = useState<"read" | "edit" | "info">("read");
  const [workspaceView, setWorkspaceView] = useState<"document" | "folder" | "gallery">(vault && !searchParams.get("document") ? "folder" : "document");
  const [treeFilter, setTreeFilter] = useState("");
  const [folderSort, setFolderSort] = useState<"recent" | "name" | "old">("recent");
  const [vaultPanelOpen, setVaultPanelOpen] = useState(true);
  const [vaultPanelTab, setVaultPanelTab] = useState<"toc" | "info" | "links" | "versions">("toc");
  const selected = documents.find((document) => document.id === selectedId) ?? null;
  const { draft, setDraft, dirty, discard, rebase, expectedVersion, recovery, resume } = useKnowledgeDraft(selected, { enabled: vault, account: profile?.id ?? "" });
  const pendingFolders = useVaultFolders(profile?.id, vault);
  const [folderInput, setFolderInput] = useState<{ parent: string; value: string } | null>(null);
  const [inlineRename, setInlineRename] = useState<{ key: string; value: string; surface: "tree" | "table" } | null>(null);
  const [folderManagerName, setFolderManagerName] = useState<string>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [draggedDocument, setDraggedDocument] = useState("");
  const [dropTargetDocument, setDropTargetDocument] = useState("");
  const renaming = useRef(false);
  const [moveUndo, setMoveUndo] = useState<{ id: string; folder: string } | null>(null);
  const selectionAnchor = useRef<string | null>(null);
  const newEditorRef = useRef<KnowledgeRichEditorMethods | null>(null);
  const [focusNewBody, setFocusNewBody] = useState(false);
  const [editorRecoveryRevision, setEditorRecoveryRevision] = useState(0);
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const bypassUnload = useRef(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [pendingNewAction, setPendingNewAction] = useState<(() => void) | null>(null);
  const [newValues, setNewValues] = useState({ title: "", content: "", brand: "", team: "", tags: "" });
  const [newImageFiles, setNewImageFiles] = useState<File[]>([]);
  const [newImageAlt, setNewImageAlt] = useState<string[]>([]);
  const [newImageCaptions, setNewImageCaptions] = useState<string[]>([]);
  const newImageInputRef = useRef<HTMLInputElement | null>(null);
  const [newError, setNewError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>( {} );
  const [revision, setRevision] = useState(0);
  const [allFolders, setAllFolders] = useState<string[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [newOpen, setNewOpen] = useState(searchParams.get("new") === "1");
  const [newFolderPath, setNewFolderPath] = useState("");
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [pageMoveDocument, setPageMoveDocument] = useState<KnowledgeDocument | null>(null);
  const [pageMoveFolder, setPageMoveFolder] = useState("");
  const [pageMoveParentId, setPageMoveParentId] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [collapsedPages, setCollapsedPages] = useState<Set<string>>(new Set());
  const [moveIds, setMoveIds] = useState<string[]>([]);
  const [folderManagerOpen, setFolderManagerOpen] = useState(searchParams.get("folders") === "1");
  const [managedFolder, setManagedFolder] = useState(searchParams.get("folder") ?? "");
  const managedFolderRef = useRef(managedFolder);
  managedFolderRef.current = managedFolder;
  const [folderManagerParent, setFolderManagerParent] = useState<string | undefined>();
  const [draggedFolder, setDraggedFolder] = useState("");
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null);
  const [treeContextMenu, setTreeContextMenu] = useState<null | { x: number; y: number; surface: "tree" | "table"; target: { type: "folder"; path: string } | { type: "document"; document: KnowledgeDocument } }>(null);
  const [renameDocument, setRenameDocument] = useState<KnowledgeDocument | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [folderDeletePath, setFolderDeletePath] = useState("");
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
  const [externalLinkOpen, setExternalLinkOpen] = useState(false);
  const [externalLinkError, setExternalLinkError] = useState("");
  const [attachmentProgress, setAttachmentProgress] = useState("");
  const [imageRecoveryOpen, setImageRecoveryOpen] = useState(false);
  const [relinkReference, setRelinkReference] = useState("");
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["00_Skills", "02_Wiki"]));
  const [sortAscending, setSortAscending] = useState(false);
  const [listLoading, setListLoading] = useState(!demo);
  const [backlinks, setBacklinks] = useState<KnowledgeDocument[]>([]);
  const [focusMode, setFocusMode] = useState(!vault);
  const [treeOpen, setTreeOpen] = useState(true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [inventory, setInventory] = useState<Array<{path: string; count: number}>>([]);
  const [hoverTree, setHoverTree] = useState(false);
  const [paneWidth, setPaneWidth] = useState(300);
  const [treeScroll, setTreeScroll] = useState(0);
  const [linkQuery, setLinkQuery] = useState<string | null>(null);
  const [linkChoices, setLinkChoices] = useState<KnowledgeDocument[]>([]);
  const [inlineQuery, setInlineQuery] = useState("");
  const [inlineChoices, setInlineChoices] = useState<KnowledgeDocument[]>([]);
  const [pendingAnchor, setPendingAnchor] = useState<{ id: string; heading: string } | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  useEffect(() => {
    if (!focusNewBody || !newOpen) return;
    let frame = 0;
    const focus = () => { if (newEditorRef.current) { newEditorRef.current.focus(); setFocusNewBody(false); } else frame = window.requestAnimationFrame(focus); };
    frame = window.requestAnimationFrame(focus); return () => window.cancelAnimationFrame(frame);
  }, [focusNewBody, newOpen]);
  useEffect(() => {
    const query = treeFilter.trim();
    if (!vault || !query || demo) return;
    let active = true;
    const timer = window.setTimeout(() => {
      apiRequest<{documents: KnowledgeDocument[]}>(`/api/v1/documents/index?q=${encodeURIComponent(query)}&scope=${encodeURIComponent(ownerFilter)}`, {token: accessToken})
        .then(result => { if (active) setDocuments(current => [...current, ...result.documents.filter(item => !current.some(row => row.id === item.id))]); })
        .catch(() => { /* Existing folder results remain usable when search is unavailable. */ });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [treeFilter, ownerFilter, vault, demo, accessToken]);
  const openFinderRef = useRef<() => void>(() => {});
  openFinderRef.current = () => guardAction(() => setFinderOpen(true));
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const epoch = useRef(0);
  const loadedFolders = useRef(new Set<string>());
  const editorRef = useRef<KnowledgeRichEditorMethods | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const relinkInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentDragDepth = useRef(0);
  const pendingAttachmentPaths = useRef(new Map<string, Set<string>>());
  const selectDocumentNow = useCallback((id: string) => {
    setWorkspaceView("document");
    const target = documentsRef.current.find((document) => document.id === id);
    if (target) setManagedFolder(target.folder);
    setMode("read");
    setSelectedId(id);
    const params = new URLSearchParams(window.location.search);
    params.set("document", id);
    params.delete("folder");
    if (window.location.search !== `?${params.toString()}`) window.history.pushState(window.history.state, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, []);

  useEffect(() => {
    const id = searchParams.get("document");
    if (id !== selectedIdRef.current) { setSelectedId(id); setMode("read"); }
  }, [searchParams]);

  useEffect(() => {
    const prefix = vault ? "brandy-knowledge-vault" : "brandy-knowledge";
    try {
    const savedFocus = window.localStorage.getItem(`${prefix}-focus`);
    setFocusMode(savedFocus === null ? !vault : savedFocus === "true");
    setTreeOpen(window.matchMedia("(max-width: 899px)").matches ? false : vault || window.localStorage.getItem(`${prefix}-tree`) !== "false");
    if (vault) setVaultPanelOpen(window.matchMedia("(min-width: 1280px)").matches);
    const savedWidth = window.localStorage.getItem(`${prefix}-width-v1`);
    if (savedWidth) setPaneWidth(treeWidth(Number(savedWidth)));
    } catch { setFocusMode(!vault); setTreeOpen(!window.matchMedia("(max-width: 899px)").matches); }
    setPreferencesReady(true);
    return () => { window.dispatchEvent(new CustomEvent("brandy-knowledge-focus", { detail: false })); };
  }, [vault]);
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 899px)");
    const closeDrawer = (event: MediaQueryListEvent) => {
      if (event.matches) setTreeOpen(false);
      else if (vault) setTreeOpen(true);
      setHoverTree(false);
    };
    narrow.addEventListener("change", closeDrawer);
    return () => narrow.removeEventListener("change", closeDrawer);
  }, [vault]);
  useEffect(() => {
    if (!treeContextMenu) return;
    const close = (event?: Event) => { if (event?.target instanceof Element && event.target.closest(".knowledge-tree-context-menu")) return; setTreeContextMenu(null); };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", keydown); };
  }, [treeContextMenu]);

  useEffect(() => {
    if (!preferencesReady) return;
    const prefix = vault ? "brandy-knowledge-vault" : "brandy-knowledge";
    try {
    window.localStorage.setItem(`${prefix}-focus`, String(focusMode));
    window.localStorage.setItem(`${prefix}-tree`, String(treeOpen));
    window.localStorage.setItem(`${prefix}-width-v1`, String(paneWidth));
    } catch { /* Browsing still works when storage is unavailable. */ }
    window.dispatchEvent(new CustomEvent("brandy-knowledge-focus", { detail: focusMode }));
  }, [focusMode, preferencesReady, treeOpen, paneWidth, vault]);

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
        const params = new URLSearchParams({view: "page-summary", limit: "200", offset: String(offset), folder: path, exactFolder: "true", scope: ownerFilter});
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
  const openFolderView = (path: string) => guardAction(() => {
    setManagedFolder(path);
    setWorkspaceView("folder");
    setSelectedId(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("document");
    if (path) params.set("folder", path); else params.delete("folder");
    window.history.pushState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    void loadFolder(path);
    if (window.innerWidth < 900) setTreeOpen(false);
  });

  const selectedFolder = selected?.folder;
  const editableSelected = Boolean(selected && canEditVaultDocument(selected, profile));
  useEffect(() => { if (vault && selectedId) setMode(editableSelected ? "edit" : "read"); }, [vault, selectedId, editableSelected]);
  useEffect(() => {
    if (!vault || listLoading || !selectedId || !selectedFolder) return;
    setExpandedFolders(current => new Set([...current, ...knowledgeFolderOptions([selectedFolder])]));
    void loadFolder(selectedFolder);
  }, [vault, listLoading, selectedId, selectedFolder, loadFolder]);

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
      // A direct nested-folder URL starts with only the default roots expanded.
      // Load its ancestors and exact folder as well, including after scope reloads.
      const foldersToLoad = new Set(expandedFolders);
      if (vault && managedFolderRef.current) {
        for (const path of knowledgeFolderOptions([managedFolderRef.current])) foldersToLoad.add(path);
        setExpandedFolders(current => new Set([...current, ...foldersToLoad]));
      }
      await Promise.all([...foldersToLoad].map(loadFolder));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "문서를 불러오지 못했습니다."); }
    finally { if (revision === epoch.current) setListLoading(false); }
  // Selection and expansion do not reload the folder inventory.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, demo, ownerFilter, loadFolder, vault]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") { event.preventDefault(); openFinderRef.current(); }
      if (event.key === "Escape") { setQuickOpen(false); setLinkQuery(null); }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => {
    if (linkQuery === null) { setLinkChoices([]); return; }
    if (demo) {
      const query = linkQuery.trim().toLocaleLowerCase("ko-KR");
      setLinkChoices(documents.filter(item => !query || `${item.title} ${item.source_ref ?? ""}`.toLocaleLowerCase("ko-KR").includes(query)).slice(0, 8));
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      apiRequest<{documents: KnowledgeDocument[]}>(`/api/v1/documents/index?q=${encodeURIComponent(linkQuery)}`, {token: accessToken})
        .then(result => { if (active) setLinkChoices(result.documents); }).catch(() => { if (active) setLinkChoices([]); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [linkQuery, demo, accessToken, documents]);
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
    if (!selected || (mode !== "info" && !(vault && vaultPanelOpen && vaultPanelTab === "versions"))) return;
    if (demo) { setVersions(getDemoKnowledgeVersions(selected.id)); return; }
    let active = true;
    setVersions([]);
    setVersionsLoading(true);
    listDocumentVersions(accessToken, selected.id)
      .then((result) => { if (active) setVersions(result.versions); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "변경 이력을 불러오지 못했습니다."))
      .finally(() => { if (active) setVersionsLoading(false); });
    return () => { active = false; };
  }, [accessToken, demo, mode, selected, vault, vaultPanelOpen, vaultPanelTab]);

  useEffect(() => {
    if (!selected || demo) { setBacklinks([]); return; }
    const params = new URLSearchParams({ view: "summary", limit: "50", q: `[[${selected.title}` });
    listDocuments(accessToken, params.toString())
      .then((result) => setBacklinks(result.documents.filter((item) => item.id !== selected.id)))
      .catch(() => setBacklinks([]));
  }, [accessToken, demo, selected]);

  const filtered = useMemo(() => documents.filter(document => inKnowledgeScope(document, ownerFilter, profile?.id)), [documents, ownerFilter, profile?.id]);
  const selectedChildren = useMemo(() => selected ? documents.filter(document => document.parent_document_id === selected.id && document.status !== "archived" && inKnowledgeScope(document, ownerFilter, profile?.id)) : [], [documents, selected, ownerFilter, profile?.id]);
  const galleryFolder = managedFolder || selected?.folder || "";
  const galleryDocuments = useMemo(() => filtered.filter((document) => documentFolder(document) === galleryFolder), [filtered, galleryFolder]);
  const openGallery = () => guardAction(() => {
    const folder = managedFolder || selected?.folder || "";
    setManagedFolder(folder);
    setWorkspaceView((value) => value === "gallery" ? vault ? "folder" : "document" : "gallery");
    void loadFolder(folder);
  });

  const folderTree = useMemo(() => buildFolderTree(filtered, sortAscending, [...(demo ? filtered.map(item => ({path: documentFolder(item), count: 1})) : inventory), ...pendingFolders.paths.map(path => ({ path, count: 0 }))], vault && ownerFilter === "mine" ? PERSONAL_VAULT_ROOTS : []), [filtered, sortAscending, inventory, demo, vault, ownerFilter, pendingFolders.paths]);
  const treeRows = useMemo(() => {
    const rows: TreeRow[] = [];
    const query = vault ? treeFilter.trim() : "";
    const folderMatches = new Set<string>();
    if (query) {
      for (const path of [...inventory.map(item => item.path), ...pendingFolders.paths, ...filtered.filter(item => matchesVaultName(item.title, query)).map(item => documentFolder(item))]) {
        if (!matchesVaultName(path, query) && !filtered.some(item => documentFolder(item) === path && matchesVaultName(item.title, query))) continue;
        const parts = path.split("/");
        for (let index = 1; index <= parts.length; index++) folderMatches.add(parts.slice(0, index).join("/"));
      }
    }
    const visit = (nodes: FolderTreeNode[], depth: number) => nodes.forEach((folder) => {
      if (query && !folderMatches.has(folder.path)) return;
      rows.push({ type: "folder", folder, depth });
      if (!query && !expandedFolders.has(folder.path)) return;
      visit(folder.children, depth + 1);
      const byId = new Map(folder.documents.map(document => [document.id, document]));
      const children = new Map<string, KnowledgeDocument[]>();
      for (const document of folder.documents) {
        const parent = document.parent_document_id;
        if (parent && parent !== document.id && byId.has(parent)) children.set(parent, [...(children.get(parent) ?? []), document]);
      }
      const seen = new Set<string>();
      const markHidden = (document: KnowledgeDocument) => {
        if (seen.has(document.id)) return;
        seen.add(document.id);
        (children.get(document.id) ?? []).forEach(markHidden);
      };
      const visitPage = (document: KnowledgeDocument, pageDepth: number) => {
        if (seen.has(document.id)) return;
        seen.add(document.id);
        const childPages = children.get(document.id) ?? [];
        if (!query || matchesVaultName(document.title, query) || matchesVaultName(folder.path, query)) rows.push({ type: "document", document, depth: pageDepth, childCount: childPages.length });
        if (collapsedPages.has(document.id)) childPages.forEach(markHidden);
        else childPages.forEach(child => visitPage(child, pageDepth + 1));
      };
      folder.documents.filter(document => !document.parent_document_id || !byId.has(document.parent_document_id)).forEach(document => visitPage(document, depth + 1));
      folder.documents.filter(document => !seen.has(document.id)).forEach(document => visitPage(document, depth + 1));
    });
    visit(folderTree, 0); return rows;
  }, [collapsedPages, expandedFolders, folderTree, treeFilter, vault, inventory, filtered, pendingFolders.paths]);
  const ownerNames = useMemo(() => new Map(members.map((member) => [member.id, member.display_name || member.email.split("@")[0]])), [members]);
  const readingContent = useMemo(() => prepareReadingContent(dirty ? draft?.content ?? "" : selected?.content_md ?? ""), [selected?.content_md, dirty, draft?.content]);
  const existingFolderOptions = useMemo(() => knowledgeFolderOptions([
    ...(demo ? [] : allFolders),
    ...inventory.map((item) => item.path),
    ...documents.map((document) => documentFolder(document)),
  ].filter((path) => path !== "분류 없음")), [documents, inventory, allFolders, demo]);
  const folderOptions = useMemo(() => vault ? knowledgeFolderOptions([...PERSONAL_VAULT_ROOTS, ...existingFolderOptions, ...pendingFolders.paths]) : existingFolderOptions, [existingFolderOptions, vault, pendingFolders.paths]);
  const createEmptyFolder = (parent: string, name: string) => pendingFolders.create(parent, name, folderOptions);
  const folderDocumentCount = (path: string) => demo
    ? documents.filter(item => item.status !== "archived" && (item.folder === path || item.folder.startsWith(`${path}/`))).length
    : inventory.filter(item => item.path === path || item.path.startsWith(`${path}/`)).reduce((count, item) => count + item.count, 0);
  const requestFolderArchive = (path: string) => {
    setError("");
    const empty = pendingFolders.paths.includes(path) && !documents.some(item => item.folder === path || item.folder.startsWith(`${path}/`)) && !inventory.some(item => item.path === path || item.path.startsWith(`${path}/`));
    if (empty) pendingFolders.remove(path); else setFolderDeletePath(path);
    setTreeContextMenu(null);
  };
  const beginFolder = (parent: string) => {
    setTreeOpen(true); setTreeFilter(""); setTreeContextMenu(null); setFolderInput({ parent, value: "" });
    setExpandedFolders(current => new Set([...current, ...knowledgeFolderOptions([parent])]));
  };
  const finishFolder = () => {
    if (!folderInput?.value.trim()) { setFolderInput(null); return; }
    try { createEmptyFolder(folderInput.parent, folderInput.value); setFolderInput(null); setError(""); setToast("빈 폴더를 만들었습니다. 첫 페이지를 저장하면 모두에게 보입니다."); }
    catch (reason) { setError((reason as Error).message); }
  };
  const folderInputRow = (parent: string) => folderInput?.parent === parent ? <div className="vault-inline-name" style={{ paddingLeft: 30 + (parent ? parent.split("/").length : 0) * 16 }}><Folder size={14}/><input autoFocus aria-label="새 폴더 이름" placeholder={`새 폴더 이름 · ${parent || "최상위"}`} value={folderInput.value} maxLength={160} onChange={event => setFolderInput({ parent, value: event.target.value })} onBlur={finishFolder} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); finishFolder(); } if (event.key === "Escape") { event.preventDefault(); setFolderInput(null); } }} /></div> : null;

  useEffect(() => {
    if (vault || searchParams.get("document") || selectedId || !filtered.length) return;
    if (!selectedId || !filtered.some((document) => document.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, searchParams, selectedId, vault]);

  const openNewDocument = (folder = managedFolder || selected?.folder || "", parentId: string | null = null) => guardAction(() => {
    setNewFolderPath(folder); setNewParentId(parentId); setNewError(""); setFieldErrors({}); setWorkspaceView("document"); setNewOpen(true);
  });
  const newDirty = Object.values(newValues).some(Boolean) || newImageFiles.length > 0;
  const closeNewDocument = () => {
    if (busy) return;
    const close = () => { setNewValues({ title: "", content: "", brand: "", team: "", tags: "" }); setNewImageFiles([]); setNewImageAlt([]); setNewImageCaptions([]); setNewOpen(false); setNewParentId(null); setNewError(""); if (vault && !selectedId) setWorkspaceView("folder"); };
    if (newDirty) setPendingNewAction(() => close); else close();
  };
  function guardAction(action: () => void) {
    if (busy) return;
    if (newOpen && newDirty) setPendingNewAction(() => action);
    else if (dirty) setPendingAction(() => action);
    else action();
  }
  const selectDocument = (id: string) => { if (id !== selectedId) guardAction(() => selectDocumentNow(id)); };
  function commitDocument(document: KnowledgeDocument, previous?: KnowledgeDocument) {
    if (vault) pendingFolders.materialize(document.folder);
    if (demo) saveDemoKnowledgeDocument(document);
    const before = previous ?? documentsRef.current.find(row => row.id === document.id);
    const movedChildren = before && before.folder !== document.folder
      ? knowledgePageDescendants(documentsRef.current, document.id).map(child => ({ before: child, after: { ...child, folder: document.folder } }))
      : [];
    if (demo) movedChildren.forEach(child => saveDemoKnowledgeDocument(child.after));
    const movedById = new Map(movedChildren.map(child => [child.after.id, child.after]));
    documentsRef.current = [document, ...documentsRef.current.filter(row => row.id !== document.id).map(row => movedById.get(row.id) ?? row)];
    setDocuments(documentsRef.current);
    setInventory(current => movedChildren.reduce((inventory, child) => updateFolderInventory(inventory, child.before, child.after, ownerFilter, profile?.id), updateFolderInventory(current, before, document, ownerFilter, profile?.id)));
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

  const moveDocument = async (documentId: string, folder: string, undo = false) => {
    const item = documentsRef.current.find(document => document.id === documentId);
    if (!item || busy) return;
    setBusy(true); setError("");
    try {
      const destination = folder.trim() ? normalizeKnowledgeFolder(folder) : "";
      if (item.folder === destination) { setMoveOpen(false); return; }
      const document = demo ? { ...item, folder: destination, current_version: item.current_version + 1, updated_at: new Date().toISOString() } : (await updateDocument(accessToken, { id: item.id, expectedVersion: item.current_version, folder: destination, reason: "문서 위치 이동" })).document;
      commitDocument(document); discard(document.id); setMoveOpen(false); setMoveUndo(undo ? null : { id: document.id, folder: item.folder });
      setToast(`문서를 ${destination || "분류 없음"}(으)로 이동했습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "폴더로 이동하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const openPageMove = (document: KnowledgeDocument) => guardAction(() => {
    setError(""); setPageMoveDocument(document); setPageMoveFolder(document.folder);
    setPageMoveParentId(document.parent_document_id ?? null);
  });
  const savePageMove = async (chosenFolder = pageMoveFolder, chosenParent = pageMoveParentId) => {
    if (!pageMoveDocument || busy) return;
    setBusy(true); setError("");
    try {
      const folder = chosenFolder.trim() ? normalizeKnowledgeFolder(chosenFolder) : "";
      if (!canReparentKnowledgePage(documentsRef.current, pageMoveDocument.id, chosenParent)) throw new Error("페이지를 자신이나 하위 페이지 아래로 옮길 수 없습니다.");
      const parent = chosenParent ? documentsRef.current.find(document => document.id === chosenParent) : null;
      if (chosenParent && (!parent || parent.status === "archived" || parent.folder !== folder)) throw new Error("상위 페이지와 같은 폴더를 선택해 주세요.");
      if (pageMoveDocument.folder === folder && (pageMoveDocument.parent_document_id ?? null) === chosenParent) { setPageMoveDocument(null); return; }
      const updated = demo ? { ...pageMoveDocument, folder, parent_document_id: chosenParent, updated_at: new Date().toISOString() }
        : (await moveKnowledgePage(accessToken, { id: pageMoveDocument.id, folder, parentDocumentId: chosenParent, expectedUpdatedAt: pageMoveDocument.updated_at })).document;
      commitDocument(updated, pageMoveDocument); discard(updated.id); setPageMoveDocument(null);
      setToast("페이지 위치를 옮겼습니다. 하위 페이지도 함께 이동합니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "페이지를 옮기지 못했습니다."); }
    finally { setBusy(false); }
  };

  const openTreeContextMenu = (event: React.MouseEvent, target: NonNullable<typeof treeContextMenu>["target"]) => {
    event.preventDefault(); event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX : bounds.right;
    const pointerY = Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY : bounds.top;
    setTreeContextMenu({ surface: event.currentTarget.closest(".vault-folder-view") ? "table" : "tree", x: Math.max(8, Math.min(pointerX, window.innerWidth - 224)), y: Math.max(8, Math.min(pointerY, window.innerHeight - 190)), target });
  };

  const openFolderManager = (path: string, parent?: string) => guardAction(() => {
    setError(""); setManagedFolder(path); setFolderManagerParent(parent); setFolderManagerOpen(true); setTreeContextMenu(null);
  });

  const beginRename = (key: string, surface: "tree" | "table" = "tree") => guardAction(() => {
    setTreeContextMenu(null);
    setInlineRename({ key, surface, value: key.startsWith("folder:") ? key.slice(7).split("/").at(-1)! : documents.find(item => item.id === key)?.title ?? "" });
  });
  const finishRename = async () => {
    if (!inlineRename || busy || renaming.current) return;
    const { key, value } = inlineRename;
    if (!value.trim()) { setInlineRename(null); return; }
    if (key.startsWith("folder:")) {
      const path = key.slice(7), parent = path.split("/").slice(0, -1).join("/");
      if (value.trim() === path.split("/").at(-1)) { setInlineRename(null); return; }
      try {
        const destination = newVaultFolder(parent, value, folderOptions);
        if (pendingFolders.paths.includes(path) && !documents.some(item => item.folder === path || item.folder.startsWith(`${path}/`)) && !inventory.some(item => item.path === path || item.path.startsWith(`${path}/`))) pendingFolders.rename(path, destination);
        else { setFolderManagerName(value.trim()); openFolderManager(path); }
        setInlineRename(null);
      } catch (reason) { setError((reason as Error).message); }
      return;
    }
    const current = documents.find(item => item.id === key);
    if (!current) return;
    if (current.title === value.trim()) { setInlineRename(null); return; }
    renaming.current = true; setBusy(true); setError("");
    try {
      const full = !demo && current.content_md === undefined ? (await getDocument(accessToken, key)).document : current;
      const result = demo ? { document: { ...full, title: value.trim(), current_version: full.current_version + 1, updated_at: new Date().toISOString() }, proposal: undefined } : await updateDocument(accessToken, { id: key, expectedVersion: full.current_version, title: value.trim(), content: full.content_md, reason: "문서 이름 변경" });
      if (!result.proposal) commitDocument(result.document, full);
      discard(key); setInlineRename(null); setToast(result.proposal ? "제목 변경 제안을 저장했습니다." : "문서 이름을 변경했습니다.");
    } catch (reason) { setError((reason as Error).message); }
    finally { renaming.current = false; setBusy(false); }
  };
  const renameInput = (key: string, surface: "tree" | "table" = "tree") => inlineRename?.key === key && inlineRename.surface === surface ? <input className="vault-inline-rename" autoFocus aria-label="이름 변경" value={inlineRename.value} maxLength={key.startsWith("folder:") ? 160 : 200} onClick={event => event.stopPropagation()} onChange={event => setInlineRename({ key, surface, value: event.target.value })} onBlur={() => void finishRename()} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); void finishRename(); } if (event.key === "Escape") { event.preventDefault(); setInlineRename(null); } }} /> : null;
  const selectRow = (event: React.MouseEvent, key: string, ordered: string[]) => {
    if (!vault || !(event.metaKey || event.ctrlKey || event.shiftKey)) { selectionAnchor.current = key; return false; }
    event.preventDefault(); setSelectionMode(true);
    setCheckedIds(current => {
      const next = new Set(current);
      if (event.shiftKey && selectionAnchor.current && ordered.includes(selectionAnchor.current)) {
        const a = ordered.indexOf(selectionAnchor.current), b = ordered.indexOf(key);
        ordered.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(item => next.add(item));
      } else { if (next.has(key)) next.delete(key); else next.add(key); selectionAnchor.current = key; }
      return next;
    }); return true;
  };
  const collectSelection = async () => {
      let snapshot = [...documentsRef.current];
      if (!demo) for (const key of checkedIds) {
        if (!key.startsWith("folder:")) continue;
        for (const path of folderOptions.filter(path => path === key.slice(7) || path.startsWith(`${key.slice(7)}/`))) {
          for (let offset = 0; ; offset += 200) {
            const result = await listDocuments(accessToken, new URLSearchParams({ view: "summary", folder: path, exactFolder: "true", limit: "200", offset: String(offset) }).toString());
            snapshot = [...snapshot, ...result.documents.filter(item => !snapshot.some(row => row.id === item.id))];
            if (offset + result.documents.length >= result.total || !result.documents.length) break;
          }
        }
      }
      documentsRef.current = snapshot; setDocuments(snapshot);
      return selectedVaultDocuments(snapshot, checkedIds);
  };
  const openBulkMove = () => guardAction(async () => {
    setBusy(true); setError("");
    try {
      const selectedItems = await collectSelection();
      setMoveIds(selectedItems.map(item => item.id)); setMoveOpen(true);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  });
  const archiveSelection = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const selectedItems = await collectSelection();
      const allowed = selectedItems.filter(item => item.status !== "canonical" && item.status !== "archived" && (item.owner_id === profile?.id || profile?.role === "admin"));
      const results = await Promise.allSettled(allowed.map(async item => { const updated = demo ? { ...item, status: "archived" as const, updated_at: new Date().toISOString() } : (await changeDocumentStatus(accessToken, item.id, "archived")).document; commitDocument(updated, item); }));
      const succeeded = results.filter(result => result.status === "fulfilled").length;
      for (const key of checkedIds) if (key.startsWith("folder:") && !selectedItems.some(item => item.folder === key.slice(7) || item.folder.startsWith(`${key.slice(7)}/`))) pendingFolders.remove(key.slice(7));
      setToast(`${succeeded}개 휴지통 이동 · ${selectedItems.length - allowed.length}개 보호 문서 제외 · ${allowed.length - succeeded}개 실패`);
      setBulkArchiveOpen(false); setCheckedIds(new Set());
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const renameContextDocument = async () => {
    if (!renameDocument || busy) return;
    const title = renameTitle.trim();
    if (!title || title === renameDocument.title) { setRenameDocument(null); return; }
    setBusy(true); setError("");
    try {
      const current = !demo && renameDocument.content_md === undefined ? (await getDocument(accessToken, renameDocument.id)).document : renameDocument;
      const result = demo ? { document: { ...current, title, current_version: current.current_version + 1, updated_at: new Date().toISOString() }, proposal: undefined } : await updateDocument(accessToken, { id: current.id, expectedVersion: current.current_version, title, content: current.content_md, reason: "파일 트리에서 문서 이름 변경" });
      if (!result.proposal) commitDocument(result.document, current);
      discard(current.id); setRenameDocument(null); setToast(result.proposal ? "제목 변경 제안을 저장했습니다. 승인 전까지 정본 이름은 그대로입니다." : "문서 이름을 변경했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "문서 이름을 변경하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const archiveFolderDocuments = async () => {
    if (!folderDeletePath || busy) return;
    setBusy(true); setError("");
    try {
      let affected = documents.filter(item => item.status !== "archived" && (item.folder === folderDeletePath || item.folder.startsWith(`${folderDeletePath}/`)));
      if (!demo) {
        affected = [];
        for (let offset = 0; ; offset += 200) {
          const query = new URLSearchParams({ view: "summary", folder: folderDeletePath, scope: "all", limit: "200", offset: String(offset) });
          const page = await listDocuments(accessToken, query.toString());
          affected.push(...page.documents);
          if (offset + page.documents.length >= page.total || !page.documents.length) break;
        }
      }
      if (!affected.length) throw new Error("이 폴더에 휴지통으로 옮길 활성 문서가 없습니다.");
      const protectedCount = affected.filter(item => item.status === "canonical" || (item.owner_id !== profile?.id && profile?.role !== "admin")).length;
      affected = affected.filter(item => item.status !== "canonical" && (item.owner_id === profile?.id || profile?.role === "admin"));
      const results = await Promise.allSettled(affected.map(async item => {
        const document = demo ? { ...item, status: "archived" as const, updated_at: new Date().toISOString() } : (await changeDocumentStatus(accessToken, item.id, "archived")).document;
        commitDocument(document, item); return document;
      }));
      const failed = results.filter(result => result.status === "rejected").length;
      if (failed) throw new Error(`${affected.length - failed}개는 휴지통으로 옮겼고 ${failed}개는 권한 또는 최신 버전을 확인해야 합니다.`);
      setFolderDeletePath(""); setTreeContextMenu(null); setToast(`${affected.length}개 문서를 휴지통으로 옮겼습니다. ${protectedCount}개 보호 문서는 제외했습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "폴더를 정리하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const insertMarkdown = (markdown: string) => {
    if (!draft || !editorRef.current) return;
    editorRef.current.focus();
    editorRef.current.insertMarkdown(markdown);
  };

  const rememberPendingAttachment = (documentId: string, path: string) => {
    const paths = pendingAttachmentPaths.current.get(documentId) ?? new Set<string>();
    paths.add(path); pendingAttachmentPaths.current.set(documentId, paths);
  };

  const cleanupPendingAttachments = async (documentId: string, only?: string[]) => {
    const remembered = pendingAttachmentPaths.current.get(documentId) ?? new Set<string>();
    const paths = only ?? [...remembered];
    if (!paths.length) return true;
    const results = await Promise.allSettled(paths.map(path => deleteKnowledgeAttachment(accessToken, path)));
    results.forEach((result, index) => { if (result.status === "fulfilled") remembered.delete(paths[index]); });
    if (remembered.size) pendingAttachmentPaths.current.set(documentId, remembered);
    else pendingAttachmentPaths.current.delete(documentId);
    return results.every(result => result.status === "fulfilled");
  };

  const addExternalLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    const form = new FormData(event.currentTarget);
    const rawUrl = String(form.get("url") ?? "").trim();
    const label = String(form.get("label") ?? "").trim() || rawUrl;
    try {
      const url = new URL(rawUrl);
      if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) throw new Error();
      const safeLabel = label.replace(/[\[\]\r\n]/g, " ").trim() || url.hostname;
      insertMarkdown(`[${safeLabel}](${url.toString()})`);
      setExternalLinkError(""); setExternalLinkOpen(false);
    } catch { setExternalLinkError("https:// 또는 http://로 시작하는 링크를 입력해 주세요."); }
  };

  const replaceAttachmentPlaceholder = (placeholder: string, replacement: string) => {
    if (!draft || !editorRef.current) return false;
    const current = editorRef.current.getMarkdown();
    if (!current.includes(placeholder)) return false;
    const content = current.replace(placeholder, replacement);
    editorRef.current.setMarkdown(content);
    setDraft({ ...draft, content });
    return true;
  };

  const attachFiles = async (files: FileList | File[] | null) => {
    if (!files?.length || !selected || !draft || busy) return;
    if (demo) { setError("데모 화면에서는 파일을 올릴 수 없습니다."); return; }
    const selectedFiles = [...files].slice(0, 10);
    const placeholder = `자료 올리는 중… BAUPLOAD${crypto.randomUUID().replaceAll("-", "")}`;
    insertMarkdown(`\n\n${placeholder}\n\n`);
    setBusy(true); setError("");
    const uploadedPaths: string[] = [];
    try {
      const markdown: string[] = [];
      for (const [index, file] of selectedFiles.entries()) {
        setAttachmentProgress(`자료 ${index + 1}/${selectedFiles.length} 올리는 중 · ${file.name}`);
        const signed = await createKnowledgeAttachmentUpload(accessToken, selected.id, file);
        await uploadKnowledgeAttachment(signed.path, signed.token, file, signed.type);
        uploadedPaths.push(signed.path); rememberPendingAttachment(selected.id, signed.path);
        markdown.push(knowledgeAttachmentMarkdown(signed));
      }
      if (!replaceAttachmentPlaceholder(placeholder, markdown.join("\n\n"))) insertMarkdown(markdown.join("\n\n"));
      setToast(`${markdown.length}개 자료를 본문에 넣었습니다. 문서를 저장하면 다른 구성원에게도 보입니다.`);
    } catch (reason) {
      replaceAttachmentPlaceholder(placeholder, "");
      const cleaned = await cleanupPendingAttachments(selected.id, uploadedPaths);
      setError(`${reason instanceof Error ? reason.message : "자료를 올리지 못했습니다."}${cleaned ? " 먼저 올라간 자료는 정리했습니다." : " 먼저 올라간 자료는 자동 정리 대상으로 남겼습니다."}`);
    }
    finally {
      setBusy(false); setAttachmentProgress("");
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  };

  const editorDragHasFiles = (event: React.DragEvent<HTMLElement>) => {
    const types = Array.from(event.dataTransfer.types);
    return types.includes("Files") && !types.includes("application/x-lexical-drag");
  };
  const placeAttachmentDrop = (event: React.DragEvent<HTMLDivElement>, commit = false) => {
    const editable = event.currentTarget.querySelector<HTMLElement>('.knowledge-rich-content[contenteditable="true"]');
    if (!editable) return;
    editable.focus({ preventScroll: true });
    dispatchKnowledgeFileDropPosition(editable, { clientY: event.clientY, commit });
  };
  const enterAttachmentDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!editorDragHasFiles(event)) return;
    event.preventDefault();
    attachmentDragDepth.current += 1;
    setAttachmentDragActive(true);
  };
  const leaveAttachmentDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!editorDragHasFiles(event)) return;
    event.preventDefault();
    attachmentDragDepth.current = Math.max(0, attachmentDragDepth.current - 1);
    if (!attachmentDragDepth.current) {
      setAttachmentDragActive(false);
      const editable = event.currentTarget.querySelector<HTMLElement>('.knowledge-rich-content[contenteditable="true"]');
      if (editable) dispatchKnowledgeFileDropPosition(editable, { clear: true });
    }
  };
  const dropAttachments = (event: React.DragEvent<HTMLDivElement>) => {
    if (!editorDragHasFiles(event)) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    placeAttachmentDrop(event, true);
    attachmentDragDepth.current = 0;
    setAttachmentDragActive(false);
    if (!busy) window.requestAnimationFrame(() => void attachFiles(files));
  };

  const save = async () => {
    if (!selected || !draft || busy) return false;
    setBusy(true); setError("");
    try {
      const input = documentCreateSchema.parse({ ...draft, folder: draft.folder.trim() ? normalizeKnowledgeFolder(draft.folder) : "", tags: draft.tags.split(",").map(tag => tag.trim()).filter(Boolean) });
      const result = demo ? { document: { ...selected, ...input, content_md: input.content, current_version: selected.current_version + 1, updated_at: new Date().toISOString() }, proposal: undefined } : await updateDocument(accessToken, { ...input, id: selected.id, expectedVersion: expectedVersion!, reason: "OS 문서 작업공간에서 수정" });
      const pending = [...(pendingAttachmentPaths.current.get(selected.id) ?? [])];
      const unused = pending.filter(path => !input.content.includes(encodeURIComponent(path)));
      if (unused.length) await cleanupPendingAttachments(selected.id, unused);
      pendingAttachmentPaths.current.delete(selected.id);
      if (!result.proposal) commitDocument(result.document);
      discard(selected.id);
      setMode(vault && canEditVaultDocument(result.document, profile) ? "edit" : "read"); setToast(result.proposal ? "정본 변경 제안을 저장했습니다. 승인 전까지 기존 정본은 그대로입니다." : "새 버전으로 저장했습니다."); return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "저장하지 못했습니다. 작성 내용은 유지됩니다.");
      if (reason instanceof ApiRequestError && reason.code === "VERSION_CONFLICT") {
        try { setConflict((await getDocument(accessToken, selected.id)).document); } catch { setError("최신 버전을 불러오지 못했습니다. 작성 내용은 유지됩니다. 다시 저장해 비교를 시도하세요."); }
      }
      return false;
    }
    finally { setBusy(false); }
  };

  const discardAndContinue = async (action: () => void) => {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try {
      const cleaned = demo ? true : await cleanupPendingAttachments(selected.id);
      discard(selected.id); setPendingAction(null); action();
      if (!cleaned) setToast("본문 변경은 버렸습니다. 사용하지 않은 자료는 일일 자동 정리 대상에 남겼습니다.");
    } finally { setBusy(false); }
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

  const saveDocumentSteward = async (stewardId: string) => {
    if (!selected || demo) return;
    setBusy(true); setError("");
    try {
      const result = await setDocumentSteward(accessToken, selected.id, selected.current_version, stewardId || null);
      commitDocument(result.document); setToast("문서 담당을 저장했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "문서 담당을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const restoreVersion = async (version: DocumentVersion) => {
    if (!selected || !compareBase) return;
    setBusy(true); setError("");
    try {
      let restored: KnowledgeDocument;
      let proposalCreated = false;
      const current = documentsRef.current.find(item => item.id === selected.id) ?? selected;
      if (demo) restored = { ...current, title: version.title, content_md: version.content_md, current_version: current.current_version + 1, updated_at: new Date().toISOString() };
      else { const response = await restoreDocumentVersion(accessToken, selected.id, version.version_no, compareBase.current_version); restored = response.document; proposalCreated = Boolean(response.proposal); }
      setCompareVersion(null); setCompareBase(null);
      if (!proposalCreated) commitDocument(restored);
      discard(restored.id); setToast(proposalCreated ? `v${version.version_no} 내용의 변경 제안을 저장했습니다. 승인 전까지 정본은 그대로입니다.` : `v${version.version_no} 내용을 새 버전으로 복원했습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "버전을 되돌리지 못했습니다."); }
    finally { setBusy(false); }
  };

  const createPage = async (): Promise<KnowledgeDocument | null> => {
    if (busy) return null;
    setBusy(true); setNewError(""); setFieldErrors({});
    try {
      const parsed = documentCreateSchema.safeParse({ ...newValues, title: newValues.title.trim() || (vault ? "제목 없음" : ""), content: newValues.content || "\n", folder: newFolderPath.trim() ? normalizeKnowledgeFolder(newFolderPath) : "", tags: newValues.tags.split(",").map(tag => tag.trim()).filter(Boolean), source: "wiki", parentDocumentId: demo ? null : newParentId });
      if (!parsed.success) {
        const labels: Record<string, string> = { title: "제목은 1~200자", content: "본문은 1,500,000자 이하", folder: "폴더 경로는 160자 이하", brand: "브랜드는 120자 이하", team: "팀은 120자 이하", tags: "태그는 최대 30개, 각각 1~60자" };
        setFieldErrors(Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), labels[String(issue.path[0])] || "입력값을 확인해 주세요."])));
        setNewError("표시된 항목을 수정한 뒤 다시 저장해 주세요."); return null;
      }
      const input = parsed.data;
      if (demo && newImageFiles.length) { setNewError("데모 화면에서는 이미지를 저장할 수 없습니다. 이미지를 제외하거나 개발 환경에서 확인해 주세요."); return null; }
      const now = new Date().toISOString();
      let document: KnowledgeDocument = demo ? { id: crypto.randomUUID(), ...input, parent_document_id: newParentId, content_md: input.content, status: "draft", source_ref: null, owner_id: profile?.id ?? "demo-ricky", created_by: profile?.id ?? "demo-ricky", current_version: 1, created_at: now, updated_at: now } : (await createDocument(accessToken, input)).document;
      if (newImageFiles.length) {
        try {
          const attachments: string[] = [];
          for (const [index, file] of newImageFiles.entries()) {
            setAttachmentProgress(`이미지 ${index + 1}/${newImageFiles.length} 올리는 중 · ${file.name}`);
            const signed = await createKnowledgeAttachmentUpload(accessToken, document.id, file);
            await uploadKnowledgeAttachment(signed.path, signed.token, file, signed.type);
            const alt = newImageAlt[index]?.trim() || file.name;
            const caption = newImageCaptions[index]?.replace(/[\r\n]/g, " ").trim();
            attachments.push(`${knowledgeAttachmentMarkdown({ ...signed, name: alt })}${caption ? `\n*${caption.replaceAll("*", "\\*")}*` : ""}`);
          }
          const content = `${input.content.trim()}\n\n${attachments.join("\n\n")}`.trim();
          document = (await updateDocument(accessToken, { id: document.id, expectedVersion: document.current_version, content, reason: "새 페이지 이미지 첨부" })).document;
        } catch (reason) {
          commitDocument(document); setOwnerFilter("all"); selectDocumentNow(document.id); setNewOpen(false); setMode("edit");
          setNewImageFiles([]); setNewImageAlt([]); setNewImageCaptions([]); setNewValues({ title: "", content: "", brand: "", team: "", tags: "" });
          setError(`${reason instanceof Error ? reason.message : "이미지를 올리지 못했습니다."} 페이지는 초안으로 저장됐습니다. 자료 첨부에서 다시 시도해 주세요.`);
          return document;
        }
      }
      commitDocument(document); setOwnerFilter(vault ? "mine" : "all"); selectDocumentNow(document.id); setNewOpen(false); setMode("edit");
      setNewValues({title: "", content: "", brand: "", team: "", tags: ""}); setNewFolderPath(""); setNewParentId(null); setNewImageFiles([]); setNewImageAlt([]); setNewImageCaptions([]);
      setToast("페이지를 개인 초안으로 저장했습니다.");
      return document;
    } catch (reason) { setNewError(reason instanceof Error ? reason.message : "페이지를 만들지 못했습니다. 입력 내용은 유지됩니다."); return null; }
    finally { setBusy(false); setAttachmentProgress(""); }
  };
  const create = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void createPage(); };
  const queueNewImages = (files: File[]) => {
    const images = files.filter(file => ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) && file.size > 0 && file.size <= 100 * 1024 * 1024);
    if (images.length !== files.length) setNewError("JPG·PNG·WebP·GIF 이미지만 올릴 수 있으며 파일당 최대 100MB입니다.");
    if (newImageFiles.length + images.length > 10) { setNewError("한 페이지에 이미지는 한 번에 최대 10개까지 올릴 수 있습니다."); return; }
    if (!images.length) return;
    setNewImageFiles(current => [...current, ...images]);
    setNewImageAlt(current => [...current, ...images.map(file => file.name)]);
    setNewImageCaptions(current => [...current, ...images.map(() => "")]);
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
    else if (draft && editorRef.current) editorRef.current.insertMarkdown(stableWikiLink(document));
    setLinkQuery(null);
  };

  const connectOriginalImage = async (file: File | undefined) => {
    if (!file || !selected || !relinkReference || busy) return;
    const mimeType = file.type || ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as Record<string, string>)[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";
    setBusy(true); setError(""); setAttachmentProgress(`원본 이미지 연결 중 · ${file.name}`);
    try {
      const input = { documentId: selected.id, reference: relinkReference, fileName: file.name, fileSize: file.size, mimeType, sha256: await knowledgeAssetSha256(file), sourceDocument: selected.source_ref ?? "", fileCreatedAt: null };
      const prepared = await prepareKnowledgeAssetUpload(accessToken, input);
      if (!prepared.duplicate) {
        if (!prepared.upload) throw new Error("이미지 업로드 경로를 만들지 못했습니다.");
        await uploadKnowledgeAttachment(prepared.upload.path, prepared.upload.token, file, prepared.upload.type);
        await finalizeKnowledgeAssetUpload(accessToken, { ...input, path: prepared.upload.path });
      }
      setRevision((value) => value + 1); setToast(`${file.name} 원본 이미지를 연결했습니다.`); setRelinkReference("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "원본 이미지를 연결하지 못했습니다."); }
    finally { setBusy(false); setAttachmentProgress(""); if (relinkInputRef.current) relinkInputRef.current.value = ""; }
  };

  const requestImageRelink = (reference: string) => {
    setRelinkReference(reference);
    window.requestAnimationFrame(() => relinkInputRef.current?.click());
  };
  useEffect(() => {
    if (!vault || demo || !inlineQuery.trim()) return;
    let active = true;
    const timer = window.setTimeout(() => { apiRequest<{ documents: KnowledgeDocument[] }>(`/api/v1/documents/index?q=${encodeURIComponent(inlineQuery)}`, { token: accessToken }).then(result => { if (active) setInlineChoices(result.documents); }).catch(() => { if (active) setInlineChoices([]); }); }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [vault, demo, inlineQuery, accessToken]);
  const inlineOptions = {
    documents: [...new Map([...documents, ...inlineChoices].map(item => [item.id, item])).values()].filter(item => item.status !== "archived").map(item => ({ id: item.id, title: item.title, detail: item.folder })),
    people: members.map(member => ({ id: member.id, title: member.display_name || member.email.split("@")[0], detail: member.team })),
    onDocumentQuery: setInlineQuery, onError: setError,
    createDocument: newOpen ? undefined : async (title: string) => {
      const folder = selected?.folder ?? managedFolder;
      const input = documentCreateSchema.parse({ title, content: "\n", folder, source: "wiki" });
      const now = new Date().toISOString();
      const document: KnowledgeDocument = demo ? { id: crypto.randomUUID(), ...input, parent_document_id: null, content_md: input.content, status: "draft", source_ref: null, owner_id: profile?.id ?? "demo-ricky", created_by: profile?.id ?? "demo-ricky", current_version: 1, created_at: now, updated_at: now } : (await createDocument(accessToken, input)).document;
      commitDocument(document); return document.id;
    },
  };
  const keyboardActions = useRef({ save, createPage, newOpen, selected, checkedIds, openBulkMove, openPageMove, busy });
  keyboardActions.current = { save, createPage, newOpen, selected, checkedIds, openBulkMove, openPageMove, busy };
  useEffect(() => {
    if (!vault) return;
    const keydown = (event: KeyboardEvent) => {
      const current = keyboardActions.current;
      if (event.isComposing || current.busy) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (current.newOpen) void current.createPage(); else if (current.selected && canEditVaultDocument(current.selected, profile)) void current.save(); }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "m") { event.preventDefault(); if (current.checkedIds.size) current.openBulkMove(); else if (current.selected) current.openPageMove(current.selected); }
      if (event.key === "Escape" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) { setCheckedIds(new Set()); setSelectionMode(false); }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, [vault, profile]);
  useEffect(() => { if (!moveUndo) return; const timer = window.setTimeout(() => setMoveUndo(null), 6000); return () => window.clearTimeout(timer); }, [moveUndo]);
  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!vault || event.target instanceof HTMLInputElement || event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
    const target = (event.target as Element).closest<HTMLElement>("[data-vault-key]");
    const key = target?.dataset.vaultKey;
    if (!key) return;
    const ordered = treeRows.map(row => row.type === "folder" ? vaultFolderKey(row.folder.path) : row.document.id), index = ordered.indexOf(key);
    if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); const next = Math.max(0, Math.min(ordered.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))); const scroll = event.currentTarget; scroll.scrollTop = Math.max(0, next * treeRowHeight - scroll.clientHeight / 2); window.requestAnimationFrame(() => Array.from(scroll.querySelectorAll<HTMLElement>("[data-vault-key]")).find(item => item.dataset.vaultKey === ordered[next])?.focus()); }
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); if (key.startsWith("folder:")) { const path = key.slice(7); setExpandedFolders(current => { const next = new Set(current); if (event.key === "ArrowRight") next.add(path); else next.delete(path); return next; }); if (event.key === "ArrowRight") void loadFolder(path); } else setCollapsedPages(current => { const next = new Set(current); if (event.key === "ArrowLeft") next.add(key); else next.delete(key); return next; }); }
    if (event.key === "F2") { event.preventDefault(); beginRename(key); }
    if (event.key === "Delete" || (event.metaKey && event.key === "Backspace")) { event.preventDefault(); if (checkedIds.size >= 2) setBulkArchiveOpen(true); else if (key.startsWith("folder:")) requestFolderArchive(key.slice(7)); else { const item = documents.find(item => item.id === key); if (item) { selectDocumentNow(key); setArchiveConfirm(true); } } }
  };
  const treeRowHeight = vault ? 30 : 38;
  const treeStart = Math.max(0, Math.min(Math.floor(treeScroll / treeRowHeight) - 8, treeRows.length - 45));
  const visibleRows = treeRows.slice(treeStart, treeStart + 45);
  const treeScopeLabel = ownerFilter === "mine_company" ? "내 문서 + 회사 정본" : ownerFilter === "mine" ? "내 문서" : ownerFilter === "canonical" ? "회사 정본" : ownerFilter === "team" ? "팀 공유" : ownerFilter === "review" ? "검토 문서" : ownerFilter === "archived" ? "휴지통 문서" : ownerFilter.startsWith("member:") ? `${ownerNames.get(ownerFilter.slice(7)) || "선택한 소유자"} 문서` : "전체 문서";
  const treeScopeDetail = ownerFilter === "mine_company" ? "내 문서 + 회사 정본 · 휴지통 제외" : ownerFilter === "all" ? "모든 활성 문서 · 휴지통 제외" : ownerFilter === "archived" ? treeScopeLabel : `${treeScopeLabel} · 휴지통 제외`;
  const visibleDocumentCount = demo ? filtered.length : inventory.reduce((sum, item) => sum + item.count, 0);
  const activeFolderPath = workspaceView === "folder" || workspaceView === "gallery" ? managedFolder : selected?.folder || "";
  const folderSegments = activeFolderPath.split("/").filter(Boolean);
  const folderNode = folderSegments.reduce<FolderTreeNode | null>((nodes, part) => {
    const candidates = nodes ? nodes.children : folderTree;
    return candidates.find(item => item.name === part) ?? null;
  }, null);
  const folderChildren = managedFolder ? folderNode?.children ?? [] : folderTree;
  const folderDocuments = filtered.filter(item => documentFolder(item) === (managedFolder || "분류 없음")).sort((a, b) => folderSort === "name" ? a.title.localeCompare(b.title, "ko") : folderSort === "old" ? a.updated_at.localeCompare(b.updated_at) : b.updated_at.localeCompare(a.updated_at));
  const outline = [...(dirty ? draft?.content ?? "" : selected?.content_md ?? "").matchAll(/^#{1,3}\s+(.+)$/gm)].map(match => match[1].trim()).filter(Boolean);
  const chooseScope = (value: string) => guardAction(() => { setCheckedIds(new Set()); setSelectionMode(false); setOwnerFilter(value); });

  return (
    <>
      {vault ? <header className="vault-toolbar" aria-label="문서 보관함 도구">
        <div className="vault-toolbar-tree"><button className="vault-mobile-tree" aria-label="파일 트리 보기" onClick={() => setTreeOpen(true)}><PanelLeftOpen size={18} /></button><label className="vault-scope"><span className="sr-only">보기 범위</span><select aria-label="보기 범위" value={ownerFilter} onChange={event => chooseScope(event.target.value)}>{OWNER_FILTERS.filter(item => item.id !== "archived").map(item => <option key={item.id} value={item.id}>{item.label}</option>)}{members.map(member => <option key={member.id} value={`member:${member.id}`}>{member.display_name || member.email.split("@")[0]} 문서</option>)}</select></label><span className="vault-count" aria-live="polite">{visibleDocumentCount}</span><button aria-label="새 페이지" title="새 페이지" onClick={() => openNewDocument()}><FilePlus2 size={17} /></button><details className="vault-more"><summary role="button" aria-label="새 폴더"><FolderPlus size={17}/></summary><div><button onClick={() => beginFolder("")}>최상위에 새 폴더</button><button onClick={() => beginFolder(managedFolder || selected?.folder || "")}>현재 폴더 아래 새 폴더</button></div></details></div>
        <nav className="vault-breadcrumbs" aria-label="문서 경로"><div className="vault-root-crumb"><button onClick={() => openFolderView("")}>문서 보관함</button></div>{folderSegments.map((part, index) => <span key={`${index}-${part}`}><ChevronRight size={13} /><button onClick={() => openFolderView(folderSegments.slice(0, index + 1).join("/"))}>{part}</button></span>)}{workspaceView === "document" && selected ? <span><ChevronRight size={13} /><strong>{selected.title}</strong></span> : null}<small className="vault-save-status" role="status">{newOpen ? busy ? "저장 중…" : "저장 전" : selected ? busy ? "저장 중…" : dirty ? "미저장 · 기기에 임시 보관" : `저장됨 · v${selected.current_version}` : ""}</small></nav>
        <div className="vault-toolbar-actions"><button aria-label="문서·폴더 찾기" title="문서·폴더 찾기" onClick={() => setFinderOpen(true)}><Search size={17} /></button>{selected?.status === "canonical" ? <Link className="vault-proposal" href={`/knowledge/canon/${selected.id}/propose`}>변경 제안 작성</Link> : null}{mode === "edit" && selected ? <><button className="vault-save" disabled={busy} onClick={save}><Save size={15} /> 저장</button></> : null}<button aria-label="목차·정보 패널" title="목차·정보 패널" aria-pressed={vaultPanelOpen} onClick={() => setVaultPanelOpen(value => !value)}><PanelLeftOpen size={17} /></button><details className="vault-more"><summary role="button" aria-label="더 보기"><MoreHorizontal size={18} /></summary><div>{workspaceView === "folder" || workspaceView === "gallery" ? <button onClick={openGallery}><Images size={15} /> {workspaceView === "gallery" ? "목록 보기" : "갤러리 보기"}</button> : null}{selected && selected.status !== "archived" ? <button onClick={() => openPageMove(selected)}><MoveRight size={15} /> 위치 이동</button> : null}{selected && (selected.owner_id === profile?.id || profile?.role === "admin") && nextStatus(selected.status) && statusActionLabel(selected.status) ? <button onClick={() => guardAction(() => moveStatus(nextStatus(selected.status)!))}><Send size={15} /> {statusActionLabel(selected.status)}</button> : null}{selected?.status === "review" || selected?.status === "reviewed" ? <Link href={`/knowledge/review?document=${selected.id}`}>검토 내역 보기</Link> : null}<button onClick={() => setImportOpen(true)}><Upload size={15} /> Markdown 가져오기</button><button onClick={() => void reload()}><RefreshCw size={15} /> 새로고침</button>{selected && editableSelected ? <button onClick={() => setMode(mode === "read" ? "edit" : "read")}>{mode === "read" ? "본문 입력으로" : "읽기 미리보기"}</button> : null}<button onClick={() => setHelpOpen(true)}>사용법·단축키</button></div></details></div>
      </header> : <header className="page-header workspace-page-header">
        <div className="page-title-group"><PageTitle /><p>{vault ? "개인별 원본 폴더에서 문서를 관리합니다. 02_Wiki 중 승인할 문서만 회사 정본으로 선정합니다." : "개인의 경험을 쌓고, 검토를 거쳐 회사가 함께 쓰는 정본으로 만듭니다."}</p></div>
        <div className="header-actions"><button className={`secondary-button${workspaceView === "gallery" ? " active" : ""}`} aria-pressed={workspaceView === "gallery"} onClick={openGallery}><Images size={16} /> {workspaceView === "gallery" ? "문서 보기" : "갤러리 보기"}</button><button className="secondary-button" onClick={() => guardAction(() => setFinderOpen(true))}>문서 찾기</button><button className="secondary-button knowledge-tree-toggle" aria-pressed={treeOpen} onClick={() => setTreeOpen((value) => !value)}>{treeOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />} {treeOpen ? "파일 트리 숨기기" : "파일 트리 보기"}</button><button className="secondary-button" aria-pressed={focusMode} onClick={() => setFocusMode((value) => !value)}>{focusMode ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />} {focusMode ? "전체 메뉴 보기" : "집중 모드"}</button><button className="secondary-button" onClick={() => guardAction(() => { setImportOpen(true); })}><Upload size={16} /> Markdown 가져오기</button><button className="primary-button" onClick={() => openNewDocument()}><FilePlus2 size={16} /> 새 페이지</button></div>
      </header>}


      {!vault && focusMode ? <nav className="knowledge-focus-tabs" aria-label="지식 메뉴"><Link aria-current="page" href="/knowledge/vault">문서 보관함</Link><Link href="/knowledge/canon">회사 정본</Link><Link href="/knowledge/search">지식 검색</Link></nav> : null}

      {!vault ? <div className="owner-chips">
        {OWNER_FILTERS.map((item) => <button key={item.id} aria-pressed={ownerFilter === item.id} className={ownerFilter === item.id ? "active" : ""} onClick={() => guardAction(() => { setCheckedIds(new Set()); setSelectionMode(false); setOwnerFilter(item.id); })}>{item.label}</button>)}
        {members.length > 1 ? <label className={ownerFilter.startsWith("member:") ? "active" : ""}><UserRound size={13} /><select aria-label="문서 소유자" value={ownerFilter.startsWith("member:") ? ownerFilter : ""} onChange={(event) => { const value = event.target.value; if (value) guardAction(() => setOwnerFilter(value)); }}><option value="">소유자 선택</option>{members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.display_name || member.email.split("@")[0]}</option>)}</select></label> : null}
      </div> : null}
      {error ? <div className="inline-alert danger">{error}<button onClick={() => setError("")}><X size={14} /></button></div> : null}

      <section style={{ "--knowledge-tree-width": `${paneWidth}px` } as React.CSSProperties} className={`knowledge-workspace${vault ? " vault-workspace" : ""}${vaultPanelOpen && vault ? " vault-panel-open" : ""}${!treeOpen ? " tree-hidden" : ""}${hoverTree ? " tree-peek" : ""}`}>
        {!treeOpen ? <button className="tree-peek-handle" aria-label="파일 트리 잠시 보기" onMouseEnter={() => setHoverTree(true)} onFocus={() => setHoverTree(true)} onClick={() => setTreeOpen(true)}><PanelLeftOpen size={16} /></button> : null}
        {treeOpen ? <button className="knowledge-tree-scrim" aria-label="파일 트리 닫기" onClick={() => setTreeOpen(false)} /> : null}
        <aside onMouseLeave={() => setHoverTree(false)} className={`folder-pane knowledge-tree-pane${treeOpen ? " mobile-open" : ""}`}>
          <div role="separator" aria-label="파일 트리 폭" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={460} aria-valuenow={paneWidth} tabIndex={0} className="knowledge-resize-handle" onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setPaneWidth(treeWidth(event.clientX - (event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0))); }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); setPaneWidth((width) => event.key === "Home" ? 220 : event.key === "End" ? 460 : treeWidth(width + (event.key === "ArrowRight" ? 20 : -20))); } }} />
          {vault ? <div className="vault-tree-top"><label><Search size={15} /><input aria-label="폴더·문서 이름으로 거르기" placeholder="이름으로 거르기" value={treeFilter} onChange={event => { setTreeFilter(event.target.value); setTreeScroll(0); }} />{treeFilter ? <button aria-label="거르기 지우기" onClick={() => setTreeFilter("")}><X size={14} /></button> : null}</label><button aria-label="최상위 새 폴더" title="새 폴더" onClick={() => beginFolder("")}><FolderPlus size={15}/></button></div> : <><div className="pane-title knowledge-tree-heading"><span><FolderOpen size={15} /><strong>파일 트리</strong><small>{visibleDocumentCount}개</small></span><div className="knowledge-tree-heading-actions">{hoverTree && !treeOpen ? <button onClick={() => { setTreeOpen(true); setHoverTree(false); }} aria-label="파일 트리 고정">고정</button> : null}<button title="폴더 관리" aria-label="폴더 관리" onClick={() => guardAction(() => { setError(""); setManagedFolder((current) => existingFolderOptions.includes(current) ? current : existingFolderOptions[0] ?? ""); setFolderManagerOpen(true); })}><FolderCog size={15} /></button><button aria-label="트리 안에서 접기" title="파일 트리 접기" onClick={() => { setTreeOpen(false); setHoverTree(false); }}><PanelLeftClose size={15} /></button></div></div><div className="knowledge-tree-controls"><span className="knowledge-tree-scope" title={treeScopeDetail}>{treeScopeLabel}</span><div className="knowledge-tree-control-actions"><button aria-label="폴더 안 문서 정렬" title="폴더 안 문서 정렬" onClick={() => setSortAscending((value) => !value)}>{sortAscending ? "오래된 순" : "최근 순"} <ChevronDown size={12} /></button><button aria-label="여러 문서 선택" title="여러 문서 선택" aria-pressed={selectionMode} onClick={() => { setSelectionMode((value) => !value); setCheckedIds(new Set()); }}><MoveRight size={15} /></button><button aria-label="목록 새로고침" title="목록 새로고침" disabled={busy} onClick={() => { void reload(); setRevision(value => value + 1); }}><RefreshCw size={15} /></button></div></div></>}
          {!vault && selectionMode ? <div className="knowledge-bulk-actions"><span>문서를 눌러 선택 · {checkedIds.size}개</span><button className="secondary-button" disabled={busy || !checkedIds.size} onClick={() => guardAction(() => { setMoveIds([...checkedIds]); setMoveOpen(true); })}>이동</button><button className="ghost-button" onClick={() => { setSelectionMode(false); setCheckedIds(new Set()); }}>완료</button></div> : null}
          {draggedFolder || draggedDocument ? <div className={`knowledge-root-dropzone${dropTargetFolder === "" ? " active" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDropTargetFolder(""); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDragLeave={() => setDropTargetFolder(null)} onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData("text/folder-path"), id = event.dataTransfer.getData("text/document-id"); setDraggedFolder(""); setDraggedDocument(""); setDropTargetFolder(null); if (source) openFolderManager(source, ""); else if (id) guardAction(() => { void moveDocument(id, ""); }); }}>최상위로 이동</div> : null}
          <div className="knowledge-tree-scroll" role="tree" aria-label="문서와 하위 페이지" onScroll={event => setTreeScroll(event.currentTarget.scrollTop)} onContextMenu={event => { if (event.target === event.currentTarget) openTreeContextMenu(event, {type:"folder",path:""}); }} onKeyDown={handleTreeKeyDown}>
            {folderInputRow("")}
            {listLoading && !documents.length ? <div className="list-empty"><File size={22} /><span>문서 불러오는 중</span></div> : null}
            {treeStart > 0 ? <div style={{height: treeStart * treeRowHeight}} /> : null}
            {visibleRows.map((row) => row.type === "folder" ? (
              <div className={`folder-tree-item${dropTargetFolder === row.folder.path ? " drop-target" : ""}`} key={`folder-${row.folder.path}`} onContextMenu={(event) => openTreeContextMenu(event, { type: "folder", path: row.folder.path })} onDragEnter={(event) => { event.preventDefault(); setDropTargetFolder(row.folder.path); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTargetFolder(null); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const source = event.dataTransfer.getData("text/folder-path"); const id = event.dataTransfer.getData("text/document-id"); setDraggedFolder(""); setDraggedDocument(""); setDropTargetFolder(null); if (source) openFolderManager(source, row.folder.path); else if (id) guardAction(() => { void moveDocument(id, row.folder.path); }); }}>
                {vault ? <button className="vault-folder-expand" aria-label={`${row.folder.path} ${expandedFolders.has(row.folder.path) ? "접기" : "펼치기"}`} aria-expanded={expandedFolders.has(row.folder.path)} style={{ marginLeft: 9 + row.depth * 16 }} onClick={() => { const opening = !expandedFolders.has(row.folder.path); setExpandedFolders(current => { const next = new Set(current); if (opening) next.add(row.folder.path); else next.delete(row.folder.path); return next; }); if (opening) void loadFolder(row.folder.path); }}>{expandedFolders.has(row.folder.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : null}
                <button data-vault-key={vaultFolderKey(row.folder.path)} role="treeitem" aria-level={row.depth + 1} aria-selected={checkedIds.has(vaultFolderKey(row.folder.path)) || managedFolder === row.folder.path && workspaceView === "folder"} aria-expanded={expandedFolders.has(row.folder.path)} draggable className={`folder-row folder-tree-row${managedFolder === row.folder.path && workspaceView === "folder" ? " active" : ""}`} style={{ paddingLeft: vault ? 0 : 10 + row.depth * 16 }} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/folder-path", row.folder.path); setDraggedFolder(row.folder.path); }} onDragEnd={() => { setDraggedFolder(""); setDropTargetFolder(null); }} onClick={event => { if (selectRow(event, vaultFolderKey(row.folder.path), treeRows.map(row => row.type === "folder" ? vaultFolderKey(row.folder.path) : row.document.id))) return; if (vault) { openFolderView(row.folder.path); return; } const opening = !expandedFolders.has(row.folder.path); setManagedFolder(row.folder.path); setExpandedFolders((current) => { const next = new Set(current); if (opening) next.add(row.folder.path); else next.delete(row.folder.path); return next; }); if (opening) void loadFolder(row.folder.path); }}>{!vault ? expandedFolders.has(row.folder.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}<Folder size={15} /><span>{row.folder.name}</span><small>{pendingFolders.paths.includes(row.folder.path) && !row.folder.count ? "빈 폴더" : row.folder.count}</small></button>{renameInput(vaultFolderKey(row.folder.path))}{dropTargetFolder === row.folder.path ? <span className="vault-drop-hint">{row.folder.name} 안으로</span> : null}
                <button className="folder-inline-action" title={`${row.folder.name} 폴더 작업`} aria-label={`${row.folder.path} 폴더 작업`} aria-haspopup="menu" onClick={(event) => openTreeContextMenu(event, { type: "folder", path: row.folder.path })}><MoreHorizontal size={16} /></button>
                {folderInputRow(row.folder.path)}
              </div>
            ) : (
              <div className="document-tree-select-row" key={row.document.id} onContextMenu={(event) => openTreeContextMenu(event, { type: "document", document: row.document })} onDragOver={event => { if (event.dataTransfer.types.includes("text/document-id") && draggedDocument !== row.document.id) { event.preventDefault(); setDropTargetDocument(row.document.id); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTargetDocument(""); }} onDrop={event => { event.preventDefault(); setDropTargetDocument(""); setDraggedDocument(""); const id = event.dataTransfer.getData("text/document-id"); if (id && id !== row.document.id) { const source = documentsRef.current.find(document => document.id === id); if (source) { setPageMoveDocument(source); setPageMoveFolder(row.document.folder); setPageMoveParentId(row.document.id); } } }}>
                {row.childCount ? <button type="button" className="knowledge-page-chevron" aria-label={`${row.document.title} 하위 페이지 ${collapsedPages.has(row.document.id) ? "펼치기" : "접기"}`} aria-expanded={!collapsedPages.has(row.document.id)} onClick={() => setCollapsedPages(current => { const next = new Set(current); if (next.has(row.document.id)) next.delete(row.document.id); else next.add(row.document.id); return next; })} style={{ marginLeft: 9 + row.depth * 16 }}>{collapsedPages.has(row.document.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button> : null}
                <button data-vault-key={row.document.id} role="treeitem" aria-level={row.depth + 1} aria-selected={checkedIds.has(row.document.id) || row.document.id === selectedId} aria-expanded={row.childCount ? !collapsedPages.has(row.document.id) : undefined} draggable={!selectionMode} className={`folder-row document-tree-row${row.document.id === selectedId && !selectionMode ? " active" : ""}${selectionMode && checkedIds.has(row.document.id) ? " selected-for-move" : ""}`} style={{ paddingLeft: row.childCount ? 3 : 22 + row.depth * 16 }} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/document-id", row.document.id); setDraggedDocument(row.document.id); }} onDragEnd={() => { setDraggedDocument(""); setDropTargetDocument(""); }} onClick={event => { if (selectRow(event, row.document.id, treeRows.map(row => row.type === "folder" ? vaultFolderKey(row.folder.path) : row.document.id))) return; if (!vault && selectionMode) { setCheckedIds(current => { const next = new Set(current); if (next.has(row.document.id)) next.delete(row.document.id); else next.add(row.document.id); return next; }); return; } selectDocument(row.document.id); if (window.innerWidth < 900) setTreeOpen(false); }}>
                <File size={14} /><span><strong>{row.document.title}</strong>{row.document.owner_id !== profile?.id && row.document.status !== "canonical" ? <em>{ownerNames.get(row.document.owner_id) || "소유자 미지정"}</em> : null}</span><i className={`mini-status status-${row.document.status}`} />
                </button>{renameInput(row.document.id)}{dropTargetDocument === row.document.id ? <span className="vault-drop-hint">하위 페이지로</span> : null}<button type="button" className="knowledge-page-inline-action" aria-label={`${row.document.title} 하위 페이지 추가`} title="하위 페이지 추가" onClick={() => openNewDocument(row.document.folder, row.document.id)}><FilePlus2 size={15} /></button><button type="button" className="knowledge-page-inline-action" aria-label={`${row.document.title} 페이지 작업`} title="페이지 작업" aria-haspopup="menu" onClick={event => openTreeContextMenu(event, { type: "document", document: row.document })}><MoreHorizontal size={15} /></button></div>
            ))}
            <div style={{height: Math.max(0, treeRows.length - treeStart - visibleRows.length) * treeRowHeight}} />
            {!treeRows.length && !listLoading ? <div className="list-empty"><File size={22} /><span>조건에 맞는 문서가 없습니다.</span></div> : null}
          </div>
          <div className="folder-divider" />
          <button className={`folder-row${ownerFilter === "archived" ? " active" : ""}`} onClick={() => guardAction(() => setOwnerFilter("archived"))}><Trash2 size={15} /><span>휴지통</span><small>{demo ? documents.filter((item) => item.status === "archived").length : archivedCount}</small></button>
        </aside>

        <article className="editor-pane">
          {newOpen ? <form className="knowledge-new-canvas" onSubmit={create}>
            <div className="knowledge-new-canvas-top"><span>{newFolderPath || "분류 없음"}{newParentId ? ` / ${documents.find(item => item.id === newParentId)?.title ?? "상위 페이지"}` : ""} / 새 페이지</span><div><span role="status">{busy ? attachmentProgress || "저장 중…" : newDirty ? "저장 전 · 이 화면에만 유지" : "개인 초안"}</span><button type="button" className="ghost-button" onClick={closeNewDocument} disabled={busy}>닫기</button><button className="primary-button compact" disabled={busy || (!vault && !newValues.title.trim())}>{busy ? "저장 중…" : "초안 저장"}</button></div></div>
            <div className="knowledge-new-canvas-body"><input autoFocus className="knowledge-page-title" aria-label="새 페이지 제목" placeholder="제목 없음" onKeyDown={event => { if (vault && event.key === "Enter") { event.preventDefault(); setFocusNewBody(true); } }} maxLength={200} disabled={busy} value={newValues.title} onChange={event => setNewValues(current => ({ ...current, title: event.target.value }))} aria-invalid={Boolean(fieldErrors.title)} />
              {newError ? <p className="inline-alert danger" role="alert">{newError}</p> : null}
              <section aria-label="새 페이지 본문" onPasteCapture={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); queueNewImages(files); } }} onDragOver={event => { if (event.dataTransfer.files.length) event.preventDefault(); }} onDrop={event => { const files = Array.from(event.dataTransfer.files); if (files.length) { event.preventDefault(); queueNewImages(files); } }}><KnowledgeRichEditor ref={newEditorRef} onDocumentLink={() => setNewError("먼저 저장한 뒤 문서를 연결해 주세요.")} inlineOptions={vault ? inlineOptions : undefined} key={`new-${newParentId ?? "root"}`} markdown={newValues.content} accessToken={accessToken} disabled={busy} onChange={content => setNewValues(current => ({ ...current, content }))} onError={setNewError} onRequestImage={() => newImageInputRef.current?.click()} onCreateChildPage={() => setNewError("먼저 이 페이지를 저장한 뒤 하위 페이지를 추가해 주세요.")} /></section>
              <input ref={newImageInputRef} className="knowledge-attachment-input" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" aria-label="새 페이지 이미지 선택" onChange={event => { queueNewImages(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
              {newImageFiles.length ? <div className="knowledge-new-images" role="status"><strong>저장할 때 이미지를 올리고 본문 끝에 넣습니다 · {newImageFiles.length}개</strong>{newImageFiles.map((file, index) => <div key={`${file.name}-${index}`}><span>{file.name}<button type="button" onClick={() => { setNewImageFiles(current => current.filter((_, itemIndex) => itemIndex !== index)); setNewImageAlt(current => current.filter((_, itemIndex) => itemIndex !== index)); setNewImageCaptions(current => current.filter((_, itemIndex) => itemIndex !== index)); }}>제외</button></span><input aria-label={`${file.name} 대체 텍스트`} maxLength={200} placeholder="대체 텍스트" value={newImageAlt[index] ?? ""} onChange={event => setNewImageAlt(current => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} /><input aria-label={`${file.name} 설명`} maxLength={300} placeholder="설명 (선택)" value={newImageCaptions[index] ?? ""} onChange={event => setNewImageCaptions(current => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} /></div>)}</div> : null}
              {vault ? <KnowledgeVaultProperties value={{...newValues,folder:newFolderPath}} onChange={value => {setNewValues({title:value.title,content:value.content,brand:value.brand,team:value.team,tags:value.tags});setNewFolderPath(value.folder);}} folders={folderOptions} teams={members.map(member=>member.team)} brands={documents.map(item=>item.brand)} disabled={busy} folderDisabled={Boolean(newParentId)} onCreateFolder={createEmptyFolder}/> : <>
              <details className="knowledge-page-properties"><summary>페이지 정보 · 폴더, 담당 팀, 브랜드, 태그</summary><div>{vault ? <KnowledgeVaultFolderChooser options={folderOptions} value={newFolderPath} onChange={setNewFolderPath} disabled={busy || Boolean(newParentId)} onCreate={createEmptyFolder} label="저장 위치" /> : <KnowledgeFolderPicker options={folderOptions} value={newFolderPath} onChange={setNewFolderPath} disabled={busy || Boolean(newParentId)} />}<label>담당 팀<input list="knowledge-team-options" maxLength={120} value={newValues.team} onChange={event => setNewValues(current => ({ ...current, team: event.target.value }))} /></label><label>브랜드<input list="knowledge-brand-options" maxLength={120} value={newValues.brand} onChange={event => setNewValues(current => ({ ...current, brand: event.target.value }))} /></label><label>태그<input maxLength={1859} placeholder="쉼표로 구분" value={newValues.tags} onChange={event => setNewValues(current => ({ ...current, tags: event.target.value }))} /></label></div></details>
              </>}
            </div>
          </form> : (workspaceView === "folder" || workspaceView === "gallery") && vault ? <KnowledgeVaultFolderView folder={managedFolder} folders={folderChildren} documents={folderDocuments} scopeLabel={treeScopeLabel} ownerNames={ownerNames} folderOptions={existingFolderOptions} sort={folderSort} onSort={setFolderSort} view={workspaceView} loading={listLoading} busy={busy} checkedIds={checkedIds}
            onSelectDocuments={(ids, checked) => { setSelectionMode(true); setCheckedIds(current => { const next = new Set(current); ids.forEach(id => checked ? next.add(id) : next.delete(id)); return next; }); }}
            onClearSelection={() => { setSelectionMode(false); setCheckedIds(new Set()); }} onMoveSelection={openBulkMove}
            onCreateFolder={beginFolder} onRename={key => beginRename(key, "table")} renameInput={key => renameInput(key, "table")} onSelectRow={selectRow} pendingFolders={pendingFolders.paths} onOpenFolder={openFolderView} onOpenDocument={selectDocument} onCreatePage={openNewDocument} onContextMenu={openTreeContextMenu} onViewChange={view => { if (view !== workspaceView) openGallery(); }}
            gallery={<KnowledgeGallery documents={galleryDocuments} folder={galleryFolder} token={accessToken} ownerNames={ownerNames} revision={revision} onOpen={selectDocumentNow} onRestore={() => setImageRecoveryOpen(true)} />} /> : workspaceView === "gallery" ? <KnowledgeGallery documents={galleryDocuments} folder={galleryFolder} token={accessToken} ownerNames={ownerNames} revision={revision} onOpen={selectDocumentNow} onRestore={() => setImageRecoveryOpen(true)} /> : selected && draft ? (
            <>
              {!vault ? <div className="editor-toolbar">
                <div className="editor-tabs">
                  <button className={mode === "read" ? "active" : ""} onClick={() => setMode("read")}><Eye size={15} /> 읽기</button>
                  <button className={mode === "edit" ? "active" : ""} onClick={beginEdit}><Pencil size={15} /> {selected.status === "canonical" ? "정본 편집" : "편집"}</button>
                  <button className={mode === "info" ? "active" : ""} onClick={() => setMode("info")}><Clock3 size={15} /> 정보</button>
                </div>
                <div className="editor-actions">
                  {mode === "edit" ? <button className="primary-button compact" onClick={save} disabled={busy}><Save size={14} /> 저장</button> : null}
                  {selected.status !== "archived" ? <button className="secondary-button compact" onClick={() => openPageMove(selected)} disabled={busy}><MoveRight size={14} /> 위치 이동</button> : null}
                  {(selected.owner_id === profile?.id || profile?.role === "admin") && nextStatus(selected.status) && statusActionLabel(selected.status) ? <button className="secondary-button compact" onClick={() => guardAction(() => moveStatus(nextStatus(selected.status)!))} disabled={busy}><Send size={14} /> {statusActionLabel(selected.status)}</button> : null}
                  {selected.status === "reviewed" ? <Link className="primary-button compact" href={`/knowledge/review?document=${selected.id}`}><BookCheck size={14} /> 승인 화면에서 공개</Link> : null}
                  {selected.status === "review" ? <><Link className="secondary-button compact" href={`/knowledge/review?document=${selected.id}`}>검토함에서 보기</Link>{selected.owner_id === profile?.id || profile?.role === "admin" ? <button className="secondary-button compact" disabled={busy} onClick={() => guardAction(() => moveStatus("draft"))}>검토 회수 (초안)</button> : null}</> : null}
                  <button className="icon-button" title="문서 정보" aria-label="문서 정보" onClick={() => setMode("info")}><MoreHorizontal size={17} /></button>
                </div>
              </div> : null}
              {recovery && vault && editableSelected ? <div className="vault-recovery" role="status">이 기기에 임시 보관한 내용이 있습니다 ({new Date(recovery.value.savedAt).toLocaleTimeString("ko-KR", {hour: "2-digit", minute: "2-digit", hour12: false})}).{recovery.value.baseVersion !== selected.current_version ? " 서버 버전이 달라 비교가 필요합니다." : ""}<button onClick={() => { resume(); setEditorRecoveryRevision(value => value + 1); setMode("edit"); if (recovery.value.baseVersion !== selected.current_version) setConflict(selected); }}>이어 쓰기</button><button onClick={() => discard()}>버리기</button></div> : null}{vault && !canEditVaultDocument(selected, profile) ? <p className="vault-readonly-hint">읽기 전용 · 정본은 변경 제안으로, 검토 중 문서는 검토 절차에서 수정합니다.</p> : null}<div className="document-meta-line"><span className={`status-pill status-${selected.status}`}>{statusLabel(selected.status)}</span><span>v{selected.current_version}</span><span>마지막 수정 {formatDate(selected.updated_at)}</span>{dirty ? <strong role="status">저장하지 않은 변경 있음</strong> : null}</div>
              {mode === "edit" ? (
                <div className={`document-editor${attachmentDragActive ? " attachment-drag-active" : ""}`} onDragEnter={enterAttachmentDrop} onDragLeave={leaveAttachmentDrop} onDragOver={(event) => { if (editorDragHasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; placeAttachmentDrop(event); } }} onDrop={dropAttachments}>
                  {attachmentDragActive ? <div className="knowledge-attachment-drop-overlay" role="status"><Paperclip size={28} /><strong>여기에 놓아 자료 첨부</strong><span>이미지·영상·문서·압축 파일을 한 번에 최대 10개까지 올릴 수 있습니다.</span></div> : null}
                  {selected.status === "canonical" ? <div className="canonical-edit-banner"><ShieldAlert size={18} /><span><strong>회사 정본을 편집하고 있습니다.</strong><small>저장하면 전 직원과 AI 검색에 반영되며, 이전 내용은 버전으로 보존됩니다.</small></span></div> : null}
                  <input className="title-input" maxLength={200} disabled={busy} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} aria-label="문서 제목" />
                  {vault ? <KnowledgeVaultProperties value={draft} onChange={setDraft} folders={folderOptions} teams={members.map(member => member.team)} brands={documents.map(item => item.brand)} disabled={busy} onCreateFolder={createEmptyFolder}/> : <>
                  <div className="meta-input-grid">
                    {vault ? <details className="vault-property-folder"><summary>폴더 · {draft.folder || "미분류"}</summary><KnowledgeVaultFolderChooser options={folderOptions} value={draft.folder} onChange={folder => setDraft({ ...draft, folder })} disabled={busy} onCreate={createEmptyFolder}/></details> : <KnowledgeFolderPicker options={folderOptions} value={draft.folder} onChange={folder => setDraft({ ...draft, folder })} disabled={busy} />}
                    <label><span><UserRound size={13} /> 팀</span><input list="knowledge-team-options" disabled={busy} maxLength={120} value={draft.team} onChange={(event) => setDraft({ ...draft, team: event.target.value })} /></label>
                    <label><span><BookCheck size={13} /> 브랜드</span><input list="knowledge-brand-options" disabled={busy} maxLength={120} value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label>
                    <label><span><Tag size={13} /> 태그</span><input disabled={busy} maxLength={1859} value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="쉼표로 구분" /></label>
                  </div>
                  </>}
                  <div className="markdown-toolbar knowledge-insert-toolbar" aria-label="문서 자료 도구"><button type="button" title="다른 OS 문서 연결" onClick={() => setLinkQuery("")}><Link2 size={14} /> OS 문서 연결</button><button type="button" title="웹 링크 넣기" onClick={() => { setExternalLinkError(""); setExternalLinkOpen(true); }}><Link2 size={14} /> 웹 링크</button><button type="button" title="이미지·영상·파일 올리기" disabled={busy} onClick={() => attachmentInputRef.current?.click()}><Paperclip size={14} /> 자료 첨부</button><input ref={attachmentInputRef} className="knowledge-attachment-input" type="file" multiple tabIndex={-1} aria-hidden="true" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,application/pdf,text/plain,text/csv,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip" onChange={(event) => void attachFiles(event.target.files)} /></div>
                  {attachmentProgress ? <p className="knowledge-attachment-progress" role="status">{attachmentProgress}</p> : null}
                  <p className="knowledge-markdown-help"><strong>바로 서식이 적용되는 편집기</strong><span>줄 맨 앞에서 <code>##</code> 제목 · <code>###</code> 소제목 · <code>-</code> 목록 · <code>&gt;</code> 인용을 입력하고 공백을 누르세요. 이미지는 원하는 줄에 놓거나, 첨부 뒤 이미지를 끌어 문단 사이로 옮길 수 있습니다.</span></p>
                  <section className="knowledge-live-editor" aria-label="문서 바로 편집 영역">
                    <KnowledgeRichEditor key={`${selected.id}:${editorRecoveryRevision}`} ref={editorRef} onDocumentLink={() => setLinkQuery("")} inlineOptions={vault ? inlineOptions : undefined} markdown={draft.content} accessToken={accessToken} disabled={busy} onChange={(content) => setDraft({ ...draft, content })} onError={setError} onRequestImage={() => attachmentInputRef.current?.click()} onCreateChildPage={() => openNewDocument(selected.folder, selected.id)} />
                  </section>
                  {selectedChildren.length ? <section className="knowledge-child-pages" aria-label="하위 페이지"><strong>하위 페이지</strong>{selectedChildren.map(child => <button type="button" key={child.id} onClick={() => selectDocument(child.id)}><File size={14} /> {child.title}</button>)}</section> : null}
                </div>
              ) : mode === "info" ? (
                <div className="document-info">
                  <h2>문서 정보</h2>
                  <dl><div><dt>상태</dt><dd>{statusLabel(selected.status)}</dd></div><div><dt>소유자</dt><dd>{ownerNames.get(selected.owner_id) || "소유자 미지정"}</dd></div><div><dt>현재 버전</dt><dd>v{selected.current_version}</dd></div><div><dt>폴더</dt><dd>{selected.folder || "분류 없음"}</dd></div><div><dt>브랜드</dt><dd>{selected.brand || "전체"}</dd></div><div><dt>담당 팀</dt><dd>{selected.team || "전체"}</dd></div><div><dt>원본</dt><dd>{selected.source}</dd></div></dl>
                  {Object.hasOwn(selected, "steward_id") ? <label>문서 담당<select aria-label="문서 담당" value={selected.steward_id ?? ""} disabled={busy || demo || profile?.role !== "admin"} onChange={(event) => void saveDocumentSteward(event.target.value)}><option value="">담당 없음</option>{members.filter(member => member.is_active).map(member => <option key={member.id} value={member.id}>{member.display_name || member.email}</option>)}</select></label> : <p className="inline-alert">문서 담당 기능은 개발 DB 적용 후 사용할 수 있습니다.</p>}
                  <h3>문서 상태 흐름</h3><p>정본 공개는 작성자와 다른 지정 승인자 또는 위임자가 검토 후 처리합니다.</p><div className="status-flow">{STATUS_FLOW.map((status, index) => <div key={status} className={selected.status === "canonical" || STATUS_FLOW.indexOf(selected.status) >= index ? "done" : ""}><span>{index + 1}</span><small>{statusLabel(status)}</small></div>)}</div>
                  <KnowledgeReviewHistory id={selected.id} token={accessToken} demo={demo} revision={selected.updated_at} />
                  <h3>변경 이력</h3>
                  <div className="version-history">{versionsLoading ? <div className="quiet-state">변경 이력을 불러오는 중입니다.</div> : versions.map((version) => <div key={version.version_no}><span><strong>v{version.version_no} · {version.author_name}</strong><small>{formatDate(version.created_at)}{version.reason ? ` · ${version.reason}` : ""}</small></span>{version.version_no !== selected.current_version ? <button className="ghost-button" disabled={busy} onClick={() => guardAction(() => {setError(""); setCompareBase(documentsRef.current.find(item => item.id === selected.id) ?? selected); setCompareVersion(version);})}><RotateCcw size={13} /> 비교·복원</button> : <em>현재</em>}</div>)}</div>
                  <h3>문서 연결</h3><div className="knowledge-links"><div><strong>나가는 링크</strong>{wikiLinks(selected.content_md).map((link) => <span key={link}><Link2 size={12} /> {link}</span>)}{!wikiLinks(selected.content_md).length ? <small>본문에 [[문서명]]을 입력하면 연결됩니다.</small> : null}</div><div><strong>백링크</strong>{backlinks.map((item) => <button key={item.id} onClick={() => { selectDocument(item.id); }}><Link2 size={12} /> {item.title}</button>)}{!backlinks.length ? <small>이 문서를 가리키는 문서가 없습니다.</small> : null}</div></div>
                  {selected.status !== "archived" ? <button className="ghost-button archive-action" onClick={() => guardAction(() => {setError("");setArchiveConfirm(true);})}><Archive size={15} /> 휴지통으로 이동</button> : <button className="ghost-button archive-action" onClick={() => guardAction(() => {setError("");setArchiveConfirm(true);})}><RotateCcw size={15} /> 초안으로 복원</button>}
                </div>
              ) : (
                <KnowledgeInlineProvider documentId={selected.id} revision={revision} onRelink={requestImageRelink}><div className="document-reader">{dirty ? <p className="inline-alert">미저장 내용 미리보기 · 저장해야 다른 사람에게 반영됩니다.</p> : null}<h1>{dirty ? draft.title : selected.title}</h1><div className="reader-tags">{selected.tags.map((tag) => <span key={tag}><Hash size={11} />{tag}</span>)}</div>{readingContent.metadata.length ? <details className="reader-metadata"><summary>문서 속성 {readingContent.metadata.length}개</summary><dl>{readingContent.metadata.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><WikiInline text={item.value} onOpenLink={openWikiLink} /></dd></div>)}</dl></details> : null}<MarkdownView key={selected.id} content={readingContent.body} onOpenLink={openWikiLink} />{selectedChildren.length || selected.status !== "archived" ? <section className="knowledge-child-pages" aria-label="하위 페이지"><strong>하위 페이지</strong>{selectedChildren.map(child => <button type="button" key={child.id} onClick={() => selectDocument(child.id)}><File size={14} /> {child.title}</button>)}{selected.status !== "archived" ? <button type="button" onClick={() => openNewDocument(selected.folder, selected.id)}><FilePlus2 size={14} /> 하위 페이지 추가</button> : null}</section> : null}<DevelopmentDocumentLiveLog token={accessToken} documentId={selected.id} demo={demo} /></div></KnowledgeInlineProvider>
              )}
            </>
          ) : (
            <div className="empty-state"><div><span><FilePenLine /></span><h3>{listLoading ? "문서를 불러오는 중입니다" : visibleDocumentCount ? `${treeScopeLabel} ${visibleDocumentCount}개` : "이 범위에 문서가 없습니다"}</h3><p>{listLoading ? "문서 목록을 확인하고 있습니다." : visibleDocumentCount ? treeOpen ? "왼쪽 파일 트리에서 문서를 선택하세요." : "파일 트리를 열면 문서를 볼 수 있습니다." : ownerFilter === "all" ? "새 문서를 만들어 시작할 수 있습니다." : "전체 문서에서 다른 범위의 문서를 확인할 수 있습니다."}</p>{!listLoading && !treeOpen && visibleDocumentCount > 0 ? <button className="primary-button" onClick={() => setTreeOpen(true)}>파일 트리 보기</button> : null}{!listLoading && !visibleDocumentCount && ownerFilter !== "all" ? <button className="primary-button" onClick={() => setOwnerFilter("all")}>전체 문서 보기</button> : null}<button className="secondary-button" onClick={() => openNewDocument()}>새 문서</button></div></div>
          )}
        </article>
        {vault && vaultPanelOpen ? <aside className="vault-side-panel" aria-label="목차와 문서 정보"><div className="vault-side-tabs" role="tablist" aria-label="문서 상세">{(selected && workspaceView === "document" ? [ ["toc", "목차"], ["info", "정보"], ["links", "연결"], ["versions", "버전"] ] as const : [["info", "폴더 정보"]] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={workspaceView !== "document" || vaultPanelTab === key} onClick={() => setVaultPanelTab(key)}>{label}</button>)}<button className="vault-side-close" aria-label="패널 닫기" onClick={() => setVaultPanelOpen(false)}><X size={16} /></button></div><div className="vault-side-body">{selected && workspaceView === "document" ? vaultPanelTab === "toc" ? outline.length ? outline.map((title, index) => <button className="vault-outline-link" key={`${title}-${index}`} onClick={() => revealHeading(`wiki-heading-${title.normalize("NFC")}`)}>{title}</button>) : <p>본문의 제목이 여기에 표시됩니다.</p> : vaultPanelTab === "info" ? <dl><div><dt>상태</dt><dd>{statusLabel(selected.status)}</dd></div><div><dt>소유자</dt><dd>{ownerNames.get(selected.owner_id) || "소유자 미지정"}</dd></div><div><dt>폴더</dt><dd>{selected.folder || "분류 없음"}</dd></div><div><dt>버전</dt><dd>v{selected.current_version}</dd></div><div><dt>수정</dt><dd>{formatDate(selected.updated_at)}</dd></div><div><dt>팀</dt><dd>{selected.team || "미지정"}</dd></div><div><dt>브랜드</dt><dd>{selected.brand || "미지정"}</dd></div></dl> : vaultPanelTab === "links" ? <><h3>나가는 연결</h3>{wikiLinks(selected.content_md ?? "").length ? wikiLinks(selected.content_md ?? "").map(link => <button key={link} onClick={() => void openWikiLink(link)}>{link}</button>) : <p>연결된 문서가 없습니다.</p>}<h3>이 문서를 가리킴</h3>{backlinks.length ? backlinks.map(item => <button key={item.id} onClick={() => selectDocument(item.id)}>{item.title}</button>) : <p>아직 없습니다.</p>}</> : <>{versionsLoading ? <p>버전을 불러오는 중입니다.</p> : versions.map(version => <div className="vault-version" key={version.version_no}><span>v{version.version_no} · {formatDate(version.created_at)}</span>{version.version_no !== selected.current_version ? <button onClick={() => guardAction(() => { setCompareBase(selected); setCompareVersion(version); })}>비교·복원</button> : <em>현재</em>}</div>)}</> : <><h3>폴더 정보</h3><p>{managedFolder || "전체 폴더"}</p><p>하위 폴더 {folderChildren.length}개</p><p>이 폴더 문서 {folderDocuments.length}개</p></>}</div></aside> : null}
      </section>
      <input ref={relinkInputRef} className="knowledge-attachment-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" tabIndex={-1} aria-hidden="true" onChange={(event) => void connectOriginalImage(event.target.files?.[0])} />
      {imageRecoveryOpen ? <KnowledgeImageRecovery token={accessToken} folder={galleryFolder} onClose={() => setImageRecoveryOpen(false)} onChanged={() => setRevision((value) => value + 1)} /> : null}

      {treeContextMenu ? <div className="knowledge-tree-context-menu" role="menu" aria-label={treeContextMenu.target.type === "folder" ? `${treeContextMenu.target.path} 폴더 메뉴` : `${treeContextMenu.target.document.title} 문서 메뉴`} style={{ left: treeContextMenu.x, top: treeContextMenu.y }}>
        {treeContextMenu.target.type === "folder" && !treeContextMenu.target.path ? <><strong>최상위</strong><button role="menuitem" onClick={() => beginFolder("")}><FolderPlus size={14}/>최상위에 새 폴더</button><button role="menuitem" onClick={() => { setTreeContextMenu(null); openNewDocument(""); }}><FilePlus2 size={14}/>최상위에 새 페이지</button></> : treeContextMenu.target.type === "folder" ? <>
          <strong>{treeContextMenu.target.path.split("/").at(-1)}</strong>
          {vault ? <><button role="menuitem" onClick={() => beginRename(vaultFolderKey(treeContextMenu.target.type === "folder" ? treeContextMenu.target.path : ""), treeContextMenu.surface)}><Pencil size={14} /> 이름 변경 <kbd>F2</kbd></button><button role="menuitem" onClick={() => openFolderManager(treeContextMenu.target.type === "folder" ? treeContextMenu.target.path : "")}><MoveRight size={14}/> 위치 이동 <kbd>⌘⇧M</kbd></button><button role="menuitem" onClick={() => beginFolder(treeContextMenu.target.type === "folder" ? treeContextMenu.target.path : "")}><FolderPlus size={14}/> 새 하위 폴더</button></> : <button role="menuitem" onClick={() => openFolderManager(treeContextMenu.target.type === "folder" ? treeContextMenu.target.path : "")}><Pencil size={14} /> 이름·위치 변경</button>}
          <button role="menuitem" onClick={() => { const path = treeContextMenu.target.type === "folder" ? treeContextMenu.target.path : ""; setTreeContextMenu(null); openNewDocument(path); }}><FilePlus2 size={14} /> 이 폴더에 새 페이지</button>
          <button role="menuitem" className="danger" disabled={ownerFilter === "archived"} onClick={() => { if (treeContextMenu.target.type === "folder") requestFolderArchive(treeContextMenu.target.path); }}><Trash2 size={14} /> 폴더 문서 휴지통으로{vault ? <small> · 문서 {treeContextMenu.target.type === "folder" ? folderDocumentCount(treeContextMenu.target.path) : 0}개</small> : null}</button>
        </> : <>
          <strong>{treeContextMenu.target.document.title}</strong><button role="menuitem" onClick={() => { if (treeContextMenu.target.type === "document") selectDocument(treeContextMenu.target.document.id); setTreeContextMenu(null); }}>열기</button><button role="menuitem" onClick={() => { if (treeContextMenu.target.type === "document") void navigator.clipboard.writeText(`${window.location.origin}/knowledge/vault?document=${treeContextMenu.target.document.id}`).then(() => setToast("문서 링크를 복사했습니다.")).catch(() => setError("링크를 복사하지 못했습니다.")); setTreeContextMenu(null); }}>문서 링크 복사</button>
          <button role="menuitem" onClick={() => { const document = treeContextMenu.target.type === "document" ? treeContextMenu.target.document : null; setTreeContextMenu(null); if (document) openNewDocument(document.folder, document.id); }}><FilePlus2 size={14} /> 하위 페이지 추가</button>
          <button role="menuitem" onClick={() => { const document = treeContextMenu.target.type === "document" ? treeContextMenu.target.document : null; setTreeContextMenu(null); if (document) { if (vault) beginRename(document.id, treeContextMenu.surface); else guardAction(() => { setError(""); setRenameDocument(document); setRenameTitle(document.title); }); } }}><Pencil size={14} /> 이름 변경 <kbd>F2</kbd></button>
          <button role="menuitem" onClick={() => { const document = treeContextMenu.target.type === "document" ? treeContextMenu.target.document : null; setTreeContextMenu(null); if (document) openPageMove(document); }}><MoveRight size={14} /> 페이지·폴더 이동</button>
          <button role="menuitem" className={treeContextMenu.target.document.status === "archived" ? "" : "danger"} onClick={() => { const document = treeContextMenu.target.type === "document" ? treeContextMenu.target.document : null; setTreeContextMenu(null); if (document) guardAction(() => { selectDocumentNow(document.id); setArchiveConfirm(true); }); }}>{treeContextMenu.target.document.status === "archived" ? <RotateCcw size={14} /> : <Trash2 size={14} />} {treeContextMenu.target.document.status === "archived" ? "초안으로 복원" : "휴지통으로 이동"}</button>
        </>}
      </div> : null}

      {(quickOpen || (mode === "edit" && linkQuery !== null)) ? <div className="document-quick-open" role="dialog" aria-label={quickOpen ? "문서 빠른 열기" : "문서 링크 자동완성"}>
        <button className="icon-button" aria-label="빠른 열기 닫기" onClick={() => { setQuickOpen(false); setLinkQuery(null); }}><X size={16}/></button>
        <input autoFocus aria-label="문서 찾기" value={linkQuery ?? ""} onChange={event => setLinkQuery(event.target.value)} placeholder="문서 이름 또는 원본 파일명" />
        {linkChoices.map(item => <button key={item.id} onClick={() => chooseLink(item)}><strong>{item.title}</strong><small>{item.source_ref || item.folder}</small></button>)}
      </div> : null}
      {pendingNewAction ? <KnowledgeModal title="작성 중인 새 문서" onClose={() => setPendingNewAction(null)}>
        <div className="form-modal"><header><h2>작성 중인 새 페이지가 있습니다</h2></header><div className="form-fields"><p>아직 저장하지 않았습니다. 계속 작성하거나 내용을 저장·버리고 이동할 수 있습니다.</p>{newError ? <p role="alert" className="inline-alert danger">{newError}</p> : null}</div><footer>
          <button className="ghost-button" onClick={() => setPendingNewAction(null)}>계속 작성</button>
          <button className="secondary-button" onClick={() => { const action = pendingNewAction; setPendingNewAction(null); setNewValues({ title: "", content: "", brand: "", team: "", tags: "" }); setNewImageFiles([]); setNewImageAlt([]); setNewImageCaptions([]); setNewOpen(false); action(); }}>버리고 이동</button>
          <button className="primary-button" disabled={busy || (!vault && !newValues.title.trim())} onClick={async () => { const action = pendingNewAction; if (await createPage()) { setPendingNewAction(null); action(); } }}>저장하고 이동</button>
        </footer></div>
      </KnowledgeModal> : null}
      {pendingAction ? <KnowledgeModal title="저장하지 않은 변경" onClose={() => setPendingAction(null)} busy={busy}>
        <div className="form-modal"><header><h2>저장하지 않은 변경이 있습니다</h2></header><div className="form-fields"><p>변경을 저장한 뒤 계속하거나, 버리고 이동할 수 있습니다.</p>{error ? <p role="alert" className="inline-alert danger">{error}</p> : null}</div><footer>
          <button className="ghost-button" disabled={busy} onClick={() => setPendingAction(null)}>계속 편집</button>
          <button className="secondary-button" disabled={busy} onClick={() => { const action = pendingAction; void discardAndContinue(action); }}>변경 버리기</button>
          <button className="primary-button" disabled={busy} onClick={async () => { const action = pendingAction; if (await save()) { setPendingAction(null); action(); } }}>저장하고 계속</button>
        </footer></div>
      </KnowledgeModal> : null}
      {moveOpen ? <KnowledgeDocumentMover vault={vault} onCreateFolder={createEmptyFolder} onFolderMoved={pendingFolders.rename} selectedFolders={[...checkedIds].filter(key => key.startsWith("folder:")).map(key => key.slice(7))} documents={documents.filter(document => moveIds.includes(document.id))} options={folderOptions} token={accessToken} demo={demo} onSaved={(document, previous) => { commitDocument(document, previous); discard(document.id); }} onBusy={setBusy} onClose={() => { setMoveOpen(false); setCheckedIds(new Set()); setSelectionMode(false); }} /> : null}
      {pageMoveDocument ? <KnowledgeModal title="페이지 위치 이동" onClose={() => setPageMoveDocument(null)} busy={busy}><div className="form-modal folder-action-modal"><header><h2>페이지 위치 이동</h2></header><div className="form-fields"><p className="wide"><strong>{pageMoveDocument.title}</strong>와 하위 페이지를 함께 옮깁니다. 폴더와 상위 페이지는 별개입니다.</p><div className="wide">{vault ? <KnowledgeVaultFolderChooser options={folderOptions} label="이동할 폴더" value={pageMoveFolder} onChange={folder => { setPageMoveFolder(folder); setPageMoveParentId(null); }} disabled={busy} onConfirm={folder => void savePageMove(folder, null)} onCreate={createEmptyFolder}/> : <KnowledgeFolderPicker options={folderOptions} label="이동할 폴더" value={pageMoveFolder} onChange={folder => { setPageMoveFolder(folder); setPageMoveParentId(null); }} disabled={busy} />}</div><label className="wide">상위 페이지<select value={pageMoveParentId ?? ""} disabled={busy} onChange={event => setPageMoveParentId(event.target.value || null)}><option value="">없음 · 폴더 바로 아래</option>{documents.filter(document => document.id !== pageMoveDocument.id && document.status !== "archived" && document.folder === pageMoveFolder && canReparentKnowledgePage(documents, pageMoveDocument.id, document.id)).map(document => <option key={document.id} value={document.id}>{document.title}</option>)}</select></label>{error ? <p className="inline-alert danger wide" role="alert">{error}</p> : null}</div><footer><button className="ghost-button" disabled={busy} onClick={() => setPageMoveDocument(null)}>취소</button><button className="primary-button" disabled={busy} onClick={() => void savePageMove()}>{busy ? "이동 중…" : "위치 이동"}</button></footer></div></KnowledgeModal> : null}
      {folderManagerOpen ? <KnowledgeFolderManager vault={vault} initialName={folderManagerName} localOnly={pendingFolders.paths.includes(managedFolder) && !documents.some(item => item.folder === managedFolder || item.folder.startsWith(`${managedFolder}/`)) && !inventory.some(item => item.path === managedFolder || item.path.startsWith(`${managedFolder}/`))} onFolderMoved={(source, destination) => { pendingFolders.rename(source, destination); setManagedFolder(destination); }} onCreateFolder={createEmptyFolder} source={managedFolder} initialParent={folderManagerParent} options={folderOptions} documents={documents} token={accessToken} demo={demo} onClose={() => { setFolderManagerOpen(false); setFolderManagerParent(undefined); setFolderManagerName(undefined); }} onSaved={commitDocument} onBusy={setBusy} onNew={folder => { setFolderManagerOpen(false); setFolderManagerParent(undefined); setFolderManagerName(undefined); openNewDocument(folder); }} /> : null}
      {renameDocument ? <KnowledgeModal title="문서 이름 변경" onClose={() => setRenameDocument(null)} busy={busy}><form className="form-modal knowledge-rename-modal" onSubmit={(event) => { event.preventDefault(); void renameContextDocument(); }}><header><h2>문서 이름 변경</h2></header><div className="form-fields"><label className="wide"><span>새 문서 이름</span><input autoFocus required maxLength={200} disabled={busy} value={renameTitle} onChange={event => setRenameTitle(event.target.value)} /></label>{error ? <p role="alert" className="inline-alert danger wide">{error}</p> : null}</div><footer><button type="button" className="secondary-button" disabled={busy} onClick={() => setRenameDocument(null)}>취소</button><button className="primary-button" disabled={busy || !renameTitle.trim()}>{busy ? "변경 중…" : "이름 변경"}</button></footer></form></KnowledgeModal> : null}
      {folderDeletePath ? <KnowledgeModal title="폴더 문서 휴지통 이동" onClose={() => setFolderDeletePath("")} busy={busy}><div className="form-modal folder-delete-modal"><header><h2>폴더를 정리할까요?</h2></header><div className="form-fields"><p className="wide"><strong>{folderDeletePath}</strong><br/>이 폴더와 모든 하위 폴더의 활성 문서를 휴지통으로 옮깁니다. 본문과 변경 이력은 보존되며 문서별로 복원할 수 있습니다.</p>{error ? <p role="alert" className="inline-alert danger wide">{error}</p> : null}</div><footer><button className="secondary-button" disabled={busy} onClick={() => setFolderDeletePath("")}>취소</button><button className="primary-button danger-button" disabled={busy} onClick={() => void archiveFolderDocuments()}>{busy ? "처리 중…" : "폴더 문서 휴지통으로"}</button></footer></div></KnowledgeModal> : null}
      {canonicalGate ? <KnowledgeModal title="회사 정본 변경 제안" onClose={() => setCanonicalGate(false)}><div className="canonical-gate-modal"><ShieldAlert size={28} /><h2>정본에 변경을 제안합니다</h2><p>저장해도 기존 정본은 바로 바뀌지 않습니다. 작성자와 다른 승인자가 변경 내용을 확인하고 승인하면 새 버전으로 반영됩니다.</p><div className="drawer-actions"><button className="ghost-button" onClick={() => setCanonicalGate(false)}>취소</button><button className="primary-button" onClick={() => { setCanonicalGate(false); setMode("edit"); }}>변경 제안 작성</button></div></div></KnowledgeModal> : null}
      {externalLinkOpen ? <KnowledgeModal title="웹 링크 넣기" onClose={() => setExternalLinkOpen(false)}><form className="form-modal knowledge-link-modal" onSubmit={addExternalLink}><header><h2>웹 링크 넣기</h2></header><div className="form-fields"><label className="wide"><span>표시할 이름</span><input name="label" maxLength={200} placeholder="예: 참고 자료" /></label><label className="wide"><span>웹 주소</span><input name="url" type="url" required maxLength={2000} placeholder="https://…" autoFocus /></label>{externalLinkError ? <p role="alert" className="inline-alert danger wide">{externalLinkError}</p> : null}</div><footer><button type="button" className="secondary-button" onClick={() => setExternalLinkOpen(false)}>취소</button><button className="primary-button">본문에 넣기</button></footer></form></KnowledgeModal> : null}
      {finderOpen ? <KnowledgeDocumentFinder token={accessToken} demo={demo} onClose={() => setFinderOpen(false)} onSelect={document => {setDocuments(current => current.some(row => row.id === document.id) ? current : [document,...current]); setOwnerFilter(document.status === "archived" ? "archived" : "all"); selectDocumentNow(document.id); setFinderOpen(false); setTreeOpen(vault && !window.matchMedia("(max-width: 899px)").matches);}} /> : null}
      {importOpen ? <KnowledgeImport token={accessToken} demo={demo} ownerId={profile?.id ?? "demo-ricky"} team={profile?.team ?? ""} options={folderOptions} onSaved={commitDocument} onBusy={setBusy} onClose={() => setImportOpen(false)} /> : null}
      {compareVersion && compareBase ? <KnowledgeVersionComparison title="이전 버전 비교·복원" left={{label:`v${compareVersion.version_no} 복원할 내용`,title:compareVersion.title,content:compareVersion.content_md}} right={{label:`현재 v${compareBase.current_version}`,title:compareBase.title,content:compareBase.content_md}} action={`v${compareVersion.version_no} 내용을 새 버전으로 복원`} busy={busy} error={error} onClose={() => {setCompareVersion(null);setCompareBase(null);}} onAction={() => void restoreVersion(compareVersion)} /> : null}
      {conflict && draft ? <KnowledgeVersionComparison title="저장 충돌 · 작성 내용 유지됨" left={{label:`최신 v${conflict.current_version}`,title:conflict.title,content:conflict.content_md,properties:{폴더:conflict.folder,팀:conflict.team,브랜드:conflict.brand,태그:conflict.tags.join(", ")}}} right={{label:"내 미저장 내용",title:draft.title,content:draft.content,properties:{폴더:draft.folder,팀:draft.team,브랜드:draft.brand,태그:draft.tags}}} action="내 내용을 유지하고 최신 버전 기준으로 계속 편집" busy={busy} error="이 버튼은 저장하지 않습니다. 최신 내용과 내 내용을 비교·수정한 뒤 다시 저장하세요. 직접 변경한 값은 유지하고, 변경하지 않은 분류 항목은 최신 값으로 맞춥니다." onClose={() => setConflict(null)} onAction={() => {commitDocument(conflict);rebase(conflict);setConflict(null);setError("");setMode("edit");}} /> : null}
      {archiveConfirm && selected ? <KnowledgeModal title={selected.status === "archived" ? "초안으로 복원" : "휴지통으로 이동"} onClose={() => setArchiveConfirm(false)} busy={busy}><div className="form-modal"><header><h2>{selected.status === "archived" ? "초안으로 복원" : "휴지통으로 이동"}</h2></header><div className="form-fields"><p className="wide"><strong>{selected.title}</strong><br/>{selected.status === "archived" ? "개인 초안으로 복원합니다. 이전 팀 공유·회사 정본 상태는 자동으로 복원하지 않습니다." : "활성 문서 목록과 검색에서 제외합니다. 본문과 변경 이력은 보존되며, 휴지통에서 초안으로 복원할 수 있습니다."}</p>{error ? <p role="alert" className="inline-alert danger">{error}</p> : null}</div><footer><button className="secondary-button" disabled={busy} onClick={() => setArchiveConfirm(false)}>취소</button><button className="primary-button" disabled={busy} onClick={() => void moveStatus(selected.status === "archived" ? "draft" : "archived")}>{busy ? "처리 중…" : selected.status === "archived" ? "초안으로 복원" : "휴지통으로 이동"}</button></footer></div></KnowledgeModal> : null}
      <datalist id="knowledge-team-options">{[...new Set([...members.map(member => member.team), ...documents.map(document => document.team)].filter(Boolean))].sort().map(value => <option key={value} value={value}/>)}</datalist>
      <datalist id="knowledge-brand-options">{[...new Set(documents.map(document => document.brand).filter(Boolean))].sort().map(value => <option key={value} value={value}/>)}</datalist>
{vault && moveUndo ? <div className="vault-move-undo" role="status">문서 이동 완료<button disabled={busy} onClick={() => guardAction(() => { const undo = moveUndo; setMoveUndo(null); void moveDocument(undo.id, undo.folder, true); })}>되돌리기</button></div> : null}{vault && checkedIds.size >= 2 ? <div className="vault-bulk-bar" role="region" aria-label="선택 항목 작업"><span>{checkedIds.size}개 선택</span><button disabled={busy} onClick={openBulkMove}>이동</button><button disabled={busy} onClick={() => setBulkArchiveOpen(true)}>휴지통</button><button aria-label="선택 해제" onClick={() => setCheckedIds(new Set())}><X size={14}/></button></div> : null}
      {bulkArchiveOpen ? <KnowledgeModal title="선택 항목 휴지통 이동" onClose={() => setBulkArchiveOpen(false)} busy={busy}><div className="form-modal"><header><h2>선택한 항목을 휴지통으로 옮길까요?</h2></header><div className="form-fields"><p>회사 정본과 권한 없는 문서는 제외합니다. 문서 ID·본문·이력을 보존합니다.</p></div><footer><button disabled={busy} onClick={() => setBulkArchiveOpen(false)}>취소</button><button disabled={busy} onClick={() => void archiveSelection()}>휴지통으로 이동</button></footer></div></KnowledgeModal> : null}
      {helpOpen ? <KnowledgeModal title="문서 보관함 사용법·단축키" onClose={() => setHelpOpen(false)}><div className="form-modal vault-help"><header><h2>문서 보관함 사용법</h2></header><div className="form-fields"><ol><li>개인 폴더에서 기록을 쌓고, 문서 고유 링크로 연결합니다.</li><li>02_Wiki의 검증된 내용만 회사 정본으로 제안합니다.</li><li>저장 버튼 또는 ⌘S로 서버에 반영합니다. 임시 보관은 이 기기에만 남습니다.</li></ol><p>/ 블록 · [[ 문서 연결 · @ 사람 언급 · ## 제목 · - 목록 · &gt; 인용</p><dl><dt>⌘/Ctrl+S</dt><dd>명시적 저장</dd><dt>⌘/Ctrl+⇧M</dt><dd>선택 항목 이동</dd><dt>⌘/Ctrl 클릭 · Shift 클릭</dt><dd>복수·범위 선택</dd><dt>↑↓ · ←→ · Enter</dt><dd>트리 탐색 · 접기/펼치기 · 열기</dd><dt>F2 · Delete</dt><dd>이름 변경 · 휴지통 확인</dd><dt>Esc</dt><dd>선택 해제·닫기</dd></dl></div></div></KnowledgeModal> : null}
      {toast ? <button className="toast" onClick={() => setToast("")}><CircleCheck size={16} /> {toast}</button> : null}
    </>
  );
}

export function KnowledgeWorkspace({ vault = false }: { vault?: boolean }) {
  return <Suspense><WorkspaceContent vault={vault} /></Suspense>;
}
