import type { ReactNode } from "react";
import { ChartLineIcon, FileIcon, GaugeIcon, SquareKanbanIcon, TableIcon } from "lucide-react";
import type { WorkflowRunArtifactKind } from "@origin-ai/cf-shared/cf-protocol-v4";
import { FileDisplayIcon, resolveFileDisplayDescriptor } from "@/lib/fileDisplay.js";
import type {
  ArtifactPresetKind,
  PresetLabels,
} from "@/app-shell/workflow-artifacts/presets/index.js";

const PRESET_KINDS = new Set<WorkflowRunArtifactKind>(["chart", "table", "metrics", "board"]);

export function isArtifactPresetKind(kind: WorkflowRunArtifactKind): kind is ArtifactPresetKind {
  return PRESET_KINDS.has(kind);
}

export function artifactKindMessageId(kind: WorkflowRunArtifactKind): string {
  return `chat.toolCall.workflow.run.artifacts.kind.${kind}`;
}

const MARKDOWN_ICON = resolveFileDisplayDescriptor("artifact.md").fileIconSrc;
const KIND_ICON: Record<Exclude<WorkflowRunArtifactKind, "markdown">, typeof FileIcon> = {
  file: FileIcon,
  chart: ChartLineIcon,
  table: TableIcon,
  metrics: GaugeIcon,
  board: SquareKanbanIcon,
};

export function ArtifactKindIcon({
  kind,
  className,
}: {
  kind: WorkflowRunArtifactKind;
  className?: string;
}): ReactNode {
  if (kind === "markdown") {
    return <FileDisplayIcon src={MARKDOWN_ICON} className={className} />;
  }
  const Icon = KIND_ICON[kind];
  return <Icon aria-hidden="true" className={className} />;
}

export function formatArtifactBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function isTextArtifactContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  return contentType.startsWith("text/") || contentType === "application/json";
}

export function artifactFileBadge(artifact: {
  sourcePath?: string;
  contentType?: string;
}): string | undefined {
  const extension = artifact.sourcePath?.match(/\.([a-z0-9]{1,5})$/iu)?.[1];
  if (extension !== undefined) return extension.toUpperCase();
  const subtype = artifact.contentType?.split("/")[1]?.split(";")[0]?.trim();
  if (subtype === undefined || subtype.length === 0) return undefined;
  const KNOWN: Record<string, string> = {
    "x-markdown": "MD",
    markdown: "MD",
    plain: "TXT",
    json: "JSON",
    csv: "CSV",
    html: "HTML",
    pdf: "PDF",
  };
  return KNOWN[subtype] ?? (subtype.length <= 5 ? subtype.toUpperCase() : undefined);
}

export function ArtifactDetail({
  artifact,
  labels,
}: {
  artifact: {
    kind: WorkflowRunArtifactKind;
    bytes?: number;
    itemCount?: number;
    sourcePath?: string;
    contentType?: string;
  };
  labels: PresetLabels;
}): ReactNode {
  if (isArtifactPresetKind(artifact.kind)) {
    return artifact.itemCount === undefined ? null : (
      <span data-testid="workflow-run-artifact-items">{labels.itemsCount(artifact.itemCount)}</span>
    );
  }
  if (artifact.bytes === undefined) return null;
  const badge = artifact.kind === "file" ? artifactFileBadge(artifact) : undefined;
  return (
    <>
      {badge === undefined ? null : (
        <>
          <span data-testid="workflow-run-artifact-badge">{badge}</span>
          <span aria-hidden>·</span>
        </>
      )}
      <span data-testid="workflow-run-artifact-bytes">{formatArtifactBytes(artifact.bytes)}</span>
    </>
  );
}

export function artifactDetailText(
  artifact: {
    kind: WorkflowRunArtifactKind;
    bytes?: number;
    itemCount?: number;
    sourcePath?: string;
    contentType?: string;
  },
  labels: PresetLabels,
): string | undefined {
  if (isArtifactPresetKind(artifact.kind)) {
    return artifact.itemCount === undefined ? undefined : labels.itemsCount(artifact.itemCount);
  }
  if (artifact.bytes === undefined) return undefined;
  const badge = artifact.kind === "file" ? artifactFileBadge(artifact) : undefined;
  const size = formatArtifactBytes(artifact.bytes);
  return badge === undefined ? size : `${badge} · ${size}`;
}

export function resolvePrimaryArtifact<T extends { primary?: true }>(
  artifacts: readonly T[],
): T | undefined {
  const flagged = artifacts.find((artifact) => artifact.primary === true);
  if (flagged !== undefined) return flagged;
  return artifacts.length === 1 ? artifacts[0] : undefined;
}

export function orderArtifactsPrimaryFirst<T extends { primary?: true }>(
  artifacts: readonly T[],
): T[] {
  const index = artifacts.findIndex((artifact) => artifact.primary === true);
  if (index <= 0) return [...artifacts];
  return [artifacts[index]!, ...artifacts.slice(0, index), ...artifacts.slice(index + 1)];
}

export function artifactDisplayTitle(artifact: { id: string; title?: string }): string {
  return artifact.title?.trim() || artifact.id;
}

const ARTIFACT_CHIP_TITLE_MAX_LENGTH = 24;

export const ARTIFACT_CHIP_MAX_VISIBLE = 3;

export function truncateArtifactChipTitle(title: string): string {
  return title.length > ARTIFACT_CHIP_TITLE_MAX_LENGTH
    ? `${title.slice(0, ARTIFACT_CHIP_TITLE_MAX_LENGTH)}…`
    : title;
}

export function buildPresetLabels(
  formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string,
): PresetLabels {
  return {
    otherColumn: formatMessage({
      id: "chat.toolCall.workflow.run.artifacts.preset.otherColumn",
    }),
    empty: formatMessage({ id: "chat.toolCall.workflow.run.artifacts.preset.empty" }),
    itemsCount: (count: number) =>
      formatMessage(
        { id: "chat.toolCall.workflow.run.artifacts.preset.items" },
        { count: String(count) },
      ),
  };
}

export function canRevealArtifactInWorkspace(params: {
  sourcePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}): boolean {
  return (
    Boolean(params.sourcePath?.trim()) &&
    !params.workspaceIdentity?.trim() &&
    !params.remoteSessionId
  );
}

export function artifactOpenAsFileName(
  artifact: {
    id: string;
    kind: WorkflowRunArtifactKind;
    version: number;
    sourcePath?: string;
    versions?: readonly { version: number; sourcePath?: string }[];
  },
  version: number,
): string {
  if (artifact.kind === "markdown") return `${artifact.id}.md`;
  const sourcePath =
    artifact.versions?.find((entry) => entry.version === version)?.sourcePath ??
    (version === artifact.version ? artifact.sourcePath : undefined);
  const leaf = sourcePath?.split(/[\\/]/u).at(-1)?.trim();
  return leaf ? leaf : artifact.id;
}
