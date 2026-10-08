"use client";

import dynamic from "next/dynamic";
import { forwardRef } from "react";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import type {InlineOptions} from "./knowledge/inline-picker-plugin";

export type KnowledgeRichEditorMethods = MDXEditorMethods;

const ClientEditor = dynamic(() => import("./knowledge-rich-editor-initialized"), {
  ssr: false,
  loading: () => <div className="knowledge-rich-loading">편집기를 여는 중…</div>,
});

export interface KnowledgeRichEditorProps {
  markdown: string;
  accessToken: string | null;
  disabled?: boolean;
  onChange: (markdown: string) => void;
  onError: (message: string) => void;
  onRequestImage?: () => void;
  onCreateChildPage?: () => void;
  onDocumentLink?: () => void;
  inlineOptions?: InlineOptions;
}

export const KnowledgeRichEditor = forwardRef<MDXEditorMethods, KnowledgeRichEditorProps>((props, ref) => (
  <ClientEditor {...props} editorRef={ref} />
));

KnowledgeRichEditor.displayName = "KnowledgeRichEditor";
