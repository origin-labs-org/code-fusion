// ============================================================
// ============================================================
//

import type { DwfRunIntrospectionQueries } from "@origin-ai/cf-adapters/storage";
import type {
  DynamicWorkflowRunArtifact,
  DynamicWorkflowRunArtifactKind,
  DynamicWorkflowRunArtifactVersion,
} from "@origin-ai/cf-contracts";
import type { JournalStorePort } from "@origin-ai/cf-dynamic-workflow";

export function artifactsOf(
  runId: string,
  journal: JournalStorePort,
): { artifacts?: readonly DynamicWorkflowRunArtifact[] } {
  const candidate = journal as Partial<DwfRunIntrospectionQueries>;
  if (typeof candidate.listArtifactRows !== "function") return {};
  const rows = candidate.listArtifactRows(runId);
  if (rows.length === 0) return {};

  const byId = new Map<
    string,
    { kind: DynamicWorkflowRunArtifactKind; versions: DynamicWorkflowRunArtifactVersion[] }
  >();
  for (const row of rows) {
    if (row.status !== "completed") continue;
    const record = row.result;
    if (record === null || typeof record !== "object") continue;
    const version = artifactVersionOf(record as Record<string, unknown>);
    if (version === undefined) continue;
    const id =
      typeof row.artifactId === "string" && row.artifactId.length > 0
        ? row.artifactId
        : stringField(record as Record<string, unknown>, "id");
    const kind = artifactKindOf((record as Record<string, unknown>).kind);
    if (id === undefined || kind === undefined) continue;
    const bucket = byId.get(id);
    if (bucket === undefined) byId.set(id, { kind, versions: [version] });
    else bucket.versions.push(version);
  }
  if (byId.size === 0) return {};

  const needsTally = [...byId.values()].some((bucket) => PRESET_ARTIFACT_KINDS.has(bucket.kind));
  const itemCounts = needsTally ? tagItemCounts(runId, journal) : undefined;
  const artifacts = [...byId].map(([id, bucket]) => {
    const versions = [...bucket.versions].sort((left, right) => left.version - right.version);
    const latest = versions[versions.length - 1]!;
    const primary = versions.some((version) => version.primary === true);
    return {
      id,
      kind: bucket.kind,
      ...(latest.title === undefined ? {} : { title: latest.title }),
      ...(latest.description === undefined ? {} : { description: latest.description }),
      ...(latest.contentType === undefined ? {} : { contentType: latest.contentType }),
      ...(latest.sourcePath === undefined ? {} : { sourcePath: latest.sourcePath }),
      ...(latest.spec === undefined ? {} : { spec: latest.spec }),
      version: latest.version,
      versions,
      itemCount: itemCounts?.get(id) ?? 0,
      ...(primary ? { primary: true as const } : {}),
    } satisfies DynamicWorkflowRunArtifact;
  });
  artifacts.sort((left, right) => Number(right.primary === true) - Number(left.primary === true));
  return { artifacts };
}

function tagItemCounts(runId: string, journal: JournalStorePort): ReadonlyMap<string, number> {
  const candidate = journal as Partial<DwfRunIntrospectionQueries>;
  if (typeof candidate.countTaggedReports === "function")
    return candidate.countTaggedReports(runId);
  const counts = new Map<string, number>();
  for (const node of journal.listNodes(runId, { kinds: ["report"], withResult: false })) {
    if (node.artifactId === undefined) continue;
    counts.set(node.artifactId, (counts.get(node.artifactId) ?? 0) + 1);
  }
  return counts;
}

const ARTIFACT_KINDS: ReadonlySet<string> = new Set<DynamicWorkflowRunArtifactKind>([
  "file",
  "markdown",
  "chart",
  "table",
  "metrics",
  "board",
]);

const PRESET_ARTIFACT_KINDS: ReadonlySet<string> = new Set<DynamicWorkflowRunArtifactKind>([
  "chart",
  "table",
  "metrics",
  "board",
]);

function artifactKindOf(value: unknown): DynamicWorkflowRunArtifactKind | undefined {
  return typeof value === "string" && ARTIFACT_KINDS.has(value)
    ? (value as DynamicWorkflowRunArtifactKind)
    : undefined;
}

function artifactVersionOf(
  record: Record<string, unknown>,
): DynamicWorkflowRunArtifactVersion | undefined {
  const version = record.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return undefined;
  const bytes = record.bytes;
  const publishedAt = typeof record.publishedAt === "number" ? record.publishedAt : 0;
  const title = stringField(record, "title");
  const description = stringField(record, "description");
  const contentType = stringField(record, "contentType");
  const uri = stringField(record, "uri");
  const sourcePath = stringField(record, "sourcePath");
  return {
    version,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(typeof bytes === "number" && Number.isFinite(bytes) ? { bytes } : {}),
    ...(uri === undefined ? {} : { uri }),
    ...(sourcePath === undefined ? {} : { sourcePath }),
    ...(record.spec === undefined ? {} : { spec: record.spec }),
    publishedAt,
    ...(record.primary === true ? { primary: true as const } : {}),
  };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
