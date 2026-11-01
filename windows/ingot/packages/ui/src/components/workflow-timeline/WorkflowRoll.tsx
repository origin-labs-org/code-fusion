import { Fragment, type ReactNode } from "react";
import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import type { StepRunStatus } from "@/components/workflow-graph/types.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { RollGroup } from "./roster-model.js";
import type { TimelinePill } from "./timeline-model.js";

export const ROW_STAGGER_MS = 8;
export const ROW_STAGGER_CAP_MS = 400;

const GROUP_TONE: Record<StepRunStatus, string> = {
  done: "text-success",
  failed: "text-destructive",
  pending: "text-foreground-subtlest",
  running: "text-warning",
};

function GroupIcon({ status }: { status: StepRunStatus }) {
  if (status === "done") return <CircleCheckIcon aria-hidden className="size-2.5" />;
  if (status === "running") {
    return (
      <LoaderCircleIcon aria-hidden className="size-2.5 animate-spin motion-reduce:animate-none" />
    );
  }
  if (status === "failed") return <CircleXIcon aria-hidden className="size-2.5" />;
  return <span aria-hidden className="size-2 rounded-full border-[1.5px] border-current" />;
}

export function WorkflowRoll({
  groups,
  renderRow,
  unlisted = 0,
}: {
  groups: readonly RollGroup[];
  
  renderRow: (pill: TimelinePill, enterDelayMs: number) => ReactNode;
  
  unlisted?: number;
}) {
  const { intl } = useCfIntl();
  let index = 0;
  return (
    <div className="wf-unfold grid grid-cols-2 gap-x-2 pt-0.5" data-testid="workflow-roster-roll">
      {groups.map((group) => {
        const label = intl.formatMessage(
          { id: `chat.toolCall.workflow.timeline.roster.${group.status}` },
          { count: group.pills.length },
        );
        const split = /^(\d+)(.*)$/.exec(label);
        return (
          <Fragment key={group.status}>
            <div
              aria-level={4}
              className={cn(
                "col-span-2 mt-1 flex h-[22px] items-center gap-[5px] pl-1 font-mono text-ui-xs leading-none tabular-nums first:mt-0",
                GROUP_TONE[group.status],
              )}
              data-roll-group={group.status}
              data-testid="workflow-roll-heading"
              role="heading"
            >
              <GroupIcon status={group.status} />
              {split === null ? (
                <span>{label}</span>
              ) : (
                <>
                  <span className="font-medium">{split[1]}</span>
                  <span>{split[2]!.trim()}</span>
                </>
              )}
              <span aria-hidden className="ml-[3px] h-px flex-1 bg-border" />
            </div>
            {group.pills.map((pill) =>
              renderRow(pill, Math.min(ROW_STAGGER_MS * index++, ROW_STAGGER_CAP_MS)),
            )}
          </Fragment>
        );
      })}
      {unlisted <= 0 ? null : (
        <p
          className="col-span-2 mt-1.5 min-w-0 text-ui-xs text-foreground-subtlest"
          data-testid="workflow-roll-unlisted"
        >
          {intl.formatMessage(
            {
              id:
                unlisted === 1
                  ? "chat.toolCall.workflow.timeline.roster.unlisted.one"
                  : "chat.toolCall.workflow.timeline.roster.unlisted.many",
            },
            { count: unlisted },
          )}
        </p>
      )}
    </div>
  );
}
