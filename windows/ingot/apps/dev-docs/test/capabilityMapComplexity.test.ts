import { describe, expect, it, vi } from "vitest";
import { groupComplexityById } from "@/capability-map/capabilityMapTypes.js";

vi.mock("@/data/productCapabilityMap.js", () => ({
  capabilityGroups: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "empty" }],
  capabilityNodes: [
    { id: "a1", groupId: "a" },
    { id: "a2", groupId: "a" },
    { id: "b1", groupId: "b" },
    { id: "c1", groupId: "c" },
    { id: "orphan", groupId: "missing-group" },
  ],
  capabilityEdges: [
    { source: "a1", target: "b1" },
    { source: "b1", target: "a1" },
    { source: "b1", target: "c1" },
    { source: "a1", target: "a2" },
    { source: "missing-node", target: "b1" },
    { source: "a1", target: "missing-node" },
    { source: "orphan", target: "b1" },
  ],
  capabilitySystems: [],
  capabilityRelationNames: {},
}));

describe("Capability cluster complexity", () => {
  it("Count only cross-cluster directed edges toward in-degree and out-degree", () => {
    expect([...groupComplexityById]).toEqual([
      ["a", { inDegree: 1, outDegree: 1 }],
      ["b", { inDegree: 1, outDegree: 2 }],
      ["c", { inDegree: 1, outDegree: 0 }],
      ["empty", { inDegree: 0, outDegree: 0 }],
    ]);
  });
});
