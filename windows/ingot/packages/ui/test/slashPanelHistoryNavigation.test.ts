import { describe, expect, it } from "vitest";
import { shouldSlashPanelProcessUpdate } from "@/lib/slashPanelUpdateFilter.js";
import {
  HISTORY_NAVIGATION_UPDATE_TAG,
  PROGRAMMATIC_UPDATE_TAG,
} from "@/lib/editorUpdateTags.js";

describe("shouldSlashPanelProcessUpdate", () => {
  it("Handle updates on standard user input", () => {
    expect(shouldSlashPanelProcessUpdate(new Set())).toBe(true);
  });

  it("Still handle updates during programmatic updates (e.g. setText) to keep panel responsive", () => {
    expect(shouldSlashPanelProcessUpdate(new Set([PROGRAMMATIC_UPDATE_TAG]))).toBe(true);
  });

  it("Skip updates on history navigation autofill to prevent slash panel from swallowing arrow keys at CRITICAL priority", () => {
    expect(shouldSlashPanelProcessUpdate(new Set([HISTORY_NAVIGATION_UPDATE_TAG]))).toBe(false);
  });

  it("历史导航标记与其他标记共存时同样跳过", () => {
    expect(
      shouldSlashPanelProcessUpdate(new Set([HISTORY_NAVIGATION_UPDATE_TAG, PROGRAMMATIC_UPDATE_TAG])),
    ).toBe(false);
  });
});
