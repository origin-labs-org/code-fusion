import { memo, useMemo, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import {
  TID_WORKFLOW_ARTIFACTS_SECTION,
  TID_WORKFLOW_ARTIFACTS_TOGGLE,
  TID_WORKFLOW_ARTIFACT_CARD,
} from "@origin-ai/cf-shared";
import { cn } from "@/components/lib/utils.js";
import { WorkflowArtifactIndex } from "@/components/workflow-timeline/WorkflowArtifactIndex.js";
import { WorkflowArtifactRow } from "@/components/workflow-timeline/WorkflowArtifactRow.js";
import { WorkflowArtifactTile } from "@/components/workflow-timeline/WorkflowArtifactTile.js";
import { PILL_STAGGER_MS } from "@/components/workflow-timeline/WorkflowTimeline.js";
import {
  ArtifactDetail,
  artifactDisplayTitle,
  artifactKindMessageId,
  buildPresetLabels,
  resolvePrimaryArtifact,
} from "@/app-shell/workflow-artifacts/artifactPresentation.js";
import { WorkflowArtifactTilePreview } from "@/app-shell/workflow-artifacts/WorkflowArtifactTilePreview.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { WorkflowRunArtifactView } from "@/hooks/useWorkflowRunArtifacts.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";

export const WorkflowRunArtifactsSection = memo(function WorkflowRunArtifactsSection({
  artifacts,
  sessionId,
  runId,
  onOpenArtifact,
}: {
  
  artifacts: readonly WorkflowRunArtifactView[];
  sessionId: string;
  runId: string;
  
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const { intl } = useCfIntl();
  const [expanded, setExpanded] = useState(true);
  const theme = useCfStoreWithDefault((state) => state.theme, "system");
  const title = intl.formatMessage({ id: "chat.toolCall.workflow.run.artifacts.title" });
  const labels = useMemo(
    () => buildPresetLabels((descriptor, values) => intl.formatMessage(descriptor, values)),
    [intl],
  );
  const primary = resolvePrimaryArtifact(artifacts);
  const rest = primary === undefined ? artifacts : artifacts.filter((a) => a !== primary);
  const preview = (artifact: WorkflowRunArtifactView) => (
    <WorkflowArtifactTilePreview
      artifact={artifact}
      key={`${artifact.id}:${artifact.version}`}
      runId={runId}
      sessionId={sessionId}
      theme={theme}
    />
  );
  const tooltipOf = (
    artifact: Pick<WorkflowRunArtifactView, "id" | "kind" | "title" | "sourcePath">,
  ) => {
    const kindLabel = intl.formatMessage({ id: artifactKindMessageId(artifact.kind) });
    return (
      `${kindLabel} · ${artifactDisplayTitle(artifact)}` +
      (artifact.sourcePath === undefined ? "" : `\n${artifact.sourcePath}`)
    );
  };

  return (
    <section
      className="wf-motion shrink-0 border-t border-border/60"
      data-artifacts-open={expanded ? "true" : "false"}
      data-testid={TID_WORKFLOW_ARTIFACTS_SECTION}
    >
      <button
        aria-expanded={expanded}
        aria-label={intl.formatMessage({
          id: expanded
            ? "chat.toolCall.workflow.run.artifacts.collapse"
            : "chat.toolCall.workflow.run.artifacts.expand",
        })}
        className="flex h-9 w-full items-center gap-2 px-3 text-left outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring/40"
        data-testid={TID_WORKFLOW_ARTIFACTS_TOGGLE}
        onClick={() => setExpanded((previous) => !previous)}
        type="button"
      >
        <span className="min-w-0 shrink-0 truncate text-ui-base font-medium text-foreground">
          {title}
        </span>
        {}
        <span
          className="shrink-0 font-mono text-ui-xs tabular-nums text-foreground-subtlest"
          data-testid="workflow-run-artifacts-count"
        >
          {artifacts.length.toLocaleString()}
        </span>
        {}
        {!expanded && primary !== undefined ? (
          <span
            className="min-w-0 truncate text-ui-sm text-foreground-subtle"
            data-testid="workflow-run-artifacts-primary-title"
          >
            · {artifactDisplayTitle(primary)}
          </span>
        ) : null}
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "ml-auto size-3.5 shrink-0 text-foreground-subtlest transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded && primary !== undefined ? (
        <div
          className="wf-unfold @container/wf-artifacts flex max-h-[50vh] flex-col gap-2.5 overflow-auto px-3 pb-3 pt-0.5"
          data-testid="workflow-run-artifact-primary-body"
        >
          <WorkflowArtifactRow
            artifact={primary}
            enterDelayMs={PILL_STAGGER_MS}
            labels={labels}
            preview={preview(primary)}
            testId={TID_WORKFLOW_ARTIFACT_CARD}
            title={tooltipOf(primary)}
            {...(onOpenArtifact === undefined ? {} : { onOpen: onOpenArtifact })}
          />
          {rest.length > 0 ? (
            <WorkflowArtifactIndex
              artifacts={rest}
              columns="one"
              firstDelayMs={PILL_STAGGER_MS * 2}
              labels={labels}
              lineTestId={TID_WORKFLOW_ARTIFACT_CARD}
              rule
              testId="workflow-run-artifact-index"
              tooltipOf={tooltipOf}
              {...(onOpenArtifact === undefined ? {} : { onOpenArtifact })}
            />
          ) : null}
        </div>
      ) : expanded ? (
        <div
          className="wf-unfold grid max-h-[50vh] grid-cols-[repeat(auto-fill,minmax(130px,180px))] gap-3 overflow-auto px-3 pb-3 pt-0.5"
          data-testid="workflow-run-artifact-gallery"
        >
          {artifacts.map((artifact, index) => (
            <WorkflowArtifactTile
              artifact={artifact}
              detail={<ArtifactDetail artifact={artifact} labels={labels} />}
              enterDelayMs={PILL_STAGGER_MS * (index + 1)}
              key={artifact.id}
              preview={preview(artifact)}
              testId={TID_WORKFLOW_ARTIFACT_CARD}
              title={tooltipOf(artifact)}
              {...(onOpenArtifact === undefined ? {} : { onOpen: onOpenArtifact })}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
});
