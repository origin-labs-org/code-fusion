import type { KeyboardEvent, MouseEvent } from "react";
import { ARTIFACT_CHIP_MAX_VISIBLE } from "@/app-shell/workflow-artifacts/artifactPresentation.js";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { PILL_STAGGER_MS } from "./WorkflowTimeline.js";
import {
  WorkflowArtifactPill,
  type ArtifactPillData,
  type ArtifactPillSize,
} from "./WorkflowArtifactPill.js";

function hitsPill(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button") !== null;
}

export function WorkflowArtifactStrip({
  artifacts,
  className,
  moreTestId,
  onOpenArtifact,
  pillTestId,
  size = "md",
  testId,
  truncated = false,
  variant = "pill",
}: {
  variant?: "pill" | "link";
  artifacts: readonly ArtifactPillData[];
  size?: ArtifactPillSize;
  
  onOpenArtifact?: (artifactId: string) => void;
  
  truncated?: boolean;
  testId?: string;
  pillTestId?: string;
  moreTestId?: string;
  className?: string;
}) {
  const { intl } = useCfIntl();
  if (artifacts.length === 0) return null;
  const visible = artifacts.slice(0, ARTIFACT_CHIP_MAX_VISIBLE);
  const overflow = artifacts.length - visible.length;
  return (
    <span
      className={cn(
        "wf-motion flex min-w-0 shrink flex-wrap items-center",
        size === "md" ? "gap-1.5" : "gap-1",
        className,
      )}
      data-testid={testId}
      onClick={(event: MouseEvent<HTMLSpanElement>) => {
        if (hitsPill(event.target)) event.stopPropagation();
      }}
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (hitsPill(event.target)) event.stopPropagation();
      }}
    >
      {visible.map((artifact, i) => (
        <WorkflowArtifactPill
          artifact={artifact}
          variant={variant}
          enterDelayMs={PILL_STAGGER_MS * i}
          key={artifact.id}
          size={size}
          truncateTitle
          {...(pillTestId === undefined ? {} : { testId: pillTestId })}
          {...(onOpenArtifact === undefined ? {} : { onOpen: onOpenArtifact })}
        />
      ))}
      {overflow > 0 || truncated ? (
        <span
          className="shrink-0 px-0.5 font-mono text-ui-xs tabular-nums text-foreground-subtlest"
          data-testid={moreTestId}
        >
          {intl.formatMessage(
            { id: "chat.backgroundResult.workflow.artifacts.more" },
            { count: truncated && overflow === 0 ? "…" : String(overflow) },
          )}
        </span>
      ) : null}
    </span>
  );
}
