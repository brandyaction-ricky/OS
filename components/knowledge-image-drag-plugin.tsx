"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getNodeByKey,
  $createNodeSelection,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  DROP_COMMAND,
} from "lexical";
import { $isImageNode, addComposerChild$, realmPlugin } from "@mdxeditor/editor";

const FILE_DROP_POSITION_EVENT = "knowledge-file-drop-position";

type FileDropPositionDetail = {
  clientY?: number;
  commit?: boolean;
  clear?: boolean;
};

export function dispatchKnowledgeFileDropPosition(editable: HTMLElement, detail: FileDropPositionDetail) {
  editable.dispatchEvent(new CustomEvent<FileDropPositionDetail>(FILE_DROP_POSITION_EVENT, { detail }));
}

function KnowledgeImageDragSupport() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    let draggedImageBlock: HTMLElement | null = null;
    let dropIndicator: HTMLDivElement | null = null;

    const removeDropIndicator = () => {
      dropIndicator?.remove();
      dropIndicator = null;
    };
    const editorBlocks = () => (Array.from(root.children) as HTMLElement[])
      .filter((block) => block !== draggedImageBlock);
    const dropPlacement = (clientY: number) => {
      const blocks = editorBlocks();
      const before = blocks.find((block) => {
        const rect = block.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2;
      }) ?? null;
      const beforeIndex = before ? blocks.indexOf(before) : blocks.length;
      const after = beforeIndex > 0 ? blocks[beforeIndex - 1] : null;
      const rootRect = root.getBoundingClientRect();
      const beforeRect = before?.getBoundingClientRect();
      const afterRect = after?.getBoundingClientRect();
      const lineY = beforeRect && afterRect
        ? (afterRect.bottom + beforeRect.top) / 2
        : beforeRect?.top ?? afterRect?.bottom ?? Math.max(rootRect.top + 18, clientY);
      return { before, after, lineY, rootRect };
    };
    const showDropIndicator = (clientY: number) => {
      const placement = dropPlacement(clientY);
      dropIndicator ??= document.createElement("div");
      dropIndicator.className = "knowledge-image-drop-indicator";
      dropIndicator.setAttribute("aria-hidden", "true");
      Object.assign(dropIndicator.style, {
        left: `${placement.rootRect.left}px`,
        top: `${placement.lineY}px`,
        width: `${placement.rootRect.width}px`,
      });
      if (!dropIndicator.isConnected) document.body.append(dropIndicator);
      return placement;
    };
    const topLevelNode = (element: HTMLElement | null) => {
      if (!element) return null;
      return $getNearestNodeFromDOMNode(element)?.getTopLevelElementOrThrow() ?? null;
    };

    const makeImagesDraggable = () => {
      root.querySelectorAll<HTMLImageElement>('[data-editor-block-type="image"] img').forEach((image) => {
        image.draggable = true;
        image.dataset.knowledgeDraggable = "true";
      });
    };
    const selectImageBeforeDrag = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || !target.closest('[data-editor-block-type="image"]')) return;
      editor.update(() => {
        const node = $getNearestNodeFromDOMNode(target);
        if (!$isImageNode(node)) return;
        const selection = $createNodeSelection();
        selection.add(node.getKey());
        $setSelection(selection);
      });
    };
    const beginImageDrag = (event: DragEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || !target.closest('[data-editor-block-type="image"]')) return;
      draggedImageBlock = target.closest<HTMLElement>(".knowledge-rich-content > *");
    };
    const previewImageDrop = (event: DragEvent) => {
      if (!draggedImageBlock && !Array.from(event.dataTransfer?.types ?? []).includes("application/x-lexical-drag")) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      showDropIndicator(event.clientY);
    };
    const finishImageDrag = () => {
      draggedImageBlock = null;
      removeDropIndicator();
    };
    const placeExternalFileDrop = (event: Event) => {
      const detail = (event as CustomEvent<FileDropPositionDetail>).detail;
      if (detail.clear) {
        removeDropIndicator();
        return;
      }
      if (!Number.isFinite(detail.clientY)) return;
      const placement = showDropIndicator(detail.clientY!);
      if (!detail.commit) return;
      editor.update(() => {
        const paragraph = $createParagraphNode();
        const beforeNode = topLevelNode(placement.before);
        const afterNode = topLevelNode(placement.after);
        if (beforeNode) beforeNode.insertBefore(paragraph);
        else if (afterNode) afterNode.insertAfter(paragraph);
        else $getRoot().append(paragraph);
        paragraph.selectStart();
      }, { discrete: true });
      removeDropIndicator();
    };
    const moveImageBlock = (event: DragEvent) => {
      const raw = event.dataTransfer?.getData("application/x-lexical-drag");
      let key = "";
      if (raw) {
        try {
          const payload = JSON.parse(raw) as { type?: string; data?: { key?: string } };
          if (payload.type === "image" && payload.data?.key) key = payload.data.key;
        } catch { /* An internal image drag can still be recovered from the source node. */ }
      }
      if (!key && draggedImageBlock) editor.getEditorState().read(() => {
        const image = draggedImageBlock?.querySelector("img");
        const node = image ? $getNearestNodeFromDOMNode(image) : null;
        if ($isImageNode(node)) key = node.getKey();
      });
      if (!key) return false;

      const placement = dropPlacement(event.clientY);
      event.preventDefault();
      event.stopPropagation();
      editor.update(() => {
        const imageNode = $getNodeByKey(key);
        if (!$isImageNode(imageNode)) return;
        const imageBlock = imageNode.getTopLevelElementOrThrow();
        const beforeNode = topLevelNode(placement.before);
        const afterNode = topLevelNode(placement.after);
        if (beforeNode && beforeNode.getKey() !== imageBlock.getKey()) beforeNode.insertBefore(imageBlock);
        else if (afterNode && afterNode.getKey() !== imageBlock.getKey()) afterNode.insertAfter(imageBlock);
        const selection = $createNodeSelection();
        selection.add(imageNode.getKey());
        $setSelection(selection);
      });
      finishImageDrag();
      return true;
    };

    makeImagesDraggable();
    const observer = new MutationObserver(makeImagesDraggable);
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener("pointerdown", selectImageBeforeDrag, true);
    root.addEventListener("dragstart", beginImageDrag, true);
    root.addEventListener("dragover", previewImageDrop);
    root.addEventListener("drop", moveImageBlock, true);
    root.addEventListener("dragend", finishImageDrag, true);
    root.addEventListener(FILE_DROP_POSITION_EVENT, placeExternalFileDrop);
    const unregisterDrop = editor.registerCommand(DROP_COMMAND, moveImageBlock, COMMAND_PRIORITY_CRITICAL);
    return () => {
      observer.disconnect();
      unregisterDrop();
      removeDropIndicator();
      root.removeEventListener("pointerdown", selectImageBeforeDrag, true);
      root.removeEventListener("dragstart", beginImageDrag, true);
      root.removeEventListener("dragover", previewImageDrop);
      root.removeEventListener("drop", moveImageBlock, true);
      root.removeEventListener("dragend", finishImageDrag, true);
      root.removeEventListener(FILE_DROP_POSITION_EVENT, placeExternalFileDrop);
    };
  }, [editor]);

  return null;
}

export const knowledgeImageDragPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, KnowledgeImageDragSupport);
  },
});
