// @vitest-environment jsdom

import { $getPromptMarkdown } from "@/mentions/promptSerialization.js";
import { describe, expect, it } from "vitest";
import {
  $getRoot,
  $createTextNode,
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  createEditor,
} from "lexical";
import {
  insertEditorMention,
  prependEditorMentionIfMissing,
  replaceEditorWithMention,
} from "@/LexicalChatInput.js";
import {
  $createPromptMentionNode,
  $isPromptMentionNode,
  PromptMentionNode,
} from "@/mentions/nodes/PromptMentionNode.js";

const TRY_NOW_MENTION = {
  id: "plugin:commit-commands@cf-official",
  category: "plugins" as const,
  label: "commit-commands",
  value: "commit-commands@cf-official",
  markdown: "[@commit-commands](plugin://commit-commands@cf-official)",
  data: { pluginId: "commit-commands@cf-official" },
};

const SECOND_PLUGIN_MENTION = {
  id: "plugin:pdf@cf-plugins-official",
  category: "plugins" as const,
  label: "pdf",
  value: "pdf@cf-plugins-official",
  markdown: "[@pdf](plugin://pdf@cf-plugins-official)",
  data: { pluginId: "pdf@cf-plugins-official" },
};

async function prefill(trailingText?: string) {
  const editor = createEditor({ nodes: [PromptMentionNode] });
  editor.setRootElement(document.createElement("div"));
  await new Promise<void>((resolve) => {
    editor.registerUpdateListener(() => resolve());
    replaceEditorWithMention(editor, TRY_NOW_MENTION, trailingText);
  });
  return editor;
}

describe("Input box remains editable after prefill from Plugin store trial", () => {
  it("Empty prompt trial also leaves a text node after mention token and places cursor outside token", async () => {
    const editor = await prefill("");

    editor.getEditorState().read(() => {
      const children = $getRoot().getFirstChild()?.getChildren?.() ?? [];
      expect(children.map((node) => node.getType())).toEqual(["prompt-mention", "text"]);

      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        throw new Error("No range selection after prefill");
      }
      const anchorNode = selection.anchor.getNode();
      expect($isPromptMentionNode(anchorNode)).toBe(false);
      expect($isTextNode(anchorNode)).toBe(true);
      expect(anchorNode.getKey()).toBe(children[1]?.getKey());
    });
  });

  it("带示例提示词试用保持原有草稿正文", async () => {
    const editor = await prefill(" Help me commit the current changes");

    expect(editor.getEditorState().read(() => $getPromptMarkdown())).toBe(
      `${TRY_NOW_MENTION.markdown} Help me commit the current changes`,
    );
  });
});

describe("前置 Plugin mention 保留现有 Lexical 节点", () => {
  it("Preserve old chip, file chip, and multi-paragraph body when selecting different Plugins consecutively", () => {
    const editor = createEditor({ nodes: [PromptMentionNode] });
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createPromptMentionNode(TRY_NOW_MENTION),
            $createTextNode(" 正文"),
          ),
          $createParagraphNode().append(
            $createPromptMentionNode({
              id: "file:src/demo.ts",
              category: "files",
              label: "demo.ts",
              value: "src/demo.ts",
              markdown: "[demo.ts](src/demo.ts)",
              data: { path: "src/demo.ts" },
            }),
            $createTextNode(" "),
            $createPromptMentionNode({
              id: "prefill-skill:review",
              category: "skills",
              label: "review",
              value: "review",
              markdown: "$review",
            }),
            $createTextNode(" 第二段"),
          ),
        );
      },
      { discrete: true },
    );

    expect(prependEditorMentionIfMissing(editor, SECOND_PLUGIN_MENTION)).toBe(true);
    expect(prependEditorMentionIfMissing(editor, TRY_NOW_MENTION)).toBe(false);

    editor.getEditorState().read(() => {
      const paragraphs = $getRoot().getChildren();
      expect(paragraphs).toHaveLength(2);
      const mentionNodes = $getRoot()
        .getAllTextNodes()
        .filter($isPromptMentionNode);
      expect(mentionNodes.map((node) => node.getMention().id)).toEqual([
        SECOND_PLUGIN_MENTION.id,
        TRY_NOW_MENTION.id,
        "file:src/demo.ts",
        "prefill-skill:review",
      ]);
      expect($getPromptMarkdown()).toBe(
        `${SECOND_PLUGIN_MENTION.markdown} ${TRY_NOW_MENTION.markdown} Body\n\n` +
          "[demo.ts](src/demo.ts) $review 第二段",
      );
    });
  });

  it("Preserve both Plugin mention nodes after serialization recovery", () => {
    const editor = createEditor({ nodes: [PromptMentionNode] });
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createPromptMentionNode(TRY_NOW_MENTION)));
      },
      { discrete: true },
    );
    prependEditorMentionIfMissing(editor, SECOND_PLUGIN_MENTION);

    const restored = createEditor({ nodes: [PromptMentionNode] });
    restored.setEditorState(restored.parseEditorState(JSON.stringify(editor.getEditorState())));
    restored.getEditorState().read(() => {
      const mentions = $getRoot().getAllTextNodes().filter($isPromptMentionNode);
      expect(mentions.map((node) => node.getMention().id)).toEqual([
        SECOND_PLUGIN_MENTION.id,
        TRY_NOW_MENTION.id,
      ]);
    });
  });
});

describe("菜单保存的 Lexical 选区", () => {
  it("Insert at the end of new draft after draft node is replaced, without restoring invalid key", async () => {
    const editor = createEditor({
      nodes: [PromptMentionNode],
      onError: (error) => {
        throw error;
      },
    });
    editor.update(
      () => {
        const text = $createTextNode("old draft");
        $getRoot().append($createParagraphNode().append(text));
        text.select(3, 3);
      },
      { discrete: true },
    );
    const saved = editor.getEditorState();
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode("replacement ")));
      },
      { discrete: true },
    );
    await new Promise<void>((resolve) => {
      const unregister = editor.registerUpdateListener(() => {
        unregister();
        resolve();
      });
      insertEditorMention(editor, TRY_NOW_MENTION, saved);
    });
    expect(editor.getEditorState().read(() => $getPromptMarkdown())).toBe(
      "replacement " + TRY_NOW_MENTION.markdown + " ",
    );
  });
});
