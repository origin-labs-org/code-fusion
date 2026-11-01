// ============================================================
// ============================================================
//
//

import {
  WORKFLOW_ARTIFACT_LIMITS,
  type WorkflowRunArtifactKind,
  type WorkflowRunArtifactSummary,
} from "./workflow-artifacts.js";

const ARTIFACT_KINDS: ReadonlySet<string> = new Set<WorkflowRunArtifactKind>([
  "file",
  "markdown",
  "chart",
  "table",
  "metrics",
  "board",
]);

export function workflowArtifactSummary(value: unknown): WorkflowRunArtifactSummary | undefined {
  if (!isPlainRecord(value)) return undefined;
  const id = nonEmptyString(value.id);
  const kind = nonEmptyString(value.kind);
  const version = value.version;
  if (id === undefined || kind === undefined || !ARTIFACT_KINDS.has(kind)) return undefined;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return undefined;
  const title = nonEmptyString(value.title);
  const contentType = nonEmptyString(value.contentType);
  const bytes = value.bytes;
  return {
    id: id.slice(0, WORKFLOW_ARTIFACT_LIMITS.maxIdLength),
    kind: kind as WorkflowRunArtifactKind,
    ...(title === undefined
      ? {}
      : { title: title.slice(0, WORKFLOW_ARTIFACT_LIMITS.maxTitleLength) }),
    version: Math.min(version, WORKFLOW_ARTIFACT_LIMITS.maxVersions),
    ...(contentType === undefined ? {} : { contentType: contentType.slice(0, 128) }),
    ...(typeof bytes === "number" && Number.isInteger(bytes) && bytes >= 0 ? { bytes } : {}),
    ...(value.primary === true ? { primary: true as const } : {}),
  };
}

export function upsertBoundedByArtifactId(
  list: readonly WorkflowRunArtifactSummary[],
  entry: WorkflowRunArtifactSummary,
  limit: number,
): { list: WorkflowRunArtifactSummary[]; truncated: boolean } {
  const index = list.findIndex((item) => item.id === entry.id);
  if (index >= 0) {
    const previous = list[index]!;
    const next = [...list];
    next[index] = {
      ...entry,
      ...(previous.itemCount === undefined ? {} : { itemCount: previous.itemCount }),
    };
    return { list: next, truncated: false };
  }
  if (list.length >= limit) return { list: [...list], truncated: true };
  return { list: [...list, entry], truncated: false };
}

export function countTaggedReport(
  list: readonly WorkflowRunArtifactSummary[] | undefined,
  artifactId: string,
): WorkflowRunArtifactSummary[] | undefined {
  if (list === undefined) return undefined;
  const index = list.findIndex((item) => item.id === artifactId);
  if (index < 0) return undefined;
  const previous = list[index]!;
  const next = [...list];
  next[index] = { ...previous, itemCount: (previous.itemCount ?? 0) + 1 };
  return next;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
