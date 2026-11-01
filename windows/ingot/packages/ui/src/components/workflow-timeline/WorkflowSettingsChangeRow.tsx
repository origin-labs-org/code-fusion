// ============================================================
// ============================================================

import { Fragment } from "react";
import { SlidersHorizontalIcon } from "lucide-react";
import type { WorkflowSettingsAmendMeta } from "@origin-ai/cf-shared/cf-protocol-v4";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { workflowSettingsChangeSegments } from "./workflowSettingsChange.js";

export function WorkflowSettingsChangeRow({
  amend,
  at,
  providerName,
}: {
  amend: WorkflowSettingsAmendMeta;
  
  at?: number;
  
  providerName?: (providerId: string) => string | undefined;
}) {
  const { intl } = useCfIntl();
  const segments = workflowSettingsChangeSegments(amend, {
    formatMessage: intl.formatMessage.bind(intl),
    ...(providerName === undefined ? {} : { providerName }),
  });
  const time =
    at === undefined
      ? undefined
      : new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(at);
  const parts = [
    intl.formatMessage({ id: "chat.toolCall.workflow.settingsChange.kind" }),
    ...segments,
    ...(time === undefined ? [] : [time]),
  ];
  return (
    <div
      className="flex min-w-0 items-center gap-2 py-0.5 text-ui-base text-foreground-subtle"
      data-testid="workflow-settings-change-row"
    >
      <SlidersHorizontalIcon aria-hidden className="size-4 shrink-0" />
      <span className="flex min-w-0 flex-wrap items-center gap-x-2">
        {parts.map((part, index) => (
          <Fragment key={index}>
            {index > 0 ? (
              <span aria-hidden className="text-foreground-subtlest">
                ·
              </span>
            ) : null}
            <span
              className={
                index === 0
                  ? "font-medium"
                  : index === parts.length - 1 && time !== undefined
                    ? "text-foreground-subtlest tabular-nums"
                    : undefined
              }
            >
              {part}
            </span>
          </Fragment>
        ))}
      </span>
    </div>
  );
}
