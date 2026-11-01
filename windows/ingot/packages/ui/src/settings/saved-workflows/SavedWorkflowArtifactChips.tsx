import { TID_WORKFLOW_ARTIFACT_CHIP, type CfSavedWorkflowRun } from "@origin-ai/cf-shared";
import type { ArtifactPillSize } from "@/components/workflow-timeline/WorkflowArtifactPill.js";
import { WorkflowArtifactStrip } from "@/components/workflow-timeline/WorkflowArtifactStrip.js";

export function SavedWorkflowArtifactChips({
  artifacts,
  onOpenArtifact,
  className,
  size = "sm",
}: {
  artifacts: NonNullable<CfSavedWorkflowRun["artifacts"]>;
  
  onOpenArtifact?: (artifactId: string) => void;
  size?: ArtifactPillSize;
  className?: string;
}) {
  return (
    <WorkflowArtifactStrip
      artifacts={artifacts}
      moreTestId="workflow-run-artifact-chips-more"
      pillTestId={TID_WORKFLOW_ARTIFACT_CHIP}
      size={size}
      testId="workflow-run-artifact-chips"
      {...(className === undefined ? {} : { className })}
      {...(onOpenArtifact === undefined ? {} : { onOpenArtifact })}
    />
  );
}
