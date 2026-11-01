

interface PublishedArtifactSummary {
  id: string;
  kind: string;
  version: number;
  title?: string;
  contentType?: string;
  
  bytes?: number;
  
  itemCount?: number;
  
  primary?: true;
  
  description?: string;
}

const WORKFLOW_ARTIFACT_DESCRIPTION_MAX_CHARS = 500;

function primaryFirst<T extends { primary?: true }>(artifacts: readonly T[]): T[] {
  return [...artifacts].sort(
    (left, right) => Number(right.primary === true) - Number(left.primary === true),
  );
}

export const WORKFLOW_ARTIFACTS_NOTIFICATION_MAX_LINES = 8;

export const WORKFLOW_ARTIFACTS_INTROSPECTION_MAX_LINES = 32;

const WORKFLOW_ARTIFACT_TITLE_MAX_CHARS = 120;

const WORKFLOW_ARTIFACT_ID_MAX_CHARS = 64;

const WORKFLOW_ARTIFACT_CONTENT_TYPE_MAX_CHARS = 255;

const PRESET_ARTIFACT_KINDS: ReadonlySet<string> = new Set(["chart", "table", "metrics", "board"]);

export function formatPublishedArtifactLine(artifact: PublishedArtifactSummary): string {
  const parts = artifact.primary === true ? [artifact.kind, "primary"] : [artifact.kind];
  parts.push(`v${artifact.version}`);
  if (artifact.contentType !== undefined && artifact.contentType.length > 0) {
    parts.push(artifact.contentType);
  }
  if (PRESET_ARTIFACT_KINDS.has(artifact.kind)) {
    if (artifact.itemCount !== undefined) {
      parts.push(`${artifact.itemCount} item${artifact.itemCount === 1 ? "" : "s"}`);
    }
  } else if (artifact.bytes !== undefined) {
    parts.push(`${artifact.bytes} bytes`);
  }
  const head = `- ${artifact.id} (${parts.join(", ")})`;
  const title = artifact.title?.trim();
  return title === undefined || title.length === 0 ? head : `${head}: ${title}`;
}

interface WorkflowArtifactsNotificationSection {
  
  count: number;
  
  shown: number;
  preview: string;
}

export function buildWorkflowArtifactsNotificationSection(
  artifacts: readonly PublishedArtifactSummary[] | undefined,
  maxLines: number,
): WorkflowArtifactsNotificationSection | undefined {
  if (artifacts === undefined || artifacts.length === 0) return undefined;
  const lines = primaryFirst(artifacts).slice(0, maxLines).map(formatPublishedArtifactLine);
  return { count: artifacts.length, shown: lines.length, preview: lines.join("\n") };
}

interface WorkflowArtifactManifestEntry {
  id: string;
  kind: "file" | "markdown" | "chart" | "table" | "metrics" | "board";
  title?: string;
  version: number;
  contentType?: string;
  primary?: true;
  
  description?: string;
}

export function buildWorkflowArtifactsManifestSection(
  artifacts: readonly PublishedArtifactSummary[] | undefined,
): { artifacts: WorkflowArtifactManifestEntry[]; artifactsTruncated?: true } | undefined {
  if (artifacts === undefined || artifacts.length === 0) return undefined;
  const entries: WorkflowArtifactManifestEntry[] = [];
  for (const artifact of primaryFirst(artifacts)) {
    if (entries.length >= WORKFLOW_ARTIFACTS_NOTIFICATION_MAX_LINES) break;
    const kind = manifestArtifactKind(artifact.kind);
    if (kind === undefined || artifact.id.length === 0) continue;
    if (artifact.id.length > WORKFLOW_ARTIFACT_ID_MAX_CHARS) continue;
    if (!Number.isInteger(artifact.version) || artifact.version < 1) continue;
    const title = artifact.title?.trim();
    const contentType =
      artifact.contentType !== undefined &&
      artifact.contentType.length <= WORKFLOW_ARTIFACT_CONTENT_TYPE_MAX_CHARS
        ? artifact.contentType
        : undefined;
    const description = artifact.primary === true ? artifact.description?.trim() : undefined;
    entries.push({
      id: artifact.id,
      kind,
      ...(title === undefined || title.length === 0
        ? {}
        : { title: title.slice(0, WORKFLOW_ARTIFACT_TITLE_MAX_CHARS) }),
      version: artifact.version,
      ...(contentType === undefined ? {} : { contentType }),
      ...(artifact.primary === true ? { primary: true as const } : {}),
      ...(description === undefined || description.length === 0
        ? {}
        : { description: description.slice(0, WORKFLOW_ARTIFACT_DESCRIPTION_MAX_CHARS) }),
    });
  }
  if (entries.length === 0) return undefined;
  const truncated = entries.length < artifacts.length;
  return { artifacts: entries, ...(truncated ? { artifactsTruncated: true as const } : {}) };
}

const MANIFEST_ARTIFACT_KINDS: readonly WorkflowArtifactManifestEntry["kind"][] = [
  "file",
  "markdown",
  "chart",
  "table",
  "metrics",
  "board",
];

function manifestArtifactKind(kind: string): WorkflowArtifactManifestEntry["kind"] | undefined {
  return MANIFEST_ARTIFACT_KINDS.find((known) => known === kind);
}

export function toPublishedArtifactSummaries(
  value: unknown,
): PublishedArtifactSummary[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const summaries: PublishedArtifactSummary[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : undefined;
    const kind = typeof record.kind === "string" ? record.kind : undefined;
    const version = typeof record.version === "number" ? record.version : undefined;
    if (id === undefined || kind === undefined || version === undefined) continue;
    const versions = Array.isArray(record.versions) ? record.versions : undefined;
    const latest = versions?.[versions.length - 1];
    const bytes =
      latest !== null &&
      typeof latest === "object" &&
      typeof (latest as Record<string, unknown>).bytes === "number"
        ? ((latest as Record<string, unknown>).bytes as number)
        : undefined;
    summaries.push({
      id,
      kind,
      version,
      ...(typeof record.title === "string" ? { title: record.title } : {}),
      ...(typeof record.contentType === "string" ? { contentType: record.contentType } : {}),
      ...(bytes === undefined ? {} : { bytes }),
      ...(typeof record.itemCount === "number" ? { itemCount: record.itemCount } : {}),
      ...(record.primary === true ? { primary: true as const } : {}),
      ...(typeof record.description === "string" ? { description: record.description } : {}),
    });
  }
  return summaries.length === 0 ? undefined : summaries;
}
