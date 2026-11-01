import { describe, expect, it } from "vitest";
import {
  guardConversationSelectionCandidate,
  hasExcludedConversationSelectionEndpoint,
} from "../src/lib/conversationSelectionGuard.js";

const VALID = {
  enabled: true,
  sameRow: true,
  insideTimeline: true,
  excluded: false,
  sameSelectableRegion: true,
  supportedContent: true,
  text: "selected text",
  hasLayout: true,
} as const;

describe("conversation selection guard", () => {
  it("Accept single-row body selection and identify single exceeding limit", () => {
    expect(guardConversationSelectionCandidate(VALID)).toBe("eligible");
    expect(guardConversationSelectionCandidate({ ...VALID, text: "x".repeat(8_001) })).toBe(
      "single-limit",
    );
  });

  it.each([
    { sameRow: false },
    { insideTimeline: false },
    { excluded: true },
    { sameSelectableRegion: false },
    { supportedContent: false },
    { enabled: false },
    { text: "" },
    { hasLayout: false },
  ])("Reject multiline, controls, non-body, closed gate, and empty selection %#", (patch) => {
    expect(guardConversationSelectionCandidate({ ...VALID, ...patch })).toBe("ineligible");
  });

  it("Reject controls only by selection endpoints to avoid accidentally rejecting body text when table toolbars fall within Range", () => {
    const contentEndpoint = { closest: () => null } as unknown as Element;
    const controlEndpoint = { closest: () => ({}) as Element } as unknown as Element;

    expect(hasExcludedConversationSelectionEndpoint(contentEndpoint, contentEndpoint)).toBe(false);
    expect(hasExcludedConversationSelectionEndpoint(controlEndpoint, contentEndpoint)).toBe(true);
    expect(hasExcludedConversationSelectionEndpoint(contentEndpoint, controlEndpoint)).toBe(true);
  });
});
