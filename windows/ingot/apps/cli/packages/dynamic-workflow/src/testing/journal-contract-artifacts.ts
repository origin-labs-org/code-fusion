

import { expect, it } from "vitest";
import type { ArtifactVersionRecord, JournalStorePort, NodeRecord } from "../engine/index.js";
import { baseRun } from "./journal-contract-helpers.js";

export function registerArtifactCases(factory: () => JournalStorePort): void {

  it("round-trips a completed artifact node with its version record", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    const record: ArtifactVersionRecord = {
      id: "book",
      kind: "file",
      version: 2,
      title: "注意力之书",
      description: "59 页 typst 排版",
      contentType: "application/pdf",
      bytes: 1_234_567,
      uri: "cf-artifact://ses_parent/abc123",
      sourcePath: "out/book.pdf",
      publishedAt: 1_725_000_000_000,
      primary: true,
    };
    const node: NodeRecord = {
      runId: "r1",
      siteId: "artifact#1",
      ordinal: 2,
      kind: "artifact",
      inputHash: "ah",
      status: "completed",
      result: record,
      artifactId: "book",
    };
    store.putNode(node);

    const stored = store.getNode("r1", "artifact#1", 2);
    expect(stored).toEqual(node);
    expect(stored?.result).toEqual(record);
  });

  it("round-trips a preset declaration artifact node with its spec", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    const record: ArtifactVersionRecord = {
      id: "perf",
      kind: "chart",
      version: 1,
      title: "查询延迟",
      spec: { type: "line", x: { field: "round" }, y: [{ field: "queryMsAfter" }] },
    };
    const node: NodeRecord = {
      runId: "r1",
      siteId: "artifact#2",
      ordinal: 1,
      kind: "artifact",
      inputHash: "ph",
      status: "completed",
      result: record,
      artifactId: "perf",
    };
    store.putNode(node);
    expect(store.getNode("r1", "artifact#2", 1)).toEqual(node);
  });

  it("round-trips a failed artifact node with its error and artifact id", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    const failed: NodeRecord = {
      runId: "r1",
      siteId: "artifact#1",
      ordinal: 3,
      kind: "artifact",
      inputHash: "ah3",
      status: "failed",
      error: { code: "ArtifactSourceMissing", message: "out/book.pdf 不存在" },
      artifactId: "book",
    };
    store.putNode(failed);

    const stored = store.getNode("r1", "artifact#1", 3);
    expect(stored).toEqual(failed);
    expect(stored !== undefined && "result" in stored).toBe(false);
  });

  it("keeps the artifact id across the running → settled rewrite", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    const running: NodeRecord = {
      runId: "r1",
      siteId: "artifact#1",
      ordinal: 1,
      kind: "artifact",
      inputHash: "ah",
      status: "running",
      artifactId: "book",
    };
    store.putNode(running);
    expect(store.getNode("r1", "artifact#1", 1)).toEqual(running);

    store.putNode({
      ...running,
      status: "completed",
      result: { id: "book", kind: "file", version: 1 } satisfies ArtifactVersionRecord,
    });
    const settled = store.getNode("r1", "artifact#1", 1)!;
    expect(settled.status).toBe("completed");
    expect(settled.artifactId).toBe("book");
  });

  it("round-trips the artifact tag on a report node", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    const tagged: NodeRecord = {
      runId: "r1",
      siteId: "report#1",
      ordinal: 3,
      kind: "report",
      inputHash: "rh",
      status: "completed",
      result: { round: 3, queryMsAfter: 12.5 },
      artifactId: "perf",
    };
    store.putNode(tagged);
    expect(store.getNode("r1", "report#1", 3)).toEqual(tagged);
  });

  it("leaves artifactId absent on nodes that carry no artifact", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    const plain: NodeRecord = {
      runId: "r1",
      siteId: "report#2",
      ordinal: 1,
      kind: "report",
      inputHash: "rh2",
      status: "completed",
      result: { finding: "untagged" },
    };
    store.putNode(plain);

    const stored = store.getNode("r1", "report#2", 1)!;
    expect("artifactId" in stored).toBe(false);
    expect(stored).toEqual(plain);
  });

  it("returns artifactId from listNodes as well as getNode", () => {
    const store = factory();
    store.createRun(baseRun("r1"));
    store.putNode({
      runId: "r1",
      siteId: "artifact#1",
      ordinal: 1,
      kind: "artifact",
      inputHash: "a1",
      status: "completed",
      result: { id: "book", kind: "file", version: 1 } satisfies ArtifactVersionRecord,
      artifactId: "book",
    });
    store.putNode({
      runId: "r1",
      siteId: "report#1",
      ordinal: 1,
      kind: "report",
      inputHash: "r1h",
      status: "completed",
      result: { round: 1 },
      artifactId: "perf",
    });
    store.putNode({
      runId: "r1",
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      inputHash: "k1",
      status: "completed",
      result: "plain",
    });

    const nodes = store.listNodes("r1", { kinds: "all", withResult: true });
    expect(nodes.map((n) => n.artifactId)).toEqual(["book", "perf", undefined]);
    expect("artifactId" in nodes[2]!).toBe(false);
  });
}
