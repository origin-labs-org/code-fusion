import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  PERMISSION_INTERACTION_PREFIX,
  readPermissionInteractionIdsInBrowser,
} from "./e2e/helpers/permission-interaction-id.js";

function readIds(entries: Array<{ id: string; visible: boolean }>): string[] {
  const nodes = entries.map(({ id, visible }) => ({
    dataset: { testid: id },
    getClientRects: () => (visible ? [1] : []),
    getAttribute: (name: string) => (name === "data-testid" ? id : null),
  }));
  return runInNewContext(`(${readPermissionInteractionIdsInBrowser.toString()})(prefix)`, {
    prefix: PERMISSION_INTERACTION_PREFIX,
    __name: (value: unknown) => value,
    document: {
      querySelector: () => nodes.find((node) => node.dataset.testid.startsWith("v4-permission")),
      querySelectorAll: () => nodes,
    },
  });
}

describe("Real request identity for permission recovery", () => {
  it("Different interactions in the same dialog must not be misidentified as the same request", () => {
    const generic = { id: "v4-permission-dialog", visible: true };
    expect(
      readIds([generic, { id: `${PERMISSION_INTERACTION_PREFIX}request-a`, visible: true }]),
    ).toEqual(["request-a"]);
    expect(
      readIds([generic, { id: `${PERMISSION_INTERACTION_PREFIX}request-b`, visible: true }]),
    ).toEqual(["request-b"]);
  });
  it("Generic IDs, hidden stale requests, and regular tool summaries cannot supplement request identity", () => {
    expect(
      readIds([
        { id: "v4-permission-dialog", visible: true },
        { id: `${PERMISSION_INTERACTION_PREFIX}old`, visible: false },
        { id: "tool-summary-trigger-normal-tool", visible: true },
      ]),
    ).toEqual([]);
  });
  it("Deduplicate identical summaries, retain multiple distinct visible requests to eliminate ambiguity", () => {
    expect(
      readIds([
        { id: `${PERMISSION_INTERACTION_PREFIX}a`, visible: true },
        { id: `${PERMISSION_INTERACTION_PREFIX}a`, visible: true },
        { id: `${PERMISSION_INTERACTION_PREFIX}b`, visible: true },
      ]),
    ).toEqual(["a", "b"]);
  });
});
