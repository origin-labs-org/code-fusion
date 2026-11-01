import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { TID_WORKFLOW_ARTIFACT_PANE } from "@origin-ai/cf-shared";
import type { WorkflowRunArtifactSummary } from "@origin-ai/cf-shared/cf-protocol-v4";
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, FolderOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import {
  ArtifactKindIcon,
  artifactDisplayTitle,
  artifactKindMessageId,
  artifactOpenAsFileName,
  canRevealArtifactInWorkspace,
  isArtifactPresetKind,
  isTextArtifactContentType,
} from "@/app-shell/workflow-artifacts/artifactPresentation.js";
import {
  ArtifactOpenAsFileButton,
  useCanOpenArtifactAsFile,
} from "@/app-shell/workflow-artifacts/ArtifactOpenAsFileButton.js";
import { WorkflowArtifactBody } from "@/app-shell/workflow-artifacts/WorkflowArtifactBody.js";
import { artifactPresetFieldPaths } from "@/app-shell/workflow-artifacts/presets/spec.js";
import { useWorkflowRunArtifactBytes } from "@/hooks/useWorkflowRunArtifactBytes.js";
import { useWorkflowRunArtifactData } from "@/hooks/useWorkflowRunArtifactData.js";
import {
  useWorkflowRunArtifacts,
  type WorkflowRunArtifactView,
} from "@/hooks/useWorkflowRunArtifacts.js";
import { joinFilePath } from "@/lib/path.js";
import type { WorkflowArtifactSidePaneTab } from "@/lib/workspaceSidePane.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";
import { resolveTheme, type Theme } from "@/useTheme.js";
import type { PaneWorkspaceScope } from "@/v4/paneLayoutStore.js";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { useV4Conversation, V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";

const EMPTY_SUMMARIES: readonly WorkflowRunArtifactSummary[] = [];

const WorkflowArtifactContent = memo(function WorkflowArtifactContent({
  tab,
  onOpenBrowserUrl,
  onRevealFileInTree,
}: {
  tab: WorkflowArtifactSidePaneTab;
  onOpenBrowserUrl?: (url: string) => void;
  onRevealFileInTree?: (path: string) => void;
}) {
  const { intl } = useCfIntl();
  const { layer } = useV4Conversation();
  const [lease, setLease] = useState<SessionLease | null>(null);
  const theme = useCfStoreWithDefault((state) => state.theme, "system");

  useEffect(() => {
    const nextLease = layer.acquire(tab.parentSessionId);
    setLease(nextLease);
    return () => nextLease.release();
  }, [layer, tab.parentSessionId]);
  const state = useConversationProjection(lease);
  const run = useMemo(
    () => state.snapshot?.workflowRuns?.runs.find((candidate) => candidate.runId === tab.runId),
    [state.snapshot?.workflowRuns, tab.runId],
  );
  const live = run === undefined ? undefined : (run.artifacts ?? EMPTY_SUMMARIES);
  const {
    artifacts,
    loading: metadataLoading,
    unavailable,
  } = useWorkflowRunArtifacts({
    sessionId: tab.parentSessionId,
    runId: tab.runId,
    ...(live === undefined ? {} : { live }),
  });

  const artifact = useMemo(
    () => artifacts.find((candidate) => candidate.id === tab.artifactId),
    [artifacts, tab.artifactId],
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-artifact-source={live === undefined ? "journal" : "live"}
      data-testid={TID_WORKFLOW_ARTIFACT_PANE}
      data-workflow-artifact-id={tab.artifactId}
      data-workflow-run-id={tab.runId}
    >
      {artifact === undefined ? (
        <div className="flex h-full items-center justify-center p-6 text-center">
          <p
            className="text-ui-base text-foreground-subtle"
            data-testid="workflow-artifact-placeholder"
          >
            {intl.formatMessage({
              id: metadataLoading
                ? "chat.toolCall.workflow.run.artifacts.loading"
                : unavailable
                  ? "chat.toolCall.workflow.run.artifacts.unavailable"
                  : "chat.toolCall.workflow.run.artifacts.missing",
            })}
          </p>
        </div>
      ) : (
        <WorkflowArtifactView
          artifact={artifact}
          metadataLoading={metadataLoading}
          tab={tab}
          theme={theme}
          {...(onOpenBrowserUrl === undefined ? {} : { onOpenBrowserUrl })}
          {...(onRevealFileInTree === undefined ? {} : { onRevealFileInTree })}
        />
      )}
    </div>
  );
});

function WorkflowArtifactView({
  artifact,
  metadataLoading,
  tab,
  theme,
  onOpenBrowserUrl,
  onRevealFileInTree,
}: {
  artifact: WorkflowRunArtifactView;
  
  metadataLoading: boolean;
  tab: WorkflowArtifactSidePaneTab;
  theme: Theme;
  onOpenBrowserUrl?: (url: string) => void;
  onRevealFileInTree?: (path: string) => void;
}) {
  const { intl } = useCfIntl();
  const preset = isArtifactPresetKind(artifact.kind);

  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(tab.version);
  useEffect(() => {
    setSelectedVersion(tab.version);
  }, [artifact.id, tab.version]);

  const availableVersions = useMemo(() => {
    if (artifact.versions !== undefined && artifact.versions.length > 0) {
      return artifact.versions.map((entry) => entry.version);
    }
    return [artifact.version];
  }, [artifact.version, artifact.versions]);

  const version =
    selectedVersion !== undefined && availableVersions.includes(selectedVersion)
      ? selectedVersion
      : artifact.version;
  const versionIndex = availableVersions.indexOf(version);
  const isLatestVersion = version === artifact.version;

  const bytesState = useWorkflowRunArtifactBytes({
    sessionId: tab.parentSessionId,
    runId: tab.runId,
    artifactId: artifact.id,
    version,
    enabled: !preset,
  });
  const fields = useMemo(
    () =>
      isArtifactPresetKind(artifact.kind)
        ? artifactPresetFieldPaths(artifact.kind, artifact.spec)
        : undefined,
    [artifact.kind, artifact.spec],
  );
  const dataState = useWorkflowRunArtifactData({
    sessionId: tab.parentSessionId,
    runId: tab.runId,
    artifactId: artifact.id,
    itemCount: artifact.itemCount,
    enabled: fields !== undefined,
    ...(fields === undefined ? {} : { fields }),
  });

  const sourcePath = artifact.sourcePath;
  const localSourcePath =
    sourcePath !== undefined &&
    canRevealArtifactInWorkspace({
      sourcePath,
      ...(tab.workspaceIdentity === undefined ? {} : { workspaceIdentity: tab.workspaceIdentity }),
      ...(tab.remoteSessionId === undefined ? {} : { remoteSessionId: tab.remoteSessionId }),
    })
      ? joinFilePath(tab.workspacePath, sourcePath)
      : undefined;

  const canOpenAsFile = useCanOpenArtifactAsFile();
  const openAsFile = !preset && canOpenAsFile;
  const reveal =
    localSourcePath !== undefined && onRevealFileInTree !== undefined
      ? () => onRevealFileInTree(localSourcePath)
      : undefined;

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyable =
    !preset && bytesState.bytes !== null && isTextArtifactContentType(artifact.contentType);
  const handleCopy = useCallback(() => {
    if (bytesState.bytes === null) return;
    void navigator.clipboard
      ?.writeText(new TextDecoder().decode(bytesState.bytes))
      .then(() => setCopied(true))
      .catch(() => undefined);
  }, [bytesState.bytes]);

  const title = artifactDisplayTitle(artifact);
  const kindLabel = intl.formatMessage({ id: artifactKindMessageId(artifact.kind) });

  return (
    <>
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {}
          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-surface-hover text-foreground-subtle">
            <ArtifactKindIcon className="size-3.5" kind={artifact.kind} />
          </span>
          <h2
            className="min-w-0 flex-1 truncate text-ui-base font-medium text-foreground"
            data-testid="workflow-artifact-title"
            title={title}
          >
            {title}
          </h2>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-ui-sm text-foreground-subtle">{kindLabel}</span>
          <ArtifactVersionStepper
            availableVersions={availableVersions}
            onSelect={setSelectedVersion}
            version={version}
            versionIndex={versionIndex}
          />
          <div className="ml-auto flex items-center gap-1">
            {openAsFile ? (
              <ArtifactOpenAsFileButton
                artifactId={artifact.id}
                bytes={bytesState.bytesVersion === version ? bytesState.bytes : null}
                fileName={artifactOpenAsFileName(artifact, version)}
                runId={tab.runId}
                version={version}
                {...(reveal === undefined ? {} : { onReveal: reveal })}
              />
            ) : null}
            {!openAsFile && reveal !== undefined ? (
              <Button
                data-testid="workflow-artifact-reveal"
                onClick={reveal}
                size="sm"
                type="button"
                variant="ghost"
              >
                <FolderOpenIcon aria-hidden="true" className="size-3.5" />
                {intl.formatMessage({ id: "chat.toolCall.workflow.run.artifacts.reveal" })}
              </Button>
            ) : null}
            {copyable ? (
              <Button
                data-testid="workflow-artifact-copy"
                onClick={handleCopy}
                size="sm"
                type="button"
                variant="ghost"
              >
                <CopyIcon aria-hidden="true" className="size-3.5" />
                {intl.formatMessage({
                  id: copied
                    ? "chat.toolCall.workflow.run.artifacts.copied"
                    : "chat.toolCall.workflow.run.artifacts.copy",
                })}
              </Button>
            ) : null}
          </div>
        </div>
        {}
        {artifact.description === undefined ? null : (
          <p className="mt-1.5 text-ui-sm text-foreground-subtle">{artifact.description}</p>
        )}
      </header>

      <div className="min-h-0 flex-1">
        <WorkflowArtifactBody
          artifact={artifact}
          blob={bytesState.blob}
          bytes={bytesState.bytes}
          error={bytesState.error}
          isLatestVersion={isLatestVersion}
          items={dataState.items}
          loading={bytesState.loading}
          metadataLoading={metadataLoading}
          objectUrl={bytesState.objectUrl}
          resolvedTheme={resolveTheme(theme)}
          theme={theme}
          version={version}
          {...(localSourcePath === undefined ? {} : { localSourcePath })}
          {...(onOpenBrowserUrl === undefined ? {} : { onOpenBrowserUrl })}
          {...(reveal === undefined ? {} : { onReveal: reveal })}
        />
      </div>
    </>
  );
}

function ArtifactVersionStepper({
  availableVersions,
  version,
  versionIndex,
  onSelect,
}: {
  availableVersions: readonly number[];
  version: number;
  versionIndex: number;
  onSelect: (version: number) => void;
}) {
  const { intl } = useCfIntl();
  if (availableVersions.length <= 1) {
    return (
      <span
        className="font-mono text-ui-xs text-foreground-subtlest"
        data-testid="workflow-artifact-version"
      >
        {intl.formatMessage(
          { id: "chat.toolCall.workflow.run.artifacts.version" },
          { version: String(version) },
        )}
      </span>
    );
  }
  const previous = availableVersions[versionIndex - 1];
  const next = availableVersions[versionIndex + 1];
  return (
    <div className="flex items-center gap-0.5" data-testid="workflow-artifact-version-stepper">
      <Button
        aria-label={intl.formatMessage({
          id: "chat.toolCall.workflow.run.artifacts.previousVersion",
        })}
        data-testid="workflow-artifact-version-previous"
        disabled={previous === undefined}
        onClick={() => (previous === undefined ? undefined : onSelect(previous))}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
      </Button>
      <span
        className="font-mono text-ui-xs text-foreground-subtle"
        data-testid="workflow-artifact-version"
      >
        {intl.formatMessage(
          { id: "chat.toolCall.workflow.run.artifacts.versionOf" },
          { total: String(availableVersions.length), version: String(version) },
        )}
      </span>
      <Button
        aria-label={intl.formatMessage({ id: "chat.toolCall.workflow.run.artifacts.nextVersion" })}
        data-testid="workflow-artifact-version-next"
        disabled={next === undefined}
        onClick={() => (next === undefined ? undefined : onSelect(next))}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ChevronRightIcon aria-hidden="true" className="size-3.5" />
      </Button>
    </div>
  );
}

export const WorkflowArtifactSidePane = memo(function WorkflowArtifactSidePane({
  tab,
  onOpenBrowserUrl,
  onRevealFileInTree,
}: {
  tab: WorkflowArtifactSidePaneTab;
  
  onOpenBrowserUrl?: (url: string) => void;
  
  onRevealFileInTree?: (path: string) => void;
}) {
  const scope = useMemo<PaneWorkspaceScope>(
    () => ({
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
    }),
    [tab.remoteSessionId, tab.workspaceIdentity, tab.workspacePath],
  );

  return (
    <V4PaneConversationProvider scope={scope}>
      <WorkflowArtifactContent
        tab={tab}
        {...(onOpenBrowserUrl === undefined ? {} : { onOpenBrowserUrl })}
        {...(onRevealFileInTree === undefined ? {} : { onRevealFileInTree })}
      />
    </V4PaneConversationProvider>
  );
});
