

import { describe, expect, it } from "vitest";
import { WorkflowError, type ArtifactVersionRecord } from "@origin-ai/cf-dynamic-workflow";
import { runScript } from "./helpers.js";

const RUN = "run";
const CHART = '{ x: { field: "round" }, y: { field: "ms" } }';

describe("e2e — Pre-set assets and labeled reports", () => {
  it("Declarations arrive via event channel first; subsequent tagged reports attach to that ID", async () => {
    const script = [
      `artifact.chart("perf", ${CHART});`,
      "for (const round of [1, 2, 3]) {",
      "  report({ round, ms: round * 10 }, \"perf\");",
      "}",
      "return { rounds: 3 };",
    ].join("\n");

    const { settlement, journal, driver } = await runScript(script);
    expect(settlement.status).toBe("completed");

    const declaration = journal.getNode(RUN, "artifact#1", 1);
    expect(declaration?.kind).toBe("artifact");
    expect(declaration?.artifactId).toBe("perf");
    expect((declaration?.result as ArtifactVersionRecord | undefined)?.kind).toBe("chart");

    const reports = journal
      .listNodes(RUN, { kinds: "all", withResult: true })
      .filter((node) => node.kind === "report");
    expect(reports.map((node) => node.artifactId)).toEqual(["perf", "perf", "perf"]);
    expect(driver.eventsOfType("report").map((event) => event.artifactId)).toEqual([
      "perf",
      "perf",
      "perf",
    ]);

    const types = driver.events.map((event) => event.type);
    expect(types.indexOf("artifact-published")).toBeLessThan(types.indexOf("report"));
  });

  it("Repeat declarations of the same spec are idempotent no-ops; run completes as usual", async () => {
    const script = [
      `artifact.chart("perf", ${CHART});`,
      `artifact.chart("perf", ${CHART});`,
      "return 1;",
    ].join("\n");
    const { settlement, driver, journal } = await runScript(script);
    expect(settlement.status).toBe("completed");
    expect(driver.eventsOfType("artifact-published")).toHaveLength(1);
    expect(
      journal
        .listNodes(RUN, { kinds: "all", withResult: true })
        .filter((node) => node.kind === "artifact"),
    ).toHaveLength(1);
  });

  it("Labels pointing to undeclared IDs cause run failure (void returns have no rejection channel)", async () => {
    const { settlement } = await runScript(`report({ a: 1 }, "perf");\nreturn 1;`);
    expect(settlement.status).toBe("errored");
    if (settlement.status !== "errored") return;
    expect(settlement.error.code).toBe("ArtifactUndeclared");
  });
});

describe("e2e — Content assets", () => {
  it("Passed via request/response boundary; arguments passed positionally, refs returned to script", async () => {
    const script = [
      'const ref = await artifact.file("book", "out/book.pdf", { title: "Book" });',
      'const notes = await artifact.markdown("notes", "# hi");',
      "return { id: ref.id, version: ref.version, notes: notes.id };",
    ].join("\n");

    const { settlement, driver, journal } = await runScript(script);
    expect(settlement).toEqual({
      status: "completed",
      artifact: { id: "book", version: 1, notes: "notes" },
    });

    expect(driver.artifactPublishes.map((r) => [r.op, r.id, r.version, r.path, r.content])).toEqual([
      ["file", "book", 1, "out/book.pdf", undefined],
      ["markdown", "notes", 1, undefined, "# hi"],
    ]);
    expect(driver.artifactPublishes[0]?.opts).toEqual({ title: "Book" });
    expect(journal.getNode(RUN, "artifact#1", 1)?.status).toBe("completed");
    expect(driver.eventsOfType("artifact-published").map((e) => e.artifact.id)).toEqual([
      "book",
      "notes",
    ]);
  });

  it("Re-publishing same ID is a new version", async () => {
    const script = [
      'const a = await artifact.markdown("notes", "one");',
      'const b = await artifact.markdown("notes", "two");',
      "return [a.version, b.version];",
    ].join("\n");
    const { settlement } = await runScript(script);
    expect(settlement).toEqual({ status: "completed", artifact: [1, 2] });
  });

  it("Driver rejections pass through as structured errors; scripts can catch and continue", async () => {
    const script = [
      "let code = \"none\";",
      "try {",
      '  await artifact.file("book", "out/missing.pdf");',
      "} catch (e) {",
      "  code = (e as { code?: string }).code ?? \"no-code\";",
      "}",
      "return code;",
    ].join("\n");

    const { settlement, journal, driver } = await runScript(script, {
      artifacts: () => {
        throw new WorkflowError("ArtifactSourceMissing", "out/missing.pdf 不存在");
      },
    });
    expect(settlement).toEqual({ status: "completed", artifact: "ArtifactSourceMissing" });
    expect(journal.getNode(RUN, "artifact#1", 1)?.status).toBe("failed");
    expect(journal.getNode(RUN, "artifact#1", 1)?.error?.code).toBe("ArtifactSourceMissing");
    expect(driver.eventsOfType("artifact-failed").map((e) => [e.id, e.op, e.error.code])).toEqual([
      ["book", "file", "ArtifactSourceMissing"],
    ]);
    expect(driver.eventsOfType("node-settled")).toEqual([]);
  });

  it("Run with ask: paths written by sub-agents are handed off by the script", async () => {
    const script = [
      'const writer = agent("writer");',
      'const path = await writer.ask("write the book");',
      'const ref = await artifact.file("book", path, { title: "Book" });',
      "return ref.version;",
    ].join("\n");

    const { settlement, driver } = await runScript(script, {
      asks: { "ask#1": () => ({ type: "text", finalText: "out/book.pdf" }) },
    });
    expect(settlement).toEqual({ status: "completed", artifact: 1 });
    expect(driver.artifactPublishes[0]?.path).toBe("out/book.pdf");
  });
});
