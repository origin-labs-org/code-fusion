import type { WorkflowCausalityGraphData } from "./types.js";

const ELLIPSIS = "…";

export type NamePattern = NonNullable<WorkflowCausalityGraphData["lanes"][number]["namePattern"]>;

export function formatNamePattern(pattern: NamePattern | undefined): string | undefined {
  if (pattern === undefined) return undefined;
  const head = pattern.head ?? "";
  const tail = pattern.tail ?? "";
  if (head === "" && tail === "") return undefined;
  return `${head}${ELLIPSIS}${tail}`;
}
