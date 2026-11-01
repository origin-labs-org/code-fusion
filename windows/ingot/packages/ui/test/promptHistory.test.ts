import { describe, expect, it } from "vitest";
import {
  appendPromptHistoryEntry,
  MAX_PROMPT_HISTORY,
  navigatePromptHistory,
} from "../src/lib/promptHistory.js";

describe("appendPromptHistoryEntry", () => {
  it("Ignores blank content", () => {
    expect(appendPromptHistoryEntry(["first"], "   ")).toEqual(["first"]);
  });

  it("Only filters consecutive duplicates that match the previous entry after trim", () => {
    expect(appendPromptHistoryEntry(["first"], "  first  ")).toEqual(["first"]);
    expect(appendPromptHistoryEntry(["first", "second"], " first ")).toEqual([
      "first",
      "second",
      "first",
    ]);
  });

  it("Preserves history with internal whitespace, line breaks, and case differences", () => {
    expect(appendPromptHistoryEntry(["A B"], " A  B ")).toEqual(["A B", "A  B"]);
    expect(appendPromptHistoryEntry(["line\nvalue"], "line value")).toEqual([
      "line\nvalue",
      "line value",
    ]);
    expect(appendPromptHistoryEntry(["Prompt"], "prompt")).toEqual(["Prompt", "prompt"]);
  });

  it("Appends to end and trims to the latest 30 entries", () => {
    const history = Array.from(
      { length: MAX_PROMPT_HISTORY },
      (_, index) => `message-${index + 1}`,
    );
    const next = appendPromptHistoryEntry(history, "message-31");

    expect(next).toHaveLength(MAX_PROMPT_HISTORY);
    expect(next[0]).toBe("message-2");
    expect(next.at(-1)).toBe("message-31");
  });
});

describe("navigatePromptHistory", () => {
  const history = ["first", "second", "third"];

  it("向上导航时会先命中最新一条", () => {
    expect(navigatePromptHistory(history, null, "up")).toEqual({
      nextIndex: 2,
      nextValue: "third",
      shouldHandle: true,
    });
  });

  it("Navigating up to the top stops at the oldest entry", () => {
    expect(navigatePromptHistory(history, 0, "up")).toEqual({
      nextIndex: 0,
      nextValue: "first",
      shouldHandle: true,
    });
  });

  it("Navigating down steps back to newer entries, then returns to empty input", () => {
    expect(navigatePromptHistory(history, 0, "down")).toEqual({
      nextIndex: 1,
      nextValue: "second",
      shouldHandle: true,
    });
    expect(navigatePromptHistory(history, 2, "down")).toEqual({
      nextIndex: null,
      nextValue: "",
      shouldHandle: true,
    });
  });

  it("Navigating down on empty input can also bring up the latest entry first", () => {
    expect(navigatePromptHistory(history, null, "down")).toEqual({
      nextIndex: 2,
      nextValue: "third",
      shouldHandle: true,
    });
  });
});
