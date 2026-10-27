"use client";

import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  InsertTable,
  ListsToggle,
  MDXEditor,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  directivesPlugin,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  NestedLexicalEditor,
  markdownShortcutPlugin,
  maxLengthPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  useCodeBlockEditorContext,
  useMdastNodeUpdater,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
  type DirectiveDescriptor,
  type DirectiveEditorProps,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import type { ForwardedRef } from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { ContainerDirective, LeafDirective, TextDirective } from "mdast-util-directive";
import { getKnowledgeAttachmentUrl } from "@/lib/api-client";
import { attachmentForLinkText, parseKnowledgeAttachmentTarget } from "@/lib/knowledge-attachments";
import { knowledgeToggleMarkdown } from "@/lib/knowledge-toggle";
import { escapeLooseAngles } from "@/lib/knowledge-markdown";
import { matchesVaultName } from "@/lib/knowledge-vault-interactions";
import { knowledgeImageDragPlugin } from "./knowledge-image-drag-plugin";
import {KnowledgeInlineOptions, knowledgeInlinePickerPlugin, type InlineOptions} from "./knowledge/inline-picker-plugin";

const KOREAN_LABELS: Record<string, string> = {
  "Select block type": "문단 형식",
  "Block type": "문단 형식",
  "Select list type": "목록 형식",
  "Toggle bold": "굵게",
  Bold: "굵게",
  "Toggle italic": "기울임",
  Italic: "기울임",
  "Toggle underline": "밑줄",
  Underline: "밑줄",
  "Create link": "링크",
  "Insert table": "표",
  "Insert Table": "표",
  Undo: "실행 취소",
  "Undo {{shortcut}}": "실행 취소 {{shortcut}}",
  Redo: "다시 실행",
  "Redo {{shortcut}}": "다시 실행 {{shortcut}}",
  Paragraph: "본문",
  "Heading 1": "제목 1",
  "Heading 2": "제목 2",
  "Heading 3": "제목 3",
  "Heading {{level}}": "제목 {{level}}",
  "Block quote": "인용",
  Quote: "인용",
  Blockquote: "인용",
  "Code block": "코드 블록",
  "Thematic break": "구분선",
  "Bulleted list": "글머리 목록",
  "Numbered list": "번호 목록",
  "Check list": "할 일 목록",
};

function preserveKnowledgeWikiLinks(markdown: string) {
  return markdown.replace(/\\?\[\\?\[([^\]\n]+?)\\?\]\\?\]/g, "[[$1]]");
}

function ToggleDirectiveEditor({ mdastNode }: DirectiveEditorProps<ContainerDirective>) {
  const update = useMdastNodeUpdater<ContainerDirective>();
  const [open, setOpen] = useState(true);
  return <section className="knowledge-toggle-editor">
    <button type="button" aria-label={open ? "토글 접기" : "토글 펼치기"} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "⌄" : "›"}</button>
    <input aria-label="토글 제목" maxLength={200} value={mdastNode.attributes?.title ?? ""} onChange={event => update({ attributes: { ...mdastNode.attributes, title: event.target.value } })} />
    {open ? <NestedLexicalEditor<ContainerDirective> block getContent={node => node.children} getUpdatedMdastNode={(node, children) => ({ ...node, children: children as ContainerDirective["children"] })} /> : null}
  </section>;
}

const toggleDescriptor: DirectiveDescriptor<ContainerDirective> = {
  name: "toggle",
  type: "containerDirective",
  testNode: node => node.type === "containerDirective" && node.name === "toggle",
  attributes: ["title"],
  hasChildren: true,
  Editor: ToggleDirectiveEditor,
};

// Fenced code blocks (```python …) had no editor registered, so any document holding one
// failed to open in the block editor. Every language gets a plain monospace box that saves
// the code, language and meta back unchanged.
const CodeReadOnly = createContext(false);
function PlainCodeBlockEditor({ code, language }: CodeBlockEditorProps) {
  const { setCode } = useCodeBlockEditorContext(), readOnly = useContext(CodeReadOnly);
  return <div className="knowledge-code-block">
    {language ? <small>{language}</small> : null}
    <textarea aria-label="코드" spellCheck={false} readOnly={readOnly} defaultValue={code} rows={Math.min(24, Math.max(2, code.split("\n").length))} onChange={event => setCode(event.target.value)} />
  </div>;
}
const plainCodeDescriptor: CodeBlockEditorDescriptor = { priority: 0, match: () => true, Editor: PlainCodeBlockEditor };

// Directive syntax turns ordinary text such as "HH:MM" into a ":MM" text directive. Only
// the toggle is a real directive here; any other is shown as the text it came from and saved
// back unchanged.
function PlainDirectiveEditor({ mdastNode }: DirectiveEditorProps<TextDirective | LeafDirective>) {
  const label = mdastNode.children.map(child => "value" in child ? child.value : "").join("");
  return <span>{(mdastNode.type === "leafDirective" ? "::" : ":") + mdastNode.name + (label ? `[${label}]` : "")}</span>;
}

const plainDirectiveDescriptor: DirectiveDescriptor<TextDirective | LeafDirective> = {
  name: "plain",
  testNode: node => node.type !== "containerDirective",
  attributes: [],
  hasChildren: false,
  Editor: PlainDirectiveEditor,
};

const BLOCKS = [
  { id: "text", label: "텍스트", hint: "기본 문단", markdown: "\n" },
  { id: "h1", label: "제목 1", hint: "큰 제목", markdown: "# 제목\n" },
  { id: "h2", label: "제목 2", hint: "중간 제목", markdown: "## 제목\n" },
  { id: "h3", label: "제목 3", hint: "작은 제목", markdown: "### 제목\n" },
  { id: "bullet", label: "글머리 목록", hint: "점으로 구분", markdown: "- 항목\n" },
  { id: "number", label: "번호 목록", hint: "순서대로", markdown: "1. 항목\n" },
  { id: "todo", label: "할 일 목록", hint: "완료 표시", markdown: "- [ ] 할 일\n" },
  { id: "toggle", label: "토글 목록", hint: "접고 펼치는 내용", markdown: knowledgeToggleMarkdown() },
  { id: "image", label: "이미지", hint: "사진 첨부", markdown: "" },
  { id: "page", label: "하위 페이지", hint: "이 페이지 아래 생성", markdown: "" },
  { id: "quote", label: "인용", hint: "출처와 함께 인용", markdown: "> 인용\n" },
  { id: "code", label: "코드", hint: "코드 블록", markdown: "\n```text\n코드\n```\n" },
  { id: "rule", label: "구분선", hint: "섹션 구분", markdown: "\n---\n" },
  { id: "table", label: "표", hint: "행과 열로 정리", markdown: "| 항목 | 내용 |\n| --- | --- |\n|  |  |\n" },
  { id: "callout", label: "콜아웃", hint: "눈에 띄는 안내 · callout", markdown: "> 💡 안내\n" },
  { id: "decision", label: "결정", hint: "눈에 띄게 적는 결정 · decision", markdown: "> ✅ 결정: \n" },
  { id: "document", label: "문서 연결", hint: "다른 문서 가리키기 · link", markdown: "" },
] as const;

export default function KnowledgeRichEditorInitialized({
  editorRef,
  markdown,
  accessToken,
  disabled,
  onChange,
  onError,
  onRequestImage,
  onCreateChildPage,
  onDocumentLink,
  inlineOptions,
}: {
  editorRef: ForwardedRef<MDXEditorMethods> | null;
  markdown: string;
  accessToken: string | null;
  disabled?: boolean;
  onChange: (markdown: string) => void;
  onError: (message: string) => void;
  onRequestImage?: () => void;
  onCreateChildPage?: () => void;
  onDocumentLink?: () => void;
  inlineOptions?: InlineOptions;
}) {
  const localRef = useRef<MDXEditorMethods | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const hasInlineOptions=Boolean(inlineOptions);
  // Lexical blanks link URLs whose scheme it does not know, so a file link (knowledge-attachment:)
  // would open about:blank. Find the link's attachment in the markdown by its text and download it.
  const openAttachmentLink = (event: ReactMouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link || !wrapperRef.current?.contains(link)) return;
    const attachment = attachmentForLinkText(localRef.current?.getMarkdown() ?? markdown, link.textContent ?? "");
    if (!attachment) return;
    event.preventDefault(); event.stopPropagation();
    getKnowledgeAttachmentUrl(accessToken, attachment.path, attachment.name).then(result => window.location.assign(result.url)).catch(() => onError(`첨부 파일을 열지 못했습니다 · ${attachment.name}`));
  };
  const [picker, setPicker] = useState<{ query: string; index: number; top: number; left: number } | null>(null);
  useEffect(() => {
    if (!picker) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setPicker(null);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [picker]);
  const choices = BLOCKS.filter(block => (inlineOptions || !["quote","code","rule","table","callout","decision","document"].includes(block.id)) && matchesVaultName(inlineOptions ? `${block.label} ${block.hint} ${block.id}` : block.label, picker?.query ?? ""));
  const openPicker = () => {
    if (disabled) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    const caret = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0).getBoundingClientRect() : null;
    setPicker({ query: "", index: 0, top: rect && caret && caret.height ? Math.max(40, caret.bottom - rect.top + 8) : 48, left: rect && caret && caret.width ? Math.max(8, Math.min(caret.left - rect.left, rect.width - 260)) : 8 });
    if (!wrapperRef.current?.querySelector(".knowledge-rich-content")?.contains(document.activeElement)) localRef.current?.focus(undefined, { defaultSelection: "rootEnd" });
  };
  const insertBlock = (id: string) => {
    setPicker(null);
    if (id === "image") { onRequestImage?.(); return; }
    if (id === "page") { onCreateChildPage?.(); return; }
    if (id === "document") { onDocumentLink?.(); return; }
    const block = BLOCKS.find(item => item.id === id);
    if (block?.markdown) localRef.current?.focus(() => localRef.current?.insertMarkdown(block.markdown));
  };
  const handlePickerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (picker) {
      if (event.key === "Escape") { event.preventDefault(); setPicker(null); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setPicker(value => value && ({ ...value, index: Math.max(0, Math.min(choices.length - 1, value.index + (event.key === "ArrowDown" ? 1 : -1))) })); return; }
      if (event.key === "Enter" || inlineOptions && event.key === "Tab") { event.preventDefault(); const choice = choices[picker.index]; if (choice) insertBlock(choice.id); return; }
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "Backspace") { event.preventDefault(); setPicker(value => value && ({ ...value, query: value.query.slice(0, -1), index: 0 })); return; }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); setPicker(value => value && ({ ...value, query: value.query + event.key, index: 0 })); return; }
    }
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || disabled) return;
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const paragraph = node instanceof Element ? node.closest("p,h1,h2,h3,h4,h5,h6,li") : node?.parentElement?.closest("p,h1,h2,h3,h4,h5,h6,li");
    const prefix = node?.nodeType === Node.TEXT_NODE ? node.textContent?.slice(0,selection?.anchorOffset) : "";
    if (selection?.isCollapsed && paragraph?.closest(".knowledge-rich-content") && (!paragraph.textContent?.trim() || inlineOptions && /\s$/.test(prefix??""))) {
      event.preventDefault(); openPicker();
    }
  };
  const plugins = useMemo(() => [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: "text", codeBlockEditorDescriptors: [plainCodeDescriptor] }),
    frontmatterPlugin(),
    imagePlugin({
      disableImageSettingsButton: true,
      imagePreviewHandler: async (source) => {
        const attachment = parseKnowledgeAttachmentTarget(source);
        if (!attachment) return source;
        return (await getKnowledgeAttachmentUrl(accessToken, attachment.path)).url;
      },
    }),
    directivesPlugin({ directiveDescriptors: [toggleDescriptor, plainDirectiveDescriptor] }),
    knowledgeImageDragPlugin(),
    ...(hasInlineOptions ? [knowledgeInlinePickerPlugin()] : []),
    maxLengthPlugin(1_500_000),
    markdownShortcutPlugin(),
    toolbarPlugin({
      toolbarClassName: "knowledge-rich-toolbar",
      toolbarContents: () => <>
        <UndoRedo />
        <Separator />
        <BlockTypeSelect />
        <BoldItalicUnderlineToggles />
        <ListsToggle options={["bullet", "number", "check"]} />
        <Separator />
        <CreateLink />
        <InsertTable />
      </>,
    }),
  ], [accessToken, hasInlineOptions]); // Options themselves update through context without resetting the editor.

  return <CodeReadOnly.Provider value={!!disabled}><KnowledgeInlineOptions.Provider value={inlineOptions}><div className="knowledge-block-editor" ref={wrapperRef} onKeyDownCapture={handlePickerKey} onClickCapture={openAttachmentLink} onBlur={event=>{if(inlineOptions&&!event.currentTarget.contains(event.relatedTarget))setPicker(null);}}>
    {!disabled ? <button type="button" className="knowledge-block-add" aria-label="블록 추가" onMouseDown={event => event.preventDefault()} onClick={openPicker}>＋ 블록 추가</button> : null}
    <MDXEditor
    ref={editor => {
      // Every way Markdown enters the editor escapes prose "<" first (see escapeLooseAngles).
      const instance = editor && { ...editor, setMarkdown: (value: string) => editor.setMarkdown(escapeLooseAngles(value)), insertMarkdown: (value: string) => editor.insertMarkdown(escapeLooseAngles(value)) };
      localRef.current = instance; if (typeof editorRef === "function") editorRef(instance); else if (editorRef) editorRef.current = instance;
    }}
    markdown={escapeLooseAngles(markdown)}
    readOnly={disabled}
    className="knowledge-rich-editor"
    contentEditableClassName="knowledge-rich-content"
    placeholder="내용을 입력하세요. 줄 맨 앞에서 ##, -, >를 입력한 뒤 공백을 누르면 바로 서식이 적용됩니다."
    spellCheck
    trim={false}
    plugins={plugins}
    onChange={(value, initialNormalize) => {
      if (!initialNormalize) onChange(preserveKnowledgeWikiLinks(value));
    }}
    onError={({ error }) => onError(`이 문서의 일부 Markdown을 편집 화면으로 바꾸지 못했습니다. 원문은 보존됩니다. (${error})`)}
    translation={(_key, defaultValue, interpolations) => {
      const translated = KOREAN_LABELS[defaultValue] ?? defaultValue;
      return Object.entries(interpolations ?? {}).reduce(
        (label, [name, value]) => label.replaceAll(`{{${name}}}`, String(value)),
        translated,
      );
    }}
  />
    {picker ? <div ref={pickerRef} className="knowledge-block-picker" role="listbox" aria-label="블록 종류" style={{ top: picker.top, left: picker.left }}>
      <input autoFocus aria-label="블록 찾기" placeholder="블록 이름·초성으로 찾기" value={picker.query} onChange={event => setPicker(value => value && ({...value, query: event.target.value, index: 0}))} />
      <small>블록 찾기 {picker.query ? `· ${picker.query}` : "· / 입력 후 검색"} · ↑↓ 선택 · Enter 추가</small>
      {choices.length ? choices.map((block, index) => <button type="button" key={block.id} role="option" aria-selected={picker.index === index} onMouseDown={event => event.preventDefault()} onClick={() => insertBlock(block.id)}><strong>{block.label}</strong><span>{block.hint}</span></button>) : <p>일치하는 블록이 없습니다.</p>}
    </div> : null}
  </div></KnowledgeInlineOptions.Provider></CodeReadOnly.Provider>;
}
