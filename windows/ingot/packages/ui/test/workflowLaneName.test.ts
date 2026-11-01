import { describe, expect, it } from "vitest";
import { laneDisplayName } from "../src/components/workflow-graph/lane-name.js";

function formatMessage({ id }: { id: string }, values?: Record<string, string | number>): string {
  if (values === undefined) return id;
  const args = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return `${id}(${args})`;
}

describe("laneDisplayName", () => {
  it("shows a script-authored actor name verbatim, never localized", () => {
    expect(laneDisplayName({ laneClass: "agent", name: "planner" }, formatMessage)).toBe("planner");
    expect(
      laneDisplayName({ anonymousIndex: 2, laneClass: "agent", name: "planner" }, formatMessage),
    ).toBe("planner");
  });

  it("names a lone unnamed actor lane, instead of leaking its site id", () => {
    expect(laneDisplayName({ laneClass: "agent" }, formatMessage)).toBe(
      "chat.toolCall.workflow.graph.lane.anonymous",
    );
  });

  it("numbers unnamed actor lanes when the projection says several coexist", () => {
    expect(laneDisplayName({ anonymousIndex: 1, laneClass: "agent" }, formatMessage)).toBe(
      "chat.toolCall.workflow.graph.lane.anonymousIndexed(index=1)",
    );
    expect(laneDisplayName({ anonymousIndex: 2, laneClass: "agent" }, formatMessage)).toBe(
      "chat.toolCall.workflow.graph.lane.anonymousIndexed(index=2)",
    );
  });

  it("keeps the two synthetic lanes on their own localized labels", () => {
    expect(laneDisplayName({ laneClass: "workspace" }, formatMessage)).toBe(
      "chat.toolCall.workflow.graph.lane.script",
    );
    expect(laneDisplayName({ laneClass: "unresolved" }, formatMessage)).toBe(
      "chat.toolCall.workflow.graph.lane.unresolved",
    );
  });

  it("renders an interpolated name's static shape instead of the anonymous fallback", () => {
    expect(
      laneDisplayName({ laneClass: "agent", namePattern: { head: "研究员" } }, formatMessage),
    ).toBe("研究员…");
    expect(
      laneDisplayName({ laneClass: "agent", namePattern: { tail: "-worker" } }, formatMessage),
    ).toBe("…-worker");
    expect(
      laneDisplayName({ laneClass: "agent", namePattern: { head: "a", tail: "b" } }, formatMessage),
    ).toBe("a…b");
  });

  it("prefers a literal name over a pattern, and a pattern over the anonymous fallback", () => {
    expect(
      laneDisplayName(
        { laneClass: "agent", name: "planner", namePattern: { head: "研究员" } },
        formatMessage,
      ),
    ).toBe("planner");
    expect(
      laneDisplayName(
        { anonymousIndex: 2, laneClass: "agent", namePattern: { head: "研究员" } },
        formatMessage,
      ),
    ).toBe("研究员…");
  });

  it("falls back to anonymous rather than render a lone ellipsis", () => {
    expect(laneDisplayName({ laneClass: "agent", namePattern: {} }, formatMessage)).toBe(
      "chat.toolCall.workflow.graph.lane.anonymous",
    );
  });
});
