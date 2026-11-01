import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { ConversationShareReadonlyTimeline } from "@/v4/ConversationShareReadonlyTimeline.js";

const openActionProps: { values: Array<Record<string, unknown>> } = { values: [] };

function StubArtifactOpenAction(props: Record<string, unknown>) {
  openActionProps.values.push(props);
  const target = props.target as
    | {
        path?: string;
        previewSource?: { workspacePath?: string };
      }
    | undefined;
  return createElement(
    "button",
    {
      type: "button",
      "data-open-split-button": "true",
      "data-target-path": target?.path ?? "",
      "data-preview-workspace": target?.previewSource?.workspacePath ?? "",
    },
    "Open",
  );
}

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
    text: "Please summarize today\'s news",
  },
  {
    rowId: 3,
    turnId: "turn-1",
    productTurnId: "product-turn-1",
    createdAt: 3,
    createdAtSeq: 3,
    kind: "assistantText" as const,
    text: "This is the **Summary**",
    state: "complete" as const,
  },
  {
    rowId: 4,
    turnId: "turn-1",
    productTurnId: "product-turn-1",
    createdAt: 4,
    createdAtSeq: 4,
    kind: "toolCall" as const,
    toolCallId: "tool-1",
    toolName: "WebSearch",
    status: "success" as const,
    inputText: "query",
    output: { text: "result" },
  },
];

const buildArtifactRow = (rowId: number, artifactVersionId: string) => ({
  rowId,
  turnId: "turn-1",
  productTurnId: "product-turn-1",
  createdAt: rowId,
  createdAtSeq: rowId,
  kind: "artifact" as const,
  artifactVersionId,
  logicalArtifactKey: "report",
  displayName: "晨报.pdf",
  artifactType: "pdf" as const,
  mimeType: "application/pdf",
  sizeBytes: 172_974,
  sha256: "a".repeat(64),
  ref: `cf-artifact://share/${artifactVersionId}`,
  state: "current" as const,
});

describe("ConversationShareReadonlyTimeline", () => {
  beforeEach(() => {
    openActionProps.values = [];
  });

  it("uses Desktop user bubble, assistant markdown, turn grouping, and tool summary", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows,
        locale: "zh-CN",
      }),
    );
    expect(html).toContain('data-v4-user-input-bubble="true"');
    expect(html).toContain("这是");
    expect(html).toContain('data-conversation-share-turn="turn-1"');
    expect(html).toContain("搜索");
    expect(html).toContain("tool-summary");
    expect(html).not.toContain("<details");
  });

  it("renders shared user input attachments as downloadable file pills", () => {
    const attachmentRows = [
      rows[0],
      {
        ...rows[1],
        attachments: [
          {
            ref: "cf-artifact://share/share-input-text-1",
            previewRef: "cf-artifact://share/share-input-text-1",
            fileName: "pasted-text.txt",
            mime: "text/plain",
            bytes: 245_760,
          },
        ],
      },
      rows[2],
    ];
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: attachmentRows,
        artifactUrls: new Map([
          ["share-input-text-1", "https://share.example.test/artifacts/text-1"],
        ]),
        locale: "en-US",
      }),
    );
    expect(html).toContain("pasted-text.txt");
    expect(html).toContain("https://share.example.test/artifacts/text-1");
    expect(html).toContain('data-v4-user-input-attachment-pill="true"');
  });

  it("keeps the user prompt before the history status and formats work duration like Desktop", () => {
    const historyRows = [
      {
        ...rows[0],
        activeMs: 165_000,
      },
      rows[1],
      {
        rowId: 7,
        turnId: "turn-1",
        productTurnId: "product-turn-1",
        createdAt: 7,
        createdAtSeq: 7,
        kind: "reasoning" as const,
        text: "First organize the data, then output the conclusion.",
        state: "complete" as const,
        durationMs: 2_000,
      },
      rows[2],
    ];
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: historyRows,
        locale: "zh-CN",
      }),
    );
    expect(html.indexOf('data-v4-user-input-bubble="true"')).toBeLessThan(
      html.indexOf('data-conversation-share-history-trigger="true"'),
    );
    expect(html).toContain("Worked for 2m 45s");
  });

  it("renders headings and tables through the Desktop MessageResponse pipeline", () => {
    const markdownRows = [
      rows[0],
      rows[1],
      {
        ...rows[2],
        text: [
          "普通段落",
          "",
          "---",
          "",
          "# 标题",
          "",
          "## 二级标题",
          "",
          "| 项目 | 内容 |",
          "| --- | --- |",
          "| 公司 | **CodeFusion** |",
          "",
          "```ts",
          "const answer = 42;",
          "```",
        ].join("\n"),
      },
    ];
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: markdownRows,
        locale: "zh-CN",
      }),
    );
    expect(html).toContain('data-streamdown="heading-1"');
    expect(html).toContain('data-streamdown="heading-2"');
    expect(html).toContain("<table");
    expect(html).toContain("data-markdown-table-toolbar");
    expect(html).not.toContain("# 标题");
    expect(html).not.toContain("| 项目 | 内容 |");
  });

  it("uses Desktop execute grouping for consecutive shell tool rows", () => {
    const executeRows = [
      rows[0],
      rows[1],
      rows[2],
      {
        rowId: 5,
        turnId: "turn-1",
        productTurnId: "product-turn-1",
        createdAt: 5,
        createdAtSeq: 5,
        kind: "toolCall" as const,
        toolCallId: "execute-1",
        toolName: "Bash",
        status: "success" as const,
        inputText: "echo one",
        input: { command: "echo one" },
        output: { text: "one" },
      },
      {
        rowId: 6,
        turnId: "turn-1",
        productTurnId: "product-turn-1",
        createdAt: 6,
        createdAtSeq: 6,
        kind: "toolCall" as const,
        toolCallId: "execute-2",
        toolName: "Bash",
        status: "success" as const,
        inputText: "echo two",
        input: { command: "echo two" },
        output: { text: "two" },
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: executeRows,
        locale: "zh-CN",
      }),
    );

    expect(html).toContain('data-conversation-share-work-group="executeGroup"');
    expect(html).toContain("2 个命令");
    expect(html).toContain("终端");
  });

  it("renders the public query summary for search rows", () => {
    const searchRows = [
      rows[0],
      rows[1],
      rows[2],
      {
        ...rows[3],
        input: { query: "AI coding" },
      },
    ];
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: searchRows,
        locale: "zh-CN",
      }),
    );

    expect(html).toContain("AI coding");
  });

  it("marker 不再把枚举名当文案印出来", () => {
    const markerRows = [
      rows[0],
      rows[1],
      {
        rowId: 90,
        turnId: "turn-1",
        productTurnId: "product-turn-1",
        createdAt: 90,
        createdAtSeq: 90,
        kind: "timelineMarker" as const,
        lane: "turnTailBoundary" as const,
        marker: { type: "compact" as const, origin: "auto" as const, status: "success" as const },
      },
      {
        rowId: 91,
        turnId: "turn-1",
        productTurnId: "product-turn-1",
        createdAt: 91,
        createdAtSeq: 91,
        kind: "timelineMarker" as const,
        lane: "turnTailBoundary" as const,
        marker: { type: "goalVerify" as const, iteration: 1, outcome: "pass" as const },
      },
    ];
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: markerRows as never,
        locale: "zh-CN",
      }),
    );

    expect(html).toContain("上下文已压缩");
    expect(html).not.toContain(">compact<");
    expect(html).not.toContain("goalVerify");
  });

  it("artifact displays public file metadata and download entry point", () => {
    const artifactRows = [
      rows[0],
      rows[1],
      {
        rowId: 80,
        turnId: "turn-1",
        productTurnId: "product-turn-1",
        createdAt: 80,
        createdAtSeq: 80,
        kind: "artifact" as const,
        artifactVersionId: "artifact-1",
        logicalArtifactKey: "report",
        displayName: "晨报.pdf",
        artifactType: "pdf" as const,
        mimeType: "application/pdf",
        sizeBytes: 172_974,
        sha256: "a".repeat(64),
        ref: "cf-artifact://share/artifact-1",
        state: "current" as const,
      },
    ];
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: artifactRows as never,
        locale: "zh-CN",
        artifactUrls: new Map([["artifact-1", "https://example.invalid/a.pdf"]]),
      }),
    );

    expect(html).toContain("文档 · PDF");
    expect(html).toContain("169 KB");
    expect(html).not.toContain("172974 bytes");
    expect(html).toContain('data-share-preview-button="true"');
  });

  it("Render OpenSplitButton for local artifacts imported as copies on Desktop", () => {
    const artifactRows = [
      rows[0],
      rows[1],
      {
        rowId: 80,
        turnId: "turn-1",
        productTurnId: "product-turn-1",
        createdAt: 80,
        createdAtSeq: 80,
        kind: "artifact" as const,
        artifactVersionId: "artifact-1",
        logicalArtifactKey: "report",
        displayName: "晨报.pdf",
        artifactType: "pdf" as const,
        mimeType: "application/pdf",
        sizeBytes: 172_974,
        sha256: "a".repeat(64),
        ref: "cf-artifact://share/artifact-1",
        state: "current" as const,
      },
    ];
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: artifactRows as never,
        locale: "zh-CN",
        workspacePath: "/workspace",
        artifactWorkspaceRelativePaths: new Map([
          ["artifact-1", ".cf-share/share-1/shared-artifacts/morning_report.pdf"],
        ]),
        onOpenCodeViewer: () => undefined,
        artifactOpenAction: StubArtifactOpenAction,
      }),
    );

    expect(html).toContain('data-open-split-button="true"');
    expect(html).toContain(
      'data-target-path="/workspace/.cf-share/share-1/shared-artifacts/morning_report.pdf"',
    );
    expect(openActionProps.values).toHaveLength(1);
    expect(openActionProps.values[0]?.target).toMatchObject({
      type: "file",
      path: "/workspace/.cf-share/share-1/shared-artifacts/morning_report.pdf",
      title: "晨报.pdf",
      label: "晨报.pdf",
      previewSource: {
        type: "file",
        title: "晨报.pdf",
        path: "/workspace/.cf-share/share-1/shared-artifacts/morning_report.pdf",
        workspacePath: "/workspace",
      },
    });
  });

  it("Do not render any open controls for local artifacts when artifactOpenAction is not injected", () => {
    const artifactRows = [rows[0], rows[1], buildArtifactRow(80, "artifact-1")];
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: artifactRows as never,
        locale: "zh-CN",
        workspacePath: "/workspace",
        artifactWorkspaceRelativePaths: new Map([
          ["artifact-1", ".cf-share/share-1/shared-artifacts/morning_report.pdf"],
        ]),
        onOpenCodeViewer: () => undefined,
      }),
    );

    expect(html).toContain("晨报.pdf");
    expect(html).not.toContain('data-open-split-button="true"');
    expect(html).not.toContain('data-share-preview-button="true"');
    expect(openActionProps.values).toHaveLength(0);
  });

  it("拒绝导入副本里越界的 artifact path", () => {
    const artifactRows = [
      rows[0],
      rows[1],
      {
        rowId: 80,
        turnId: "turn-1",
        productTurnId: "product-turn-1",
        createdAt: 80,
        createdAtSeq: 80,
        kind: "artifact" as const,
        artifactVersionId: "artifact-1",
        logicalArtifactKey: "report",
        displayName: "晨报.pdf",
        artifactType: "pdf" as const,
        mimeType: "application/pdf",
        sizeBytes: 172_974,
        sha256: "a".repeat(64),
        ref: "cf-artifact://share/artifact-1",
        state: "current" as const,
      },
    ];
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: artifactRows as never,
        locale: "zh-CN",
        workspacePath: "/workspace",
        artifactWorkspaceRelativePaths: new Map([["artifact-1", "../secret.pdf"]]),
        onOpenCodeViewer: () => undefined,
        artifactOpenAction: StubArtifactOpenAction,
      }),
    );

    expect(html).toContain("晨报.pdf");
    expect(html).not.toContain('data-open-split-button="true"');
    expect(openActionProps.values).toHaveLength(0);
  });

  it("拒绝导入副本里的绝对路径 artifact path", () => {
    const artifactRows = [
      rows[0],
      rows[1],
      buildArtifactRow(80, "artifact-1"),
      buildArtifactRow(81, "artifact-2"),
      buildArtifactRow(82, "artifact-3"),
    ];
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: artifactRows as never,
        locale: "zh-CN",
        workspacePath: "/workspace",
        artifactWorkspaceRelativePaths: new Map([
          ["artifact-1", "/etc/passwd"],
          ["artifact-2", "C:\\x\\a.pdf"],
          ["artifact-3", "\\\\srv\\share\\a.pdf"],
        ]),
        onOpenCodeViewer: () => undefined,
        artifactOpenAction: StubArtifactOpenAction,
      }),
    );

    expect(html).toContain("晨报.pdf");
    expect(html).not.toContain('data-open-split-button="true"');
    expect(openActionProps.values).toHaveLength(0);
  });

  it("Reject artifact paths in imported copies that do not have 4 segments or contain ./.. segments", () => {
    const artifactRows = [
      rows[0],
      rows[1],
      buildArtifactRow(80, "artifact-1"),
      buildArtifactRow(81, "artifact-2"),
      buildArtifactRow(82, "artifact-3"),
      buildArtifactRow(83, "artifact-4"),
      buildArtifactRow(84, "artifact-5"),
    ];
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: artifactRows as never,
        locale: "zh-CN",
        workspacePath: "/workspace",
        artifactWorkspaceRelativePaths: new Map([
          ["artifact-1", ".cf-share/share-1/shared-artifacts/sub/a.pdf"],
          ["artifact-2", ".cf-share/share-1/a.pdf"],
          ["artifact-3", ".cf-share/../shared-artifacts/a.pdf"],
          ["artifact-4", ".cf-share/share-1/shared-artifacts/."],
          ["artifact-5", ".cf-share\\share-1\\shared-artifacts\\a.pdf\\..\\b.pdf"],
        ]),
        onOpenCodeViewer: () => undefined,
        artifactOpenAction: StubArtifactOpenAction,
      }),
    );

    expect(html).toContain("晨报.pdf");
    expect(html).not.toContain('data-open-split-button="true"');
    expect(openActionProps.values).toHaveLength(0);
  });

  it.each([
    ["zh-CN", "下载文件"],
    ["en-US", "Download file"],
  ])("artifactUrls 与本地路径同时存在时 url 必须胜出（%s）", (locale, label) => {
    const artifactRows = [rows[0], rows[1], buildArtifactRow(80, "artifact-1")];
    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: artifactRows as never,
        locale,
        workspacePath: "/workspace",
        artifactUrls: new Map([["artifact-1", "https://example.invalid/a.pdf"]]),
        artifactWorkspaceRelativePaths: new Map([
          ["artifact-1", ".cf-share/share-1/shared-artifacts/morning_report.pdf"],
        ]),
        onOpenCodeViewer: () => undefined,
        artifactOpenAction: StubArtifactOpenAction,
      }),
    );

    expect(html).toContain(label);
    expect(html).not.toContain("预览文件");
    expect(html).not.toContain("Preview file");
    expect(html).toContain('data-share-preview-button="true"');
    expect(html).not.toContain('data-open-split-button="true"');
    expect(openActionProps.values).toHaveLength(0);
  });

  it("Do not render auto-loading img tags for remote images in body and tool outputs", () => {
    const remoteImageRows = [
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
        kind: "assistantText" as const,
        text: "View image ![tracker](https://tracker.invalid/pixel.png)",
        state: "complete" as const,
      },
      {
        rowId: 3,
        turnId: "turn-1",
        productTurnId: "product-turn-1",
        createdAt: 3,
        createdAtSeq: 3,
        kind: "toolCall" as const,
        toolCallId: "tool-1",
        toolName: "WebSearch",
        status: "success" as const,
        inputText: "query",
        output: { text: "结果 ![tracker](https://tracker.invalid/tool.png)" },
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ConversationShareReadonlyTimeline, {
        rows: remoteImageRows as never,
        locale: "zh-CN",
      }),
    );

    expect(html).not.toContain("<img");
    expect(html).not.toContain('src="https://tracker.invalid');
    expect(html).toContain('title="https://tracker.invalid/pixel.png"');
    expect(html).toContain("tracker");
  });
});

it("Share page displays static workflow graph without requiring desktop host or execution callbacks", () => {
  const html = renderToStaticMarkup(
    createElement(ConversationShareReadonlyTimeline, {
      locale: "zh-CN",
      rows: [
        ...rows,
        {
          rowId: 5,
          turnId: "turn-1",
          productTurnId: "product-turn-1",
          createdAt: 5,
          createdAtSeq: 5,
          kind: "toolCall",
          toolCallId: "workflow-test",
          toolName: "CreateWorkflow",
          status: "success",
          inputText: "{}",
          input: { name: "调研工作流" },
          display: {
            kind: "create_workflow",
            ok: true,
            errorCount: 0,
            diagnostics: [],
            causalityGraph: {
              steps: [{ id: "s", kind: "ask", label: "检索", lane: "l", phase: "p" }],
              lanes: [{ id: "l", name: "研究员" }],
              participants: [{ id: "a", phase: "p", lane: "l", steps: ["s"] }],
              handoffs: [],
              phases: [{ id: "p", name: "调研阶段" }],
              phaseEdges: [],
              exits: ["p"],
            },
          },
        },
      ],
    }),
  );
  expect(html).toContain("调研工作流");
  expect(html).toContain("调研阶段");
  expect(html).toContain("研究员");
  expect(html).toContain("Snapshot during tool call");
  expect(html).not.toContain('data-testid="workflow-card-resume"');
});
