import { describe, expect, it } from "vitest";
import type { EditorInfo } from "@origin-ai/cf-shared";
import { isFileManagerOpenTarget, sortInstalledEditorsForOpenWith } from "@/lib/openWithEditors.js";

function makeEditor(id: string): EditorInfo {
  return {
    id,
    name: id,
    iconDataUrl: `data:image/png;base64,${id}`,
  };
}

describe("open-with editor ordering", () => {
  it("Generic mode only retains platform file managers", () => {
    const editors = [
      "vscode",
      "finder",
      "terminal",
      "qspace",
      "qspace-pro",
      "explorer",
      "cursor",
    ].map(makeEditor);
    expect(editors.filter(isFileManagerOpenTarget).map((editor) => editor.id)).toEqual([
      "finder",
      "qspace",
      "qspace-pro",
      "explorer",
    ]);
    expect(editors).toHaveLength(7);
  });
  it("pins file managers before regular editors in a stable shared order", () => {
    const sortedEditors = sortInstalledEditorsForOpenWith([
      makeEditor("cursor"),
      makeEditor("qspace-pro"),
      makeEditor("vscode"),
      makeEditor("explorer"),
      makeEditor("qspace"),
      makeEditor("finder"),
    ]);

    expect(sortedEditors.map((editor) => editor.id)).toEqual([
      "finder",
      "qspace",
      "qspace-pro",
      "explorer",
      "cursor",
      "vscode",
    ]);
  });
});
