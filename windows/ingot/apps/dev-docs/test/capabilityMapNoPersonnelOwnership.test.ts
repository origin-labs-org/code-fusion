import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { capabilityGroups } from "@/data/productCapabilityMap.js";

const devDocsRoot = process.cwd();
const ownershipDataPath = resolve(
  devDocsRoot,
  "src/data/productCapabilityOwnership.ts",
);
const capabilityMapInteractionFiles = [
  "src/capability-map/CapabilityMapView.tsx",
  "src/capability-map/CapabilityMapDetail.tsx",
  "src/capability-map/CapabilityMapFlowElements.tsx",
  "src/capability-map/capabilityMapTypes.ts",
].map((path) => resolve(devDocsRoot, path));

describe("Capability map does not carry specific personnel assignments", () => {
  it("Retain only role-based owners; do not write individual names into capability cluster data", () => {
    const roleOwnerPattern = /^\S.*负责人（[A-Za-z][A-Za-z &-]* Owner）$/;

    for (const group of capabilityGroups) {
      expect(group.owner).toMatch(roleOwnerPattern);
    }
  });

  it("Do not retain personnel responsibility data or personnel selection interactions", async () => {
    await expect(access(ownershipDataPath)).rejects.toThrow();
    const interactionSources = (
      await Promise.all(
        capabilityMapInteractionFiles.map((path) => readFile(path, "utf8")),
      )
    ).join("\n");

    expect(interactionSources).not.toMatch(
      /CapabilityOwnershipPanel|maintainer|responsibilityKind/,
    );
  });
});
