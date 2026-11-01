//
//
import { describe, expect, it } from "vitest";
import {
  backgroundResultOriginMetaSchema,
  workflowNotificationMetaSchema,
} from "../src/cf-protocol-v4/rows.js";

const terminal = (overrides: Record<string, unknown> = {}) => ({
  kind: "terminal" as const,
  status: "completed" as const,
  summary: "nightly audit",
  ...overrides,
});

describe("workflowNotificationMeta.terminal.artifacts", () => {
  it("Accept the five fields required by chips, with title / contentType being optional", () => {
    const parsed = workflowNotificationMetaSchema.parse(
      terminal({
        artifacts: [
          {
            id: "audit",
            kind: "file",
            title: "审计报告",
            version: 2,
            contentType: "application/pdf",
          },
          { id: "perf", kind: "chart", version: 1 },
        ],
      }),
    );
    expect(parsed.kind).toBe("terminal");
    expect(parsed.kind === "terminal" && parsed.artifacts).toEqual([
      { id: "audit", kind: "file", title: "审计报告", version: 2, contentType: "application/pdf" },
      { id: "perf", kind: "chart", version: 1 },
    ]);
  });

  it("When both fields are absent, it means \"this run has no artifacts\"; do not send an empty array", () => {
    const parsed = workflowNotificationMetaSchema.parse(terminal());
    expect(parsed).not.toHaveProperty("artifacts");
    expect(parsed).not.toHaveProperty("artifactsTruncated");
  });

  it("artifactsTruncated can only be true (false is a noise field on every payload)", () => {
    expect(
      workflowNotificationMetaSchema.parse(terminal({ artifacts: [], artifactsTruncated: true })),
    ).toMatchObject({ artifactsTruncated: true });
    expect(() =>
      workflowNotificationMetaSchema.parse(terminal({ artifactsTruncated: false })),
    ).toThrow();
  });

  it("Upper bound of 8 items: truncated in-place on emitter side; exceeding the limit causes the entire row to be rejected upon storage", () => {
    const entries = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `a${index + 1}`,
        kind: "markdown" as const,
        version: 1,
      }));
    expect(workflowNotificationMetaSchema.parse(terminal({ artifacts: entries(8) }))).toMatchObject(
      { kind: "terminal" },
    );
    expect(() =>
      workflowNotificationMetaSchema.parse(terminal({ artifacts: entries(9) })),
    ).toThrow();
  });

  it("kind is a closed set: unknown kinds cause the entire payload to be rejected, so the emitter side must filter first", () => {
    expect(() =>
      workflowNotificationMetaSchema.parse(
        terminal({ artifacts: [{ id: "future", kind: "hologram", version: 1 }] }),
      ),
    ).toThrow();
    for (const kind of ["file", "markdown", "chart", "table", "metrics", "board"]) {
      expect(() =>
        workflowNotificationMetaSchema.parse(
          terminal({ artifacts: [{ id: "a", kind, version: 1 }] }),
        ),
      ).not.toThrow();
    }
  });

  it("id 非空 ≤64、title ≤120（= ARTIFACT_CAPS.maxTitleLength）、version 是正整数", () => {
    const one = (entry: Record<string, unknown>) => () =>
      workflowNotificationMetaSchema.parse(terminal({ artifacts: [entry] }));
    expect(one({ id: "", kind: "file", version: 1 })).toThrow();
    expect(one({ id: "x".repeat(65), kind: "file", version: 1 })).toThrow();
    expect(one({ id: "x".repeat(64), kind: "file", version: 1 })).not.toThrow();
    expect(one({ id: "a", kind: "file", version: 1, title: "t".repeat(121) })).toThrow();
    expect(one({ id: "a", kind: "file", version: 1, title: "t".repeat(120) })).not.toThrow();
    expect(one({ id: "a", kind: "file", version: 0 })).toThrow();
    expect(one({ id: "a", kind: "file", version: 1.5 })).toThrow();
  });

  it("primary can only be true; description is only meaningful on deliverables, ≤500 (= ARTIFACT_CAPS.maxDescriptionLength)", () => {
    const one = (entry: Record<string, unknown>) => () =>
      workflowNotificationMetaSchema.parse(terminal({ artifacts: [entry] }));
    const deliverable = {
      id: "report",
      kind: "markdown",
      title: "审计报告",
      version: 3,
      primary: true,
      description: "Conclusions and remediation recommendations from this audit round.",
    };
    const parsed = workflowNotificationMetaSchema.parse(terminal({ artifacts: [deliverable] }));
    expect(parsed.kind === "terminal" && parsed.artifacts).toEqual([deliverable]);
    expect(one({ id: "a", kind: "file", version: 1, primary: false })).toThrow();
    expect(one({ id: "a", kind: "file", version: 1, description: "d".repeat(500) })).not.toThrow();
    expect(one({ id: "a", kind: "file", version: 1, description: "d".repeat(501) })).toThrow();
  });

  it("Payload passes schema validation alongside originMeta (chips\' sole data source)", () => {
    const parsed = backgroundResultOriginMetaSchema.parse({
      backgroundSource: "workflow",
      workId: "dwfrun-1",
      title: "nightly audit",
      workflowNotification: terminal({
        artifacts: [{ id: "audit", kind: "file", version: 1 }],
        artifactsTruncated: true,
      }),
    });
    const meta = parsed.workflowNotification;
    expect(meta?.kind === "terminal" && meta.artifacts?.[0]?.id).toBe("audit");
    expect(meta?.kind === "terminal" && meta.artifactsTruncated).toBe(true);
  });

  it("escalation branch does not spawn artifacts", () => {
    const parsed = workflowNotificationMetaSchema.parse({
      kind: "escalation",
      qid: "dwfq-1",
      actor: "actor#1@1",
      question: "which branch?",
      artifacts: [{ id: "a", kind: "file", version: 1 }],
    });
    expect(parsed).not.toHaveProperty("artifacts");
  });
});
