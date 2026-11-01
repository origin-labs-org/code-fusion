import { PenIcon } from "lucide-react";
import type { ToolCallCreateWorkflowCausalityGraph } from "@origin-ai/cf-shared/cf-protocol-v4";
import { useCfIntl } from "@/i18n/IntlProvider.js";

export function WorkflowPermissionHoles({
  holes,
}: {
  holes: NonNullable<ToolCallCreateWorkflowCausalityGraph["holes"]> | undefined;
}) {
  const { intl } = useCfIntl();
  if (holes === undefined || holes.length === 0) return null;
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
      data-testid="workflow-permission-holes"
    >
      <span className="shrink-0 text-ui-sm text-foreground-subtlest">
        {intl.formatMessage({ id: "chat.permission.workflow.holes.label" })}
      </span>
      {holes.map((hole) => (
        <span
          className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-ui-sm text-foreground"
          data-hole-id={hole.siteId}
          data-testid="workflow-permission-hole"
          key={hole.siteId}
          title={hole.name}
        >
          <PenIcon aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
          <span className="min-w-0 truncate">{hole.name}</span>
        </span>
      ))}
      <span className="text-ui-sm text-foreground-subtlest">
        {intl.formatMessage({ id: "chat.permission.workflow.holes.note" })}
      </span>
    </div>
  );
}
