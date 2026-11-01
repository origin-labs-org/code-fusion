

import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { formatArtifactBytes } from "@/app-shell/workflow-artifacts/artifactPresentation.js";
import { toFileUrl } from "@/lib/path.js";
import type { WorkflowRunArtifactView } from "@/hooks/useWorkflowRunArtifacts.js";

export function ArtifactMetadataCard({
  artifact,
  bytes,
  note,
  action,
  testId,
}: {
  artifact: WorkflowRunArtifactView;
  bytes: number;
  
  note?: string;
  action?: { label: string; onActivate: () => void; testId?: string };
  testId: string;
}) {
  return (
    <div className="flex h-full min-h-0 items-start justify-center overflow-auto p-6">
      <div
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-card-border bg-card p-4"
        data-testid={testId}
      >
        <div className="min-w-0">
          <div className="truncate text-ui-base font-medium text-foreground">
            {artifact.title ?? artifact.id}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-ui-sm text-foreground-subtle">
            {artifact.contentType === undefined ? null : <span>{artifact.contentType}</span>}
            <span>{formatArtifactBytes(bytes)}</span>
          </div>
          {artifact.sourcePath === undefined ? null : (
            <div
              className="mt-0.5 truncate font-mono text-ui-xs text-foreground-subtlest"
              title={artifact.sourcePath}
            >
              {artifact.sourcePath}
            </div>
          )}
        </div>
        {note === undefined ? null : (
          <p className="text-ui-sm text-foreground-subtle" data-testid="workflow-artifact-note">
            {note}
          </p>
        )}
        {action === undefined ? null : (
          <Button
            className="self-start"
            {...(action.testId === undefined ? {} : { "data-testid": action.testId })}
            onClick={action.onActivate}
            size="sm"
            type="button"
            variant="outline"
          >
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}

export function WorkflowArtifactHtmlCard({
  artifact,
  bytes,
  localSourcePath,
  isLatestVersion,
  onOpenBrowserUrl,
  onReveal,
}: {
  artifact: WorkflowRunArtifactView;
  bytes: number;
  localSourcePath?: string;
  isLatestVersion: boolean;
  onOpenBrowserUrl?: (url: string) => void;
  onReveal?: () => void;
}) {
  const { intl } = useCfIntl();
  const openable =
    isLatestVersion && localSourcePath !== undefined && onOpenBrowserUrl !== undefined;
  return (
    <ArtifactMetadataCard
      artifact={artifact}
      bytes={bytes}
      note={intl.formatMessage({
        id: openable
          ? "chat.toolCall.workflow.run.artifacts.openInBrowserNote"
          : "chat.toolCall.workflow.run.artifacts.localOnly",
      })}
      testId="workflow-artifact-html-card"
      {...(openable
        ? {
            action: {
              label: intl.formatMessage({
                id: "chat.toolCall.workflow.run.artifacts.openInBrowser",
              }),
              onActivate: () => onOpenBrowserUrl(toFileUrl(localSourcePath)),
              testId: "workflow-artifact-open-in-browser",
            },
          }
        : onReveal === undefined
          ? {}
          : {
              action: {
                label: intl.formatMessage({ id: "chat.toolCall.workflow.run.artifacts.reveal" }),
                onActivate: onReveal,
                testId: "workflow-artifact-html-reveal",
              },
            })}
    />
  );
}

export function ArtifactNotice({
  text,
  detail,
  tone,
  testId,
}: {
  text: string;
  detail?: string;
  tone?: "error";
  testId?: string;
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center gap-1 p-6 text-center"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <p
        className={cn(
          "text-ui-base",
          tone === "error" ? "text-destructive" : "text-foreground-subtle",
        )}
      >
        {text}
      </p>
      {detail === undefined ? null : (
        <p
          className="max-w-full truncate font-mono text-ui-xs text-foreground-subtlest"
          title={detail}
        >
          {detail}
        </p>
      )}
    </div>
  );
}
