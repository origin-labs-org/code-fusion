import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConversationShareImportNotice } from "@/v4/ConversationShareImportNotice.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

vi.mock("@/OpenSplitButton.js", async () => {
  const React = await import("react");
  return {
    OpenSplitButton: (props: Record<string, unknown>) => {
      const target = props.target as { path?: string } | undefined;
      return React.createElement("button", {
        type: "button",
        "data-open-split-button": "true",
        "data-target-path": target?.path ?? "",
      });
    },
  };
});

const rows = [
  {
    rowId: 1,
    turnId: "turn-1",
    productTurnId: "product-turn-1",
    createdAt: 1,
    createdAtSeq: 1,
    kind: "turnHeader" as const,
    origin: "userInput" as const,
    state: "completedSuccess" as const,
    startedAt: 1,
  },
  {
    rowId: 2,
    turnId: "turn-1",
    productTurnId: "product-turn-1",
    createdAt: 2,
    createdAtSeq: 2,
    kind: "userInput" as const,
    origin: "realUser" as const,
    text: "帮我看下这个报错",
  },
  {
    rowId: 3,
    turnId: "turn-1",
    productTurnId: "product-turn-1",
    createdAt: 3,
    createdAtSeq: 3,
    kind: "assistantText" as const,
    text: "根因是 signer 被提前释放",
    state: "complete" as const,
  },
];

function render(props: Parameters<typeof ConversationShareImportNotice>[0]) {
  return renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: props.locale },
      createElement(ConversationShareImportNotice, props),
    ),
  );
}

describe("conversation share import notice", () => {
  it("Render read-only shared conversation and divider", () => {
    const html = render({ rows, locale: "zh-CN", onOpenShareUrl: () => {} });
    expect(html).toContain('data-conversation-share-import-notice="true"');
    expect(html).toContain('data-conversation-share-import-divider="true"');
    expect(html).toContain("帮我看下这个报错");
    expect(html).toContain("根因是 signer 被提前释放");
    expect(html).toContain("已从分享导入");
  });

  it("Divider is a button when clickable, falls back to static line when not clickable", () => {
    expect(render({ rows, locale: "zh-CN", onOpenShareUrl: () => {} })).toContain(
      '<button type="button" data-conversation-share-import-divider="true"',
    );
    const staticHtml = render({ rows, locale: "zh-CN" });
    expect(staticHtml).toContain('data-conversation-share-import-divider="true"');
    expect(staticHtml).not.toContain(
      '<button type="button" data-conversation-share-import-divider="true"',
    );
  });

  it("分割线文案跟随界面语言", () => {
    expect(render({ rows, locale: "en-US" })).toContain("Imported from share");
  });

  it("No artifactUrls provided: artifacts do not show unclickable preview buttons", () => {
    const html = render({
      rows: [
        ...rows,
        {
          rowId: 4,
          turnId: "turn-1",
          productTurnId: "product-turn-1",
          createdAt: 4,
          createdAtSeq: 4,
          kind: "artifact" as const,
          artifactVersionId: "artifact-1",
          logicalArtifactKey: "report",
          displayName: "报告.pdf",
          artifactType: "pdf" as const,
          mimeType: "application/pdf",
          sizeBytes: 1024,
          sha256: "a".repeat(64),
          ref: "cf-artifact://share/artifact-1",
          state: "current" as const,
        },
      ],
      locale: "zh-CN",
    });
    expect(html).toContain("报告.pdf");
    expect(html).not.toContain("预览文件");
  });

  it("When a local import path is provided, artifacts use the open control of a normal preview card", () => {
    const html = render({
      rows: [
        ...rows,
        {
          rowId: 4,
          turnId: "turn-1",
          productTurnId: "product-turn-1",
          createdAt: 4,
          createdAtSeq: 4,
          kind: "artifact" as const,
          artifactVersionId: "artifact-1",
          logicalArtifactKey: "report",
          displayName: "报告.pdf",
          artifactType: "pdf" as const,
          mimeType: "application/pdf",
          sizeBytes: 1024,
          sha256: "a".repeat(64),
          ref: "cf-artifact://share/artifact-1",
          state: "current" as const,
        },
      ],
      locale: "zh-CN",
      workspacePath: "/workspace",
      artifactWorkspaceRelativePaths: new Map([
        ["artifact-1", ".cf-share/share-1/shared-artifacts/报告.pdf"],
      ]),
      onOpenCodeViewer: () => undefined,
    });

    expect(html).toContain('data-open-split-button="true"');
    expect(html).toContain(
      'data-target-path="/workspace/.cf-share/share-1/shared-artifacts/报告.pdf"',
    );
  });
});
