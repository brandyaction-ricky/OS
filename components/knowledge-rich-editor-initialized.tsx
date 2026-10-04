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
  useMdastNodeUpdater,
  type DirectiveDescriptor,
  type DirectiveEditorProps,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import type { ForwardedRef } from "react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ContainerDirective } from "mdast-util-directive";
import { getKnowledgeAttachmentUrl } from "@/lib/api-client";
import { parseKnowledgeAttachmentTarget } from "@/lib/knowledge-attachments";
import { knowledgeToggleMarkdown } from "@/lib/knowledge-toggle";
import { knowledgeImageDragPlugin } from "./knowledge-image-drag-plugin";

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
}: {
  editorRef: ForwardedRef<MDXEditorMethods> | null;
  markdown: string;
  accessToken: string | null;
  disabled?: boolean;
  onChange: (markdown: string) => void;
  onError: (message: string) => void;
  onRequestImage?: () => void;
  onCreateChildPage?: () => void;
}) {
  const localRef = useRef<MDXEditorMethods | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [picker, setPicker] = useState<{ query: string; index: number; top: number; left: number } | null>(null);
  const choices = BLOCKS.filter(block => block.label.toLocaleLowerCase("ko-KR").includes(picker?.query.toLocaleLowerCase("ko-KR") ?? ""));
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
    const block = BLOCKS.find(item => item.id === id);
    if (block?.markdown) localRef.current?.focus(() => localRef.current?.insertMarkdown(block.markdown));
  };
  const handlePickerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (picker) {
      if (event.key === "Escape") { event.preventDefault(); setPicker(null); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setPicker(value => value && ({ ...value, index: Math.max(0, Math.min(choices.length - 1, value.index + (event.key === "ArrowDown" ? 1 : -1))) })); return; }
      if (event.key === "Enter") { event.preventDefault(); const choice = choices[picker.index]; if (choice) insertBlock(choice.id); return; }
      if (event.key === "Backspace") { event.preventDefault(); setPicker(value => value && ({ ...value, query: value.query.slice(0, -1), index: 0 })); return; }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); setPicker(value => value && ({ ...value, query: value.query + event.key, index: 0 })); return; }
    }
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || disabled) return;
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const paragraph = node instanceof Element ? node.closest("p") : node?.parentElement?.closest("p");
    if (selection?.isCollapsed && paragraph?.closest(".knowledge-rich-content") && !paragraph.textContent?.trim()) {
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
    codeBlockPlugin({ defaultCodeBlockLanguage: "text" }),
    frontmatterPlugin(),
    imagePlugin({
      disableImageSettingsButton: true,
      imagePreviewHandler: async (source) => {
        const attachment = parseKnowledgeAttachmentTarget(source);
        if (!attachment) return source;
        return (await getKnowledgeAttachmentUrl(accessToken, attachment.path)).url;
      },
    }),
    directivesPlugin({ directiveDescriptors: [toggleDescriptor] }),
    knowledgeImageDragPlugin(),
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
  ], [accessToken]);

  return <div className="knowledge-block-editor" ref={wrapperRef} onKeyDownCapture={handlePickerKey}>
    {!disabled ? <button type="button" className="knowledge-block-add" aria-label="블록 추가" onMouseDown={event => event.preventDefault()} onClick={openPicker}>＋ 블록 추가</button> : null}
    <MDXEditor
    ref={instance => { localRef.current = instance; if (typeof editorRef === "function") editorRef(instance); else if (editorRef) editorRef.current = instance; }}
    markdown={markdown}
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
    {picker ? <div className="knowledge-block-picker" role="listbox" aria-label="블록 종류" style={{ top: picker.top, left: picker.left }}>
      <small>블록 찾기 {picker.query ? `· ${picker.query}` : "· / 입력 후 검색"} · ↑↓ 선택 · Enter 추가</small>
      {choices.length ? choices.map((block, index) => <button type="button" key={block.id} role="option" aria-selected={picker.index === index} onMouseDown={event => event.preventDefault()} onClick={() => insertBlock(block.id)}><strong>{block.label}</strong><span>{block.hint}</span></button>) : <p>일치하는 블록이 없습니다.</p>}
    </div> : null}
  </div>;
}
