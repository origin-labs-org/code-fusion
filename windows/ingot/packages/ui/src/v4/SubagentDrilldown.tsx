import { memo, useEffect, useMemo, useState } from "react";
import { TID_V4_SUBAGENT_DRILLDOWN, testId } from "@origin-ai/cf-shared/test-ids";
import type { ConversationRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import { ConversationRowView } from "@/v4/ConversationRowView.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";

export const SUBAGENT_DRILLDOWN_MAX_ROWS = 20;

export interface SubagentDrilldownProps {
  childSessionId: string;
  
  context: ConversationRowRenderContext;
}

function isSubagentOutputRow(row: ConversationRow): boolean {
  return row.kind === "assistantText";
}

export const SubagentDrilldown = memo(function SubagentDrilldown({
  childSessionId,
  context,
}: SubagentDrilldownProps) {
  const { intl } = useCfIntl();
  const { layer } = useV4Conversation();
  const [lease, setLease] = useState<SessionLease | null>(null);
  useEffect(() => {
    const nextLease = layer.acquire(childSessionId);
    setLease(nextLease);
    return () => nextLease.release();
  }, [layer, childSessionId]);
  const state = useConversationProjection(lease);

  const drilldownContext = useMemo<ConversationRowRenderContext>(
    () => ({ ...context, inSubagentDrilldown: true }),
    [context],
  );

  const sourceRows = state.snapshot?.rows.window ?? [];
  const rows = sourceRows.filter(isSubagentOutputRow);
  const visibleRows =
    rows.length > SUBAGENT_DRILLDOWN_MAX_ROWS
      ? rows.slice(-SUBAGENT_DRILLDOWN_MAX_ROWS)
      : rows;
  const hiddenCount = rows.length - visibleRows.length;
  const statusText =
    state.status === "connecting"
      ? intl.formatMessage({ id: "chat.toolCall.agent.output.syncing" })
      : state.status === "error"
        ? intl.formatMessage(
            { id: "chat.toolCall.agent.output.error" },
            { error: state.lastError ?? "" },
          )
        : hiddenCount > 0
          ? intl.formatMessage(
              { id: "chat.toolCall.agent.output.recentRows" },
              {
                visible: String(visibleRows.length),
                total: String(rows.length),
              },
            )
          : null;

  return (
    <section
      data-testid={testId(TID_V4_SUBAGENT_DRILLDOWN, childSessionId)}
      data-child-session-id={childSessionId}
      data-row-count={rows.length}
      data-source-row-count={sourceRows.length}
      className="space-y-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <h4 className="shrink-0 text-ui-base font-medium tracking-wide text-foreground-subtlest uppercase">
          {intl.formatMessage({ id: "chat.toolCall.agent.output" })}
        </h4>
        {statusText ? (
          <span className="min-w-0 truncate text-ui-sm text-foreground-subtle">
            {statusText}
          </span>
        ) : null}
      </div>
      {visibleRows.length === 0 ? (
        <div className="rounded-md bg-background-alt/40 px-3 py-2 text-ui-sm text-foreground-subtle">
          {state.status === "live"
            ? intl.formatMessage({ id: "chat.toolCall.agent.output.empty" })
            : null}
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto rounded-md bg-background-alt/40 py-1">
          {hiddenCount > 0 ? (
            <div className="px-3 py-1 text-center text-ui-sm text-foreground-subtle">
              {intl.formatMessage(
                { id: "chat.toolCall.agent.output.hiddenRows" },
                { count: String(hiddenCount) },
              )}
            </div>
          ) : null}
          {visibleRows.map((row) => (
            <ConversationRowView
              key={row.rowId}
              row={row}
              context={drilldownContext}
            />
          ))}
        </div>
      )}
    </section>
  );
});
