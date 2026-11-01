import type { ReactNode } from "react";
import { resolvePrimaryArtifact } from "@/app-shell/workflow-artifacts/artifactPresentation.js";
import type { PresetLabels } from "@/app-shell/workflow-artifacts/presets/index.js";
import { WorkflowArtifactIndex } from "./WorkflowArtifactIndex.js";
import { WorkflowArtifactRow } from "./WorkflowArtifactRow.js";
import { ArtifactSheetGlyph, type WorkflowCompletionArtifact } from "./WorkflowArtifactTile.js";
import { PILL_STAGGER_MS } from "./WorkflowTimeline.js";

export const COMPLETION_INDEX_MAX = 6;

const COMPLETION_INDEX_WITH_MORE = COMPLETION_INDEX_MAX - 1;

export interface CompletionArtifactLayout {
  
  primary?: WorkflowCompletionArtifact;
  
  lines: readonly WorkflowCompletionArtifact[];
  
  folded: number;
  
  more: boolean;
}

export function completionArtifactLayout(
  artifacts: readonly WorkflowCompletionArtifact[],
  truncated: boolean,
): CompletionArtifactLayout {
  if (artifacts.length === 0) return { lines: [], folded: 0, more: false };
  const primary = resolvePrimaryArtifact(artifacts);
  const rest = primary === undefined ? artifacts : artifacts.filter((a) => a !== primary);
  const more = rest.length > COMPLETION_INDEX_MAX || truncated;
  const lines = rest.slice(0, more ? COMPLETION_INDEX_WITH_MORE : COMPLETION_INDEX_MAX);
  return {
    ...(primary === undefined ? {} : { primary }),
    lines,
    folded: rest.length - lines.length,
    more,
  };
}

export function completionArtifactCellCount(layout: CompletionArtifactLayout): number {
  return (layout.primary === undefined ? 0 : 1) + layout.lines.length + (layout.more ? 1 : 0);
}

export function completionPreviewIds(layout: CompletionArtifactLayout): ReadonlySet<string> {
  return new Set(layout.primary === undefined ? [] : [layout.primary.id]);
}

export function WorkflowCompletionArtifacts({
  artifactsTruncated,
  labels,
  layout,
  onOpenArtifact,
  onOpenRun,
  renderPreview,
}: {
  layout: CompletionArtifactLayout;
  artifactsTruncated: boolean;
  labels: PresetLabels;
  renderPreview?: (artifact: WorkflowCompletionArtifact) => ReactNode;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenRun?: () => void;
}) {
  const { primary, lines, folded, more } = layout;
  if (primary === undefined && lines.length === 0 && !more) return null;
  const hasPrimary = primary !== undefined;
  return (
    <>
      {hasPrimary ? (
        <WorkflowArtifactRow
          artifact={primary}
          enterDelayMs={PILL_STAGGER_MS}
          labels={labels}
          preview={renderPreview?.(primary) ?? <ArtifactSheetGlyph />}
          testId="workflow-completion-row"
          {...(onOpenArtifact === undefined ? {} : { onOpen: onOpenArtifact })}
        />
      ) : null}
      {lines.length > 0 || more ? (
        <WorkflowArtifactIndex
          artifacts={lines}
          columns="auto"
          firstDelayMs={PILL_STAGGER_MS * (hasPrimary ? 2 : 1)}
          folded={folded}
          labels={labels}
          lineTestId="workflow-completion-line"
          more={more}
          moreTestId="workflow-completion-more"
          rule={hasPrimary}
          testId="workflow-completion-index"
          truncated={artifactsTruncated}
          {...(onOpenArtifact === undefined ? {} : { onOpenArtifact })}
          {...(onOpenRun === undefined ? {} : { onOpenRun })}
        />
      ) : null}
    </>
  );
}
