import { TID_CHAT_WORKFLOW_ARTIFACT_CHIP } from "@origin-ai/cf-shared";
import type { WorkflowNotificationMeta } from "@origin-ai/cf-shared/cf-protocol-v4";
import { WorkflowArtifactStrip } from "@/components/workflow-timeline/WorkflowArtifactStrip.js";

export function WorkflowNotificationArtifactChips({
  artifacts,
  truncated,
  onOpenArtifact,
}: {
  artifacts: NonNullable<Extract<WorkflowNotificationMeta, { kind: "terminal" }>["artifacts"]>;
  
  truncated?: boolean;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  return (
    <WorkflowArtifactStrip
      artifacts={artifacts}
      moreTestId="workflow-notification-artifacts-more"
      pillTestId={TID_CHAT_WORKFLOW_ARTIFACT_CHIP}
      size="sm"
      variant="link"
      testId="workflow-notification-artifacts"
      {...(truncated === undefined ? {} : { truncated })}
      {...(onOpenArtifact === undefined ? {} : { onOpenArtifact })}
    />
  );
}
