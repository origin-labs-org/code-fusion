import type { CSSProperties, ReactNode } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import type { WorkflowRunArtifactKind } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  ArtifactKindIcon,
  artifactDisplayTitle,
  artifactKindMessageId,
  truncateArtifactChipTitle,
} from "@/app-shell/workflow-artifacts/artifactPresentation.js";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";

export interface ArtifactPillData {
  id: string;
  kind: WorkflowRunArtifactKind;
  title?: string;
  version?: number;
}

export type ArtifactPillSize = "md" | "sm";

export function WorkflowArtifactPill({
  artifact,
  className,
  detail,
  enterDelayMs,
  fill = false,
  onOpen,
  size = "md",
  testId = "workflow-artifact-pill",
  title,
  truncateTitle = false,
  variant = "pill",
}: {
  variant?: "pill" | "link";
  artifact: ArtifactPillData;
  size?: ArtifactPillSize;
  
  detail?: ReactNode;
  
  onOpen?: (artifactId: string) => void;
  
  fill?: boolean;
  
  truncateTitle?: boolean;
  
  title?: string;
  
  enterDelayMs?: number;
  testId?: string;
  className?: string;
}) {
  const { intl } = useCfIntl();
  const fullTitle = artifactDisplayTitle(artifact);
  const label = truncateTitle ? truncateArtifactChipTitle(fullTitle) : fullTitle;
  const kindLabel = intl.formatMessage({ id: artifactKindMessageId(artifact.kind) });
  const openable = onOpen !== undefined;
  const version = artifact.version ?? 1;
  const showVersion = version >= 2;
  const versionLabel = intl.formatMessage(
    { id: "chat.toolCall.workflow.run.artifacts.version" },
    { version: String(version) },
  );
  const md = size === "md";
  const style: CSSProperties | undefined =
    enterDelayMs === undefined || enterDelayMs <= 0
      ? undefined
      : { animationDelay: `${enterDelayMs}ms`, animationFillMode: "backwards" };

  if (variant === "link")
    return (
      <button
        type="button"
        disabled={!openable}
        onClick={openable ? () => onOpen(artifact.id) : undefined}
        data-testid={testId}
        data-artifact-id={artifact.id}
        data-artifact-kind={artifact.kind}
        data-artifact-version={String(version)}
        title={title ?? `${kindLabel} · ${fullTitle}`}
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-ui-base font-normal text-foreground-subtle enabled:cursor-pointer enabled:hover:underline"
      >
        <ArtifactKindIcon className="size-4 shrink-0" kind={artifact.kind} />
        <span className="min-w-0 truncate">{label}</span>
        {showVersion ? (
          <span data-testid="workflow-run-artifact-version">{versionLabel}</span>
        ) : null}
      </button>
    );
  return (
    <button
      aria-label={
        openable
          ? `${intl.formatMessage({ id: "chat.toolCall.workflow.run.artifacts.open" })}: ${fullTitle}`
          : undefined
      }
      className={cn(
        "wf-pill wf-arrive flex min-w-0 max-w-full items-center bg-surface text-left",
        md
          ? "h-8 gap-2 rounded-[9px] pl-2 pr-2.5 text-ui-sm"
          : "h-6 gap-1.5 rounded-md pl-1.5 pr-2 text-ui-xs",
        openable
          ? "wf-pill-open cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          : "cursor-default",
        fill && "w-full",
        className,
      )}
      data-artifact-id={artifact.id}
      data-artifact-kind={artifact.kind}
      data-artifact-open={openable ? "true" : undefined}
      data-artifact-version={String(version)}
      data-pill-size={size}
      data-testid={testId}
      disabled={!openable}
      onClick={openable ? () => onOpen(artifact.id) : undefined}
      style={style}
      title={title ?? `${kindLabel} · ${fullTitle}`}
      type="button"
    >
      <ArtifactKindIcon className="size-4 shrink-0 text-foreground-subtle" kind={artifact.kind} />
      <span className={cn("wf-pill-name min-w-0 truncate text-foreground", fill && "flex-1")}>
        {label}
      </span>
      {detail === undefined || detail === null ? null : (
        <span className="flex shrink-0 items-center gap-1 font-mono text-ui-xs tabular-nums text-foreground-subtlest">
          {detail}
        </span>
      )}
      {showVersion || openable ? (
        <span
          className={cn(
            "wf-pill-tail grid shrink-0 place-items-center [&>*]:col-start-1 [&>*]:row-start-1",
            md ? "size-3.5" : "size-3",
          )}
          data-testid="workflow-pill-tail"
        >
          {showVersion ? (
            <span
              className="wf-mark font-mono text-ui-xs leading-none tabular-nums text-foreground-subtlest"
              data-testid="workflow-run-artifact-version"
              key={version}
              title={versionLabel}
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
              data-testid="workflow-artifact-pill-open"
            >
              <ArrowUpRightIcon className={md ? "size-3.5" : "size-3"} />
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
