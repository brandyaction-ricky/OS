"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $createNodeSelection,
  $getNearestNodeFromDOMNode,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  DROP_COMMAND,
} from "lexical";
import { $isImageNode, addComposerChild$, realmPlugin } from "@mdxeditor/editor";

function KnowledgeImageDragSupport() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

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
    const moveImageBlock = (event: DragEvent) => {
      const raw = event.dataTransfer?.getData("application/x-lexical-drag");
      if (!raw) return false;
      let key = "";
      try {
        const payload = JSON.parse(raw) as { type?: string; data?: { key?: string } };
        if (payload.type !== "image" || !payload.data?.key) return false;
        key = payload.data.key;
      } catch {
        return false;
      }

      const blocks = Array.from(root.children) as HTMLElement[];
      if (!blocks.length) return false;
      const eventTarget = event.target instanceof Element ? event.target : null;
      let targetBlock = eventTarget?.closest<HTMLElement>(".knowledge-rich-content > *") ?? null;
      if (!targetBlock || targetBlock.parentElement !== root) {
        targetBlock = blocks.reduce((nearest, block) => {
          const nearestDistance = Math.abs(event.clientY - (nearest.getBoundingClientRect().top + nearest.getBoundingClientRect().height / 2));
          const blockRect = block.getBoundingClientRect();
          const blockDistance = Math.abs(event.clientY - (blockRect.top + blockRect.height / 2));
          return blockDistance < nearestDistance ? block : nearest;
        });
      }
      const targetRect = targetBlock.getBoundingClientRect();
      const placeBefore = event.clientY < targetRect.top + targetRect.height / 2;
      event.preventDefault();
      event.stopPropagation();
      editor.update(() => {
        const imageNode = $getNodeByKey(key);
        const targetNode = $getNearestNodeFromDOMNode(targetBlock);
        if (!$isImageNode(imageNode) || !targetNode) return;
        const imageBlock = imageNode.getTopLevelElementOrThrow();
        const targetTopLevel = targetNode.getTopLevelElementOrThrow();
        if (imageBlock.getKey() === targetTopLevel.getKey()) return;
        if (placeBefore) targetTopLevel.insertBefore(imageBlock);
        else targetTopLevel.insertAfter(imageBlock);
        const selection = $createNodeSelection();
        selection.add(imageNode.getKey());
        $setSelection(selection);
      });
      return true;
    };

    makeImagesDraggable();
    const observer = new MutationObserver(makeImagesDraggable);
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener("pointerdown", selectImageBeforeDrag, true);
    const unregisterDrop = editor.registerCommand(DROP_COMMAND, moveImageBlock, COMMAND_PRIORITY_CRITICAL);
    return () => {
      observer.disconnect();
      unregisterDrop();
      root.removeEventListener("pointerdown", selectImageBeforeDrag, true);
    };
  }, [editor]);

  return null;
}

export const knowledgeImageDragPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, KnowledgeImageDragSupport);
  },
});
