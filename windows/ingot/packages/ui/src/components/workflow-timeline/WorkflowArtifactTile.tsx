import type { CSSProperties, ReactNode } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import {
  ArtifactKindIcon,
  artifactDisplayTitle,
  artifactKindMessageId,
} from "@/app-shell/workflow-artifacts/artifactPresentation.js";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { ArtifactPillData } from "./WorkflowArtifactPill.js";

export interface WorkflowCompletionArtifact extends ArtifactPillData {
  contentType?: string;
  bytes?: number;
  sourcePath?: string;
  
  itemCount?: number;
  
  spec?: unknown;
  
  description?: string;
  
  primary?: true;
}

export function ArtifactSheetGlyph({ badge }: { badge?: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center" data-testid="workflow-artifact-sheet">
      <div className="flex aspect-[3/4] w-[38%] max-w-[72px] flex-col gap-1.5 rounded-[4px] border border-border bg-card p-2.5 shadow-[0_1px_0_var(--color-workflow-rule)]">
        <i className="block h-[5px] w-[55%] rounded-sm bg-surface-hover" />
        <i className="block h-[3px] rounded-sm bg-surface-hover" />
        <i className="block h-[3px] rounded-sm bg-surface-hover" />
        <i className="block h-[3px] w-[70%] rounded-sm bg-surface-hover" />
      </div>
      {badge === undefined ? null : (
        <span
          className="absolute bottom-2 right-2 rounded-[4px] bg-surface-hover px-1.5 py-0.5 font-mono text-ui-xs text-foreground-subtle"
          data-testid="workflow-artifact-sheet-badge"
        >
          {badge}
        </span>
      )}
    </div>
  );
}

export function WorkflowArtifactTile({
  artifact,
  detail,
  enterDelayMs,
  onOpen,
  preview,
  testId = "workflow-artifact-tile",
  title: tooltip,
}: {
  artifact: WorkflowCompletionArtifact;
  
  preview?: ReactNode;
  
  detail?: ReactNode;
  onOpen?: (artifactId: string) => void;
  enterDelayMs?: number;
  testId?: string;
  
  title?: string;
}) {
  const { intl } = useCfIntl();
  const title = artifactDisplayTitle(artifact);
  const kindLabel = intl.formatMessage({ id: artifactKindMessageId(artifact.kind) });
  const openable = onOpen !== undefined;
  const version = artifact.version ?? 1;
  const showVersion = version >= 2;
  const style: CSSProperties | undefined =
    enterDelayMs === undefined || enterDelayMs <= 0
      ? undefined
      : { animationDelay: `${enterDelayMs}ms`, animationFillMode: "backwards" };

  return (
    <div className="wf-tile relative flex min-w-0 flex-col gap-1.5" data-variant="tile">
      {}
      <div
        aria-hidden
        className="wf-tile-frame wf-arrive relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-border bg-panel"
        data-testid="workflow-artifact-tile-frame"
        inert
        style={style}
      >
        {preview ?? <ArtifactSheetGlyph />}
      </div>
      <button
        aria-label={
          openable
            ? `${intl.formatMessage({ id: "chat.toolCall.workflow.run.artifacts.open" })}: ${title}`
            : undefined
        }
        className={cn(
          "wf-tile-hit wf-arrive flex min-w-0 items-center gap-1.5 rounded-lg bg-transparent p-0 px-0.5 text-left text-ui-sm outline-none",
          openable ? "wf-tile-open cursor-pointer" : "cursor-default",
        )}
        data-artifact-id={artifact.id}
        data-artifact-kind={artifact.kind}
        data-artifact-open={openable ? "true" : undefined}
        data-artifact-version={String(version)}
        data-testid={testId}
        data-variant="tile"
        disabled={!openable}
        onClick={openable ? () => onOpen(artifact.id) : undefined}
        style={style}
        title={tooltip ?? `${kindLabel} · ${title}`}
        type="button"
      >
        <ArtifactKindIcon className="size-4 shrink-0 text-foreground-subtle" kind={artifact.kind} />
        <span className="wf-pill-name min-w-0 flex-1 truncate text-foreground">{title}</span>
        {detail === undefined || detail === null ? null : (
          <span
            className="flex shrink-0 items-center gap-1 font-mono text-ui-xs tabular-nums text-foreground-subtlest"
            data-testid="workflow-artifact-tile-detail"
          >
            {detail}
          </span>
        )}
        {showVersion || openable ? (
          <span className="grid size-3 shrink-0 place-items-center [&>*]:col-start-1 [&>*]:row-start-1">
            {showVersion ? (
              <span
                className="wf-mark font-mono text-ui-xs leading-none tabular-nums text-foreground-subtlest"
                data-testid="workflow-artifact-tile-version"
                key={version}
                title={intl.formatMessage(
                  { id: "chat.toolCall.workflow.run.artifacts.version" },
                  { version: String(version) },
                )}
              >
                {intl.formatMessage(
                  { id: "chat.toolCall.workflow.run.artifacts.versionTail" },
                  { version: String(version) },
                )}
              </span>
            ) : null}
            {openable ? (
              <span
                aria-hidden
                className="wf-pill-go flex items-center justify-center text-foreground-subtlest"
                data-testid="workflow-artifact-tile-open"
              >
                <ArrowUpRightIcon className="size-3" />
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
    </div>
  );
}
