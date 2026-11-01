import { describe, expect, it } from "vitest";
import type {
  ConversationSharePreflightResult,
  ConversationShareTurnPreflightResult,
} from "@origin-ai/cf-services";
import {
  aggregateConversationShareBlockingIssues,
  buildConversationSharePreflightCacheEntries,
  conversationSharePreflightCacheKey,
  conversationShareTurnFingerprint,
  dedupeConversationShareIssues,
  getMissingConversationSharePreflightTurnIds,
} from "@/v4/conversationSharePreflightCache.js";

function cached(productTurnId: string): ConversationShareTurnPreflightResult {
  return {
    productTurnId,
    blockingIssues: [],
    skippableWarnings: [],
    deferredIssues: [],
  };
}

describe("conversation share per-turn preflight cache", () => {
  it("turn fingerprint 随附件元数据变化而变化", () => {
    const rows = [
      {
        rowId: 1,
        turnId: "turn-1",
        productTurnId: "turn-1",
        createdAt: 1,
        createdAtSeq: 1,
        kind: "userInput" as const,
        text: "",
        origin: "realUser" as const,
        attachments: [
          {
            ref: "/tmp/a.txt",
            fileName: "a.txt",
            mime: "text/plain",
            bytes: 1,
          },
        ],
      },
    ];
    const first = conversationShareTurnFingerprint(rows, "turn-1");
    const second = conversationShareTurnFingerprint(
      [
        {
          ...rows[0]!,
          attachments: [{ ...rows[0]!.attachments[0]!, bytes: 2 }],
        },
      ],
      "turn-1",
    );
    expect(first).not.toBe(second);
    expect(conversationShareTurnFingerprint(rows, "turn-1")).toBe(first);
  });

  it("turn fingerprint is bound to share scope, session watermark, and capability version", () => {
    const rows = [
      {
        rowId: 1,
        turnId: "turn-1",
        productTurnId: "turn-1",
        createdAt: 1,
        createdAtSeq: 1,
        kind: "assistantText" as const,
        text: "生成 report.pdf",
        state: "complete" as const,
      },
    ];
    const context = {
      workspaceKey: "/workspace",
      remoteSessionId: "remote-1",
      sessionId: "session-1",
      revision: 7,
      logEpoch: "epoch-1",
      capabilitiesFingerprint: "cap-1",
    };
    const first = conversationShareTurnFingerprint(rows, "turn-1", "/workspace", context);
    expect(
      conversationShareTurnFingerprint(rows, "turn-1", "/workspace", {
        ...context,
        capabilitiesFingerprint: "cap-2",
      }),
    ).not.toBe(first);
    expect(
      conversationShareTurnFingerprint(rows, "turn-1", "/workspace", {
        ...context,
        revision: 8,
      }),
    ).not.toBe(first);
    expect(
      conversationShareTurnFingerprint(rows, "turn-1", "/workspace", {
        ...context,
        remoteSessionId: "remote-2",
      }),
    ).not.toBe(first);
  });

  it("Only return turns added for the first time and not yet checked; reselecting after cancellation will not recheck", () => {
    const scopeKey = "workspace-a\u0000remote-a\u0000session-a";
    const cache = new Map<string, ConversationShareTurnPreflightResult>([
      [
        conversationSharePreflightCacheKey(scopeKey, "turn-1"),
        { ...cached("turn-1"), turnFingerprint: "fp-1" },
      ],
      [
        conversationSharePreflightCacheKey(scopeKey, "turn-2"),
        { ...cached("turn-2"), turnFingerprint: "fp-2" },
      ],
    ]);
    const fingerprints = new Map([
      ["turn-1", "fp-1"],
      ["turn-2", "fp-2"],
    ]);

    expect(
      getMissingConversationSharePreflightTurnIds(scopeKey, ["turn-1"], cache, fingerprints),
    ).toEqual([]);
    expect(
      getMissingConversationSharePreflightTurnIds(
        scopeKey,
        ["turn-1", "turn-2"],
        cache,
        fingerprints,
      ),
    ).toEqual([]);
    expect(
      getMissingConversationSharePreflightTurnIds(
        scopeKey,
        ["turn-1", "turn-2", "turn-3"],
        cache,
        fingerprints,
      ),
    ).toEqual(["turn-3"]);
    expect(
      getMissingConversationSharePreflightTurnIds(
        scopeKey,
        ["turn-1"],
        cache,
        new Map([["turn-1", "fp-changed"]]),
      ),
    ).toEqual(["turn-1"]);
  });

  it("不同 workspace/session scope 不复用同名 product turn", () => {
    const cache = new Map<string, ConversationShareTurnPreflightResult>([
      [conversationSharePreflightCacheKey("scope-a", "turn-1"), cached("turn-1")],
    ]);

    expect(getMissingConversationSharePreflightTurnIds("scope-b", ["turn-1"], cache)).toEqual([
      "turn-1",
    ]);
  });

  it("Deduplicate only duplicate global issues without turn/file location info during aggregation", () => {
    const globalIssue = {
      code: "unknown" as const,
      scope: "transport" as const,
    };
    expect(dedupeConversationShareIssues([globalIssue, { ...globalIssue }])).toEqual([globalIssue]);

    expect(
      dedupeConversationShareIssues([
        {
          code: "running_turn" as const,
          scope: "turn" as const,
          turnOrdinal: 1,
        },
        {
          code: "running_turn" as const,
          scope: "turn" as const,
          turnOrdinal: 2,
        },
      ]),
    ).toHaveLength(2);
    expect(
      dedupeConversationShareIssues([
        { code: "running_turn" as const, scope: "turn" as const },
        { code: "running_turn" as const, scope: "turn" as const },
      ]),
    ).toHaveLength(2);
  });

  it("Fall back to overall issues instead of throwing an exception when host does not return turnResults", () => {
    const blockingIssues = [{ code: "running_turn" as const, scope: "turn" as const }];
    const legacyResult = {
      revision: 3,
      logEpoch: "epoch-1",
      capabilitiesFingerprint: "fingerprint",
      blockingIssues,
      skippableWarnings: [],
      deferredIssues: [],
      supportedArtifactTypes: [],
    } as unknown as ConversationSharePreflightResult;

    expect(
      buildConversationSharePreflightCacheEntries(
        legacyResult,
        ["turn-1", "turn-2"],
        new Map([["turn-1", "fp-1"]]),
      ),
    ).toEqual([
      {
        productTurnId: "turn-1",
        turnFingerprint: "fp-1",
        blockingIssues,
        skippableWarnings: [],
        deferredIssues: [],
      },
      {
        productTurnId: "turn-2",
        turnFingerprint: undefined,
        blockingIssues,
        skippableWarnings: [],
        deferredIssues: [],
      },
    ]);
  });

  it("Split by turn when turnResults are present and append the current fingerprint", () => {
    const result: ConversationSharePreflightResult = {
      revision: 3,
      logEpoch: "epoch-1",
      capabilitiesFingerprint: "fingerprint",
      blockingIssues: [{ code: "running_turn", scope: "turn", turnOrdinal: 2 }],
      skippableWarnings: [],
      deferredIssues: [],
      supportedArtifactTypes: [],
      turnResults: [
        {
          productTurnId: "turn-2",
          blockingIssues: [{ code: "running_turn", scope: "turn", turnOrdinal: 2 }],
          skippableWarnings: [],
          deferredIssues: [],
        },
      ],
    };

    const entries = buildConversationSharePreflightCacheEntries(
      result,
      ["turn-1", "turn-2"],
      new Map([
        ["turn-1", "fp-1"],
        ["turn-2", "fp-2"],
      ]),
    );

    expect(entries[0]).toEqual({
      productTurnId: "turn-1",
      turnFingerprint: "fp-1",
      blockingIssues: result.blockingIssues,
      skippableWarnings: [],
      deferredIssues: [],
    });
    expect(entries[1]).toEqual({
      productTurnId: "turn-2",
      turnFingerprint: "fp-2",
      blockingIssues: [{ code: "running_turn", scope: "turn", turnOrdinal: 2 }],
      skippableWarnings: [],
      deferredIssues: [],
    });
  });
});

it("Recalculate cumulative line limit upon selection; no old errors remain after deselecting turns", () => {
  const first = {
    ...cached("a"),
    rowBudget: { count: 3, limit: 5 },
    blockingIssues: [
      { code: "rows_limit" as const, scope: "conversation" as const, actual: 6, limit: 5 },
    ],
  };
  const second = { ...cached("b"), rowBudget: { count: 3, limit: 5 } };
  expect(aggregateConversationShareBlockingIssues([first, second])).toEqual([
    { code: "rows_limit", scope: "conversation", actual: 6, limit: 5 },
  ]);
  expect(aggregateConversationShareBlockingIssues([first])).toEqual([]);
});

it("内嵌图片变化会使轮次缓存失效", () => {
  const row = {
    kind: "toolCall" as const,
    rowId: 1,
    turnId: "t",
    productTurnId: "p",
    createdAt: 1,
    createdAtSeq: 1,
    toolCallId: "tool",
    toolName: "NodeRepl",
    status: "success" as const,
    display: {
      kind: "node_repl_images" as const,
      images: [{ base64: "aGVsbG8=", mimeType: "image/png" }],
    },
  };
  const before = conversationShareTurnFingerprint([row], "p");
  expect(
    conversationShareTurnFingerprint(
      [
        {
          ...row,
          display: { ...row.display, images: [{ base64: "d29ybGQ=", mimeType: "image/png" }] },
        },
      ],
      "p",
    ),
  ).not.toBe(before);
});

it.each([499, 500, 501])("累计 %i 行在500上限的精确边界", (count) => {
  const entries = [
    { ...cached("a"), rowBudget: { count: 250, limit: 500 } },
    { ...cached("b"), rowBudget: { count: count - 250, limit: 500 } },
  ];
  expect(aggregateConversationShareBlockingIssues(entries)).toEqual(
    count > 500 ? [{ code: "rows_limit", scope: "conversation", actual: count, limit: 500 }] : [],
  );
});
it("Apply the minimum constraint when service changes limits, retaining non-capacity blocking items", () => {
  const issue = { code: "running_turn" as const, scope: "turn" as const, turnOrdinal: 1 };
  const entries = [
    { ...cached("a"), rowBudget: { count: 200, limit: 500 }, blockingIssues: [issue] },
    { ...cached("b"), rowBudget: { count: 51, limit: 250 } },
  ];
  expect(aggregateConversationShareBlockingIssues(entries)).toEqual([
    issue,
    { code: "rows_limit", scope: "conversation", actual: 251, limit: 250 },
  ]);
});
