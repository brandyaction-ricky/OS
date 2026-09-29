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
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  maxLengthPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import type { ForwardedRef } from "react";
import { useMemo } from "react";
import { getKnowledgeAttachmentUrl } from "@/lib/api-client";
import { parseKnowledgeAttachmentTarget } from "@/lib/knowledge-attachments";
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

export default function KnowledgeRichEditorInitialized({
  editorRef,
  markdown,
  accessToken,
  disabled,
  onChange,
  onError,
}: {
  editorRef: ForwardedRef<MDXEditorMethods> | null;
  markdown: string;
  accessToken: string | null;
  disabled?: boolean;
  onChange: (markdown: string) => void;
  onError: (message: string) => void;
}) {
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

  return <MDXEditor
    ref={editorRef}
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
  />;
}
