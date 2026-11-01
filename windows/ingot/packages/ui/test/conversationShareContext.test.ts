import { describe, expect, it } from "vitest";

import {
  parseConversationShareContext,
  resolveAttachableShareContext,
} from "@/lib/conversationShareContext.js";

function withShareContextBlock(text: string, payload: Record<string, unknown>): string {
  const block = [
    "# cf-share-context:",
    "```cf-share-context",
    JSON.stringify(payload),
    "```",
  ].join("\n");
  return text ? `${text}\n\n${block}` : block;
}

describe("conversation share context reference", () => {
  it("Strip share URL trailing blocks in historical messages from visible body text", () => {
    const encoded = withShareContextBlock("继续分析", {
      contextId: "context-1",
      shareUrl: "https://cf.z.ai/cn/share/share-1",
    });
    expect(parseConversationShareContext(encoded)).toEqual({
      visibleContent: "继续分析",
      reference: {
        contextId: "context-1",
        shareUrl: "https://cf.z.ai/cn/share/share-1",
      },
    });
  });

  it("rejects signed/download URLs and unknown fields", () => {
    const parsed = parseConversationShareContext(
      [
        "继续分析",
        "",
        "# cf-share-context:",
        "```cf-share-context",
        JSON.stringify({
          contextId: "context-1",
          shareUrl: "https://signed.example/download?token=secret",
          markdown: "must-not-cross-ui",
        }),
        "```",
      ].join("\n"),
    );
    expect(parsed.reference).toBeNull();
    expect(parsed.visibleContent).toContain("# cf-share-context:");
  });
});

describe("resolveAttachableShareContext", () => {
  const pending = {
    contextId: "context-1",
    title: "来自分享：X",
    shareUrl: "https://cf.z.ai/cn/share/share-1",
    status: "pending",
  };

  it("pending must be attachable — otherwise the model will never get shared content", () => {
    expect(resolveAttachableShareContext(pending)).toEqual(pending);
  });

  it("reserved (queued but not yet consumed) remains attachable", () => {
    expect(resolveAttachableShareContext({ ...pending, status: "reserved" })?.status).toBe(
      "reserved",
    );
  });

  it("discarded is no longer attachable", () => {
    expect(resolveAttachableShareContext({ ...pending, status: "discarded" })).toBeNull();
  });

  it("legacy shape (only title, no contextId) does not attach: cannot construct refs", () => {
    expect(resolveAttachableShareContext({ title: "来自分享：X" })).toBeNull();
  });

  it("Return null when there is no handover context", () => {
    expect(resolveAttachableShareContext(null)).toBeNull();
    expect(resolveAttachableShareContext(undefined)).toBeNull();
  });
});
