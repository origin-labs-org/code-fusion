import { useMemo, type ReactNode } from "react";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import { draftTimeline, scanWorkflowDraft } from "@/components/workflow-timeline/draft-scan.js";
import { narrowTimelineToFill } from "@/components/workflow-timeline/timeline-holes.js";
import {
  buildWorkflowTimeline,
  type WorkflowTimelineModel,
} from "@/components/workflow-timeline/timeline-model.js";
import { readWorkflowDisplay } from "@/ToolCallBlocks/renderers/createWorkflowDisplay.js";
import {
  readWorkflowHoleTarget,
  type WorkflowHoleTarget,
} from "@/ToolCallBlocks/renderers/createWorkflowHoleInput.js";
import type { WorkflowKindVocabulary } from "@/ToolCallBlocks/renderers/createWorkflowInput.js";
import { isFillWorkflowHoleToolCall } from "@/lib/workflowToolNames.js";

export function useWorkflowHoleRow(
  toolCall: {
    toolName?: string | null;
    kind?: string | null;
    title?: string | null;
    raw?: unknown;
    input?: unknown;
  },
  amend: boolean,
): {
  fill: boolean;
  holeTarget: WorkflowHoleTarget | undefined;
  vocabulary: WorkflowKindVocabulary;
} {
  const fill = isFillWorkflowHoleToolCall(toolCall);
  const holeTarget = useMemo(
    () =>
      fill
        ? readWorkflowHoleTarget(toolCall.input, readWorkflowDisplay(toolCall.raw)?.fill)
        : undefined,
    [fill, toolCall.input, toolCall.raw],
  );
  return { fill, holeTarget, vocabulary: fill ? "hole" : amend };
}

export function useWorkflowCardModel({
  graph,
  holeTarget,
  run,
  scriptText,
  writing,
}: {
  graph: WorkflowCausalityGraphData | undefined;
  run: WorkflowRunState | undefined;
  holeTarget: WorkflowHoleTarget | undefined;
  scriptText: string | undefined;
  writing: boolean;
}): WorkflowTimelineModel | undefined {
  return useMemo(() => {
    if (graph !== undefined) {
      if (holeTarget?.holeId !== undefined) {
        const labels = new Map(
          holeTarget.name === undefined ? [] : [[holeTarget.holeId, { name: holeTarget.name }]],
        );
        const whole = buildWorkflowTimeline(graph, undefined, labels);
        return narrowTimelineToFill(whole, holeTarget.holeId) ?? whole;
      }
      return buildWorkflowTimeline(graph, run);
    }
    if (writing && scriptText !== undefined) return draftTimeline(scanWorkflowDraft(scriptText));
    return undefined;
  }, [graph, holeTarget, run, scriptText, writing]);
}

export function useWorkflowRowPrimaryText(fill: boolean, name: string): ReactNode {
  return useMemo(
    () =>
      fill ? (
        <span className="inline-flex min-w-0 items-center gap-2 text-foreground-subtlest">
          <span aria-hidden>·</span>
          <span className="truncate" data-testid="workflow-fill-hole-name">
            {name}
          </span>
        </span>
      ) : (
        <span className="truncate text-foreground-subtlest">{name}</span>
      ),
    [fill, name],
  );
}
