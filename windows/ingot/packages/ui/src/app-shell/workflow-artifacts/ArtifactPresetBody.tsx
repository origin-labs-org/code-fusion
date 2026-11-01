import {
  ArtifactBoard,
  ArtifactChart,
  ArtifactMetrics,
  ArtifactTable,
  parseArtifactPresetSpec,
  type ArtifactItem,
  type BoardSpec,
  type ChartSpec,
  type MetricsSpec,
  type TableSpec,
} from "@/app-shell/workflow-artifacts/presets/index.js";
import { isArtifactPresetKind } from "@/app-shell/workflow-artifacts/artifactPresentation.js";
import type { PresetLabels } from "@/app-shell/workflow-artifacts/presets/index.js";
import type { WorkflowRunArtifactView } from "@/hooks/useWorkflowRunArtifacts.js";

export function ArtifactPresetBody({
  artifact,
  items,
  labels,
  compact,
  invalidLabel,
  missingLabel,
  className,
}: {
  artifact: Pick<WorkflowRunArtifactView, "kind" | "spec">;
  items: readonly ArtifactItem[];
  labels: PresetLabels;
  compact?: boolean;
  
  invalidLabel?: string;
  
  missingLabel?: string;
  className?: string;
}) {
  if (!isArtifactPresetKind(artifact.kind)) return null;
  //
  if (artifact.spec === undefined) {
    return missingLabel === undefined ? null : (
      <p
        className="text-ui-sm text-foreground-subtlest"
        data-testid="workflow-run-artifact-preset-missing"
      >
        {missingLabel}
      </p>
    );
  }
  const spec = parseArtifactPresetSpec(artifact.kind, artifact.spec);
  if (spec === undefined) {
    return invalidLabel === undefined ? null : (
      <p
        className="text-ui-sm text-foreground-subtlest"
        data-testid="workflow-run-artifact-preset-invalid"
      >
        {invalidLabel}
      </p>
    );
  }
  const shared = { compact, items, labels, className };
  switch (artifact.kind) {
    case "chart":
      return <ArtifactChart spec={spec as ChartSpec} {...shared} />;
    case "table":
      return <ArtifactTable spec={spec as TableSpec} {...shared} />;
    case "metrics":
      return <ArtifactMetrics spec={spec as MetricsSpec} {...shared} />;
    default:
      return <ArtifactBoard spec={spec as BoardSpec} {...shared} />;
  }
}
