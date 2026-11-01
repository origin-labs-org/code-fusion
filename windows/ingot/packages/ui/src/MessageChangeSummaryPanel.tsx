import { useMemo, useState, type CSSProperties } from "react";
import type {
  CfPersistedFileChange,
  CfTaskChangeSummary,
  CfTurnFileState,
} from "@origin-ai/cf-shared";
import { TID_CHAT_CHANGE_SUMMARY_TOGGLE_FILES_BUTTON, testId } from "@origin-ai/cf-shared/test-ids";
import { ChevronRightIcon, Undo2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import { FileDisplayInline } from "@/lib/fileDisplay.js";
import { buildTurnChangeSummary, toWorkspaceRelativePath } from "@/lib/taskChangeSummary.js";
import { Button } from "@/components/ui/button.js";
import { OpenSplitButton } from "@/OpenSplitButton.js";
import { cn } from "@/components/lib/utils.js";
import {
  buildChangeSummaryDiffViewerSource,
  buildChangeSummaryFilePreviewSource,
  openChangeSummaryDiffViewer,
} from "@/messageChangeSummaryPreview.js";
export {
  buildChangeSummaryDiffViewerSource,
  buildChangeSummaryFilePreviewSource,
  openChangeSummaryDiffViewer,
} from "@/messageChangeSummaryPreview.js";

interface MessageChangeSummaryPanelProps {
  summary: CfTaskChangeSummary;
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  changeDetails?: CfPersistedFileChange | null;
  readonlyDiffPatchesByPath?: ReadonlyMap<string, string>;
  fileState?: CfTurnFileState;
  messageId?: string;
  compactForRemoteControl?: boolean;
  animationDelayMs?: number;
  onToggleFiles?: () => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
}

export function MessageChangeSummaryPanel({
  summary,
  workspacePath,
  workspaceIdentity,
  workspaceRemoteSessionId,
  changeDetails,
  readonlyDiffPatchesByPath,
  fileState = "applied",
  messageId,
  compactForRemoteControl = false,
  animationDelayMs = 0,
  onToggleFiles,
  onOpenCodeViewer,
}: MessageChangeSummaryPanelProps) {
  const { intl } = useCfIntl();
  const [isFileListOpen, setIsFileListOpen] = useState(false);

  const turnSummary = useMemo(() => {
    return buildTurnChangeSummary(changeDetails) ?? summary;
  }, [changeDetails, summary]);

  const filesChangedLabel = intl.formatMessage(
    {
      id:
        turnSummary.fileCount === 1
          ? "chat.changeSummary.filesChanged.one"
          : "chat.changeSummary.filesChanged.other",
    },
    { count: String(turnSummary.fileCount) },
  );

  const snapshotsByPath = useMemo(
    () => new Map((changeDetails?.snapshots ?? []).map((snapshot) => [snapshot.path, snapshot])),
    [changeDetails],
  );
  const isFileRewindApplied = fileState === "reverted";
  const toggleActionLabel = intl.formatMessage({
    id: isFileRewindApplied
      ? "chat.changeSummary.reverted"
      : "chat.changeSummary.rewind",
  });
  const panelToggleLabel = intl.formatMessage({
    id: isFileListOpen ? "chat.changeSummary.collapse" : "chat.changeSummary.expand",
  });
  const reviewDiffLabel = intl.formatMessage({ id: "chat.changeSummary.review" });
  const canRequestFileRewind = Boolean(onToggleFiles);

  return (
    <>
    <Collapsible
      open={isFileListOpen}
      onOpenChange={setIsFileListOpen}
      data-cf-stream-animate="true"
      className="overflow-hidden rounded-xl border border-border bg-card shadow-none"
      style={
        {
          "--cf-stream-animation-delay": `${animationDelayMs}ms`,
        } as CSSProperties
      }
    >
      {}
      <div className="flex h-10 items-center justify-between gap-3 px-2 transition-colors hover:bg-hover">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-label={panelToggleLabel}
            title={panelToggleLabel}
            className="flex h-full min-w-0 flex-1 items-center gap-2 px-1 text-left"
          >
            <ChevronRightIcon
              className={`size-3.5 shrink-0 text-foreground-subtlest transition-transform ${
                isFileListOpen ? "rotate-90" : ""
              }`}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate text-ui-base font-medium text-foreground">
              {filesChangedLabel}
            </span>
            <span className="shrink-0 tabular-nums text-ui-base">
              <span className="text-diff-added">+{turnSummary.added}</span>{" "}
              <span className="text-diff-removed">-{turnSummary.removed}</span>
            </span>
          </button>
        </CollapsibleTrigger>
        {canRequestFileRewind && turnSummary.fileCount > 0 && changeDetails ? (
          <div className="flex items-center gap-1.5 text-ui-base text-foreground-subtle">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid={
                messageId
                  ? testId(TID_CHAT_CHANGE_SUMMARY_TOGGLE_FILES_BUTTON, messageId)
                  : TID_CHAT_CHANGE_SUMMARY_TOGGLE_FILES_BUTTON
              }
              data-message-id={messageId}
              aria-label={toggleActionLabel}
              title={toggleActionLabel}
              disabled={isFileRewindApplied}
              onClick={() => onToggleFiles?.()}
              className="h-7 gap-1.5 px-2 text-ui-base text-foreground-subtle hover:text-foreground"
            >
              <span>{toggleActionLabel}</span>
              <Undo2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

      <CollapsibleContent>
        {}
        {turnSummary.files.map((file) => {
          const relativePath = toWorkspaceRelativePath(workspacePath, file.path);
          const snapshot = snapshotsByPath.get(file.path);
          const readonlyPatch = readonlyDiffPatchesByPath?.get(file.path);
          const diffViewerSource = buildChangeSummaryDiffViewerSource({
            patch: readonlyPatch,
            path: file.path,
            snapshot,
            relativePath,
            workspacePath,
            workspaceIdentity,
            workspaceRemoteSessionId,
          });
          const filePreviewSource = buildChangeSummaryFilePreviewSource({
            path: file.path,
            relativePath,
            workspacePath,
            workspaceIdentity,
            workspaceRemoteSessionId,
          });
          const canOpenDiff = Boolean(diffViewerSource && onOpenCodeViewer);
          const openDiffViewer = () => {
            openChangeSummaryDiffViewer(diffViewerSource, onOpenCodeViewer);
          };

          return (
            <div key={file.path} className="w-full bg-background/50 overflow-hidden">
              <div
                aria-disabled={!canOpenDiff}
                className={cn(
                  "flex w-full items-center gap-1 px-2 py-2 text-left transition-colors",
                  canOpenDiff ? "cursor-pointer hover:bg-hover/30" : "cursor-default",
                )}
                onClick={openDiffViewer}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  event.preventDefault();
                  openDiffViewer();
                }}
                role="button"
                tabIndex={canOpenDiff ? 0 : -1}
                title={file.path}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="min-w-0 flex items-center">
                    <FileDisplayInline
                      path={file.path}
                      options={{
                        basePath: workspacePath,
                        showFilePath: true,
                        className: "inline-flex min-w-0 max-w-full items-center gap-1.5",
                        fileNameClassName: "truncate text-ui-base font-medium text-foreground",
                        filePathClassName: "truncate text-ui-base text-foreground-subtlest",
                      }}
                    />
                  </div>
                  <span className="flex shrink-0 items-center gap-2 tabular-nums text-ui-base">
                    {file.added > 0 ? <span className="text-diff-added">+{file.added}</span> : null}
                    {file.removed > 0 ? (
                      <span className="text-diff-removed">-{file.removed}</span>
                    ) : null}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    aria-label={reviewDiffLabel}
                    title={reviewDiffLabel}
                    disabled={!canOpenDiff}
                    className="h-7 gap-1.5 rounded-lg bg-input px-2 text-ui-base"
                    onClick={(event) => {
                      event.stopPropagation();
                      openDiffViewer();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <span>{reviewDiffLabel}</span>
                  </Button>
                  <OpenSplitButton
                    target={{
                      type: "file",
                      path: file.path,
                      title: relativePath,
                      label: relativePath,
                      previewSource: filePreviewSource,
                    }}
                    onOpenCodeViewer={onOpenCodeViewer}
                    hideOpenWithMenu={compactForRemoteControl}
                    stopPropagation
                  />
                </div>
              </div>
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
    </>
  );
}
