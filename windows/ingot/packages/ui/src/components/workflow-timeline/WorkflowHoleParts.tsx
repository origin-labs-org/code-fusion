import { PenIcon } from "lucide-react";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { TimelineHole } from "./timeline-holes.js";

export function HoleFillMark({ className, holeId }: { className?: string; holeId: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded-sm bg-tag px-1 text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground",
        className,
      )}
      data-fill-head={holeId}
      data-testid="workflow-hole-fill-mark"
    >
      <PenIcon aria-hidden className="size-2.5" />
    </span>
  );
}

export function HoleWaitingMeta({ hole }: { hole: TimelineHole | undefined }) {
  const { intl } = useCfIntl();
  if (hole?.state !== "waiting") return null;
  return (
    <span
      className="shrink-0 whitespace-nowrap text-ui-xs text-warning"
      data-testid="workflow-hole-waiting"
    >
      {intl.formatMessage({ id: "chat.toolCall.workflow.hole.waiting" })}
    </span>
  );
}

export function RunHolesWaitingChip({
  run,
  testId,
}: {
  run: Pick<WorkflowRunState, "holes"> | undefined;
  testId: string;
}) {
  const count = (run?.holes ?? []).filter((hole) => hole.state === "waiting").length;
  return <HolesWaitingChip count={count} testId={testId} />;
}

export function HolesWaitingChip({
  count,
  onOpen,
  testId = "workflow-digest-holes",
}: {
  count: number;
  onOpen?: () => void;
  testId?: string;
}) {
  const { intl } = useCfIntl();
  if (count <= 0) return null;
  const label = intl.formatMessage(
    {
      id:
        count === 1 ? "chat.toolCall.workflow.digest.hole" : "chat.toolCall.workflow.digest.holes",
    },
    { count },
  );
  const face =
    "wf-arrive flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)] py-0.5 pl-1.5 pr-2 text-ui-xs font-medium text-warning";
  return onOpen === undefined ? (
    <span className={face} data-testid={testId}>
      <PenIcon aria-hidden className="size-3" />
      {label}
    </span>
  ) : (
    <button
      className={cn(
        face,
        "cursor-pointer outline-none transition-colors hover:bg-[color-mix(in_oklab,var(--color-warning)_20%,transparent)] focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
      data-testid={testId}
      onClick={onOpen}
      type="button"
    >
      <PenIcon aria-hidden className="size-3" />
      {label}
    </button>
  );
}
