import { useCfIntl } from "@/i18n/IntlProvider.js";

export function WorkflowCardMetaLine({
  marker,
  label,
  value,
  title,
  note,
  flag,
}: {
  marker: string;
  label: string;
  value: string;
  title?: string;
  note?: string;
  flag?: string;
}) {
  return (
    <p
      className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-ui-sm"
      {...{ [`data-workflow-card-${marker}`]: "true" }}
      {...(flag === undefined ? {} : { [`data-workflow-card-${marker}-${flag}`]: "true" })}
    >
      <span className="shrink-0 text-foreground-subtlest">{label}</span>
      <span className="min-w-0 truncate font-mono text-foreground-subtle" title={title ?? value}>
        {value}
      </span>
      {note === undefined ? null : (
        <span className="shrink-0 text-foreground-subtlest">· {note}</span>
      )}
    </p>
  );
}

export function WorkflowAmendsLine({
  runId,
  scriptInherited = false,
}: {
  runId: string;
  scriptInherited?: boolean;
}) {
  const { intl } = useCfIntl();
  return (
    <WorkflowCardMetaLine
      marker="amends"
      label={intl.formatMessage({ id: "chat.toolCall.workflow.amend.amends" })}
      value={runId}
      {...(scriptInherited
        ? {
            note: intl.formatMessage({ id: "chat.toolCall.workflow.amend.scriptUnchanged" }),
            flag: "script-inherited",
          }
        : {})}
    />
  );
}
