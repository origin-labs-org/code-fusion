import { ChevronRightIcon, Save } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CfPermissionRequest } from "@origin-ai/cf-shared";
import { CodeBlock } from "@/components/ai-elements/code-block.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import { cn } from "@/components/lib/utils.js";
import { formatWorkflowArgValue } from "@/ToolCallBlocks/renderers/createWorkflowInput.js";
import {
  readSaveWorkflowInput,
  SaveWorkflowOverwriteBadge,
  type WorkflowArgDeclaration,
} from "@/ToolCallBlocks/renderers/save-workflow.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";

const NO_VALUE_PLACEHOLDER = "—";
const ARGS_PREVIEW_ROWS = 8;
const DISCLOSURE_BUTTON_CLASS =
  "flex min-w-0 items-center gap-1 self-start rounded-md py-0.5 text-left text-ui-xs font-medium text-foreground-subtlest transition-colors hover:text-foreground-subtle";

function ClampedText({ text }: { text: string }) {
  const { intl } = useCfIntl();
  const textRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || expanded) return;
    const measure = () => setClipped(element.scrollHeight > element.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      <span
        ref={textRef}
        className={cn(
          "min-w-0 max-w-full whitespace-pre-wrap break-words text-ui-sm text-foreground-subtle",
          !expanded && "line-clamp-4",
        )}
      >
        {text}
      </span>
      {clipped ? (
        <button
          type="button"
          aria-expanded={expanded}
          className={DISCLOSURE_BUTTON_CLASS}
          data-workflow-save-clamp-toggle="true"
          onClick={() => setExpanded((value) => !value)}
        >
          {intl.formatMessage({
            id: expanded
              ? "chat.permission.workflow.save.showLess"
              : "chat.permission.workflow.save.showMore",
          })}
        </button>
      ) : null}
    </span>
  );
}

function MetadataRow({
  label,
  value,
  mono,
  clamp,
}: {
  label: string;
  value: string;
  mono?: boolean;
  clamp?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <span className="shrink-0 text-ui-sm text-foreground-subtlest">{label}</span>
      {clamp === true ? (
        <ClampedText text={value} />
      ) : (
        <span
          className={cn(
            "min-w-0 whitespace-pre-wrap break-words text-ui-sm text-foreground-subtle",
            mono === true && "font-mono [overflow-wrap:anywhere]",
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function WorkflowArgsTable({ args }: { args: readonly WorkflowArgDeclaration[] }) {
  const { intl } = useCfIntl();

  const headers = [
    intl.formatMessage({ id: "chat.permission.workflow.save.args.name" }),
    intl.formatMessage({ id: "chat.permission.workflow.save.args.type" }),
    intl.formatMessage({ id: "chat.permission.workflow.save.args.required" }),
    intl.formatMessage({ id: "chat.permission.workflow.save.args.default" }),
  ];
  const requiredLabel = intl.formatMessage({
    id: "chat.permission.workflow.save.args.requiredYes",
  });
  const optionalLabel = intl.formatMessage({
    id: "chat.permission.workflow.save.args.requiredNo",
  });

  return (
    <table
      className="w-full border-separate border-spacing-0 text-left"
      data-workflow-save-args="true"
    >
      <thead>
        <tr>
          {headers.map((header) => (
            <th
              key={header}
              scope="col"
              className="sticky top-0 border-b border-border bg-popover pb-1 pr-3 text-ui-xs font-medium text-foreground-subtlest [@media(min-height:36rem)]:-top-3"
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {args.map((arg) => (
          <Fragment key={arg.name}>
            <tr data-workflow-save-arg={arg.name}>
              <td className="pr-3 pt-1.5 align-top font-mono text-ui-sm text-foreground-subtle [overflow-wrap:anywhere]">
                {arg.name}
              </td>
              <td className="pr-3 pt-1.5 align-top font-mono text-ui-sm text-foreground-subtlest">
                {arg.type ?? NO_VALUE_PLACEHOLDER}
              </td>
              <td className="pr-3 pt-1.5 align-top text-ui-sm text-foreground-subtlest">
                {arg.required ? requiredLabel : optionalLabel}
              </td>
              <td className="pt-1.5 align-top font-mono text-ui-sm text-foreground-subtlest [overflow-wrap:anywhere]">
                {arg.hasDefault ? formatWorkflowArgValue(arg.defaultValue) : NO_VALUE_PLACEHOLDER}
              </td>
            </tr>
            {arg.description === undefined ? null : (
              <tr>
                <td
                  colSpan={headers.length}
                  className="whitespace-pre-wrap break-words pb-1 pt-0.5 text-ui-sm text-foreground-subtlest"
                >
                  {arg.description}
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export function SaveWorkflowPermissionBlock({ request }: { request: CfPermissionRequest }) {
  const { intl } = useCfIntl();

  const input = readSaveWorkflowInput(request.raw);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [allArgsShown, setAllArgsShown] = useState(false);

  useEffect(() => {
    setScriptOpen(false);
    setAllArgsShown(false);
  }, [request.requestId]);

  const title = intl.formatMessage({
    id: input.overwrite
      ? "chat.permission.workflow.save.overwriteTitle"
      : "chat.permission.workflow.save.title",
  });
  const fallbackName = intl.formatMessage({ id: "chat.toolCall.workflow.fallbackName" });
  const overwriteLabel = intl.formatMessage({ id: "chat.toolCall.workflow.save.overwrite" });
  const overwriteHint = intl.formatMessage({ id: "chat.permission.workflow.save.overwriteHint" });
  const scriptToggleLabel = intl.formatMessage({
    id: scriptOpen ? "chat.permission.workflow.hideScript" : "chat.permission.workflow.showScript",
  });

  return (
    <div className="space-y-3" data-save-workflow-permission-block="true">
      <p className="text-ui-base font-medium leading-5 text-foreground">{title}</p>

      <div className="flex min-w-0 items-center gap-2">
        <Save className="size-4 shrink-0 text-foreground-subtle" />
        <span className="min-w-0 truncate font-mono text-ui-base text-foreground-subtle">
          {input.name ?? fallbackName}
        </span>
        {input.overwrite ? <SaveWorkflowOverwriteBadge label={overwriteLabel} /> : null}
      </div>

      {input.overwrite ? (
        <p
          className="rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2 text-ui-sm text-foreground-subtle"
          data-workflow-overwrite-hint="true"
        >
          {overwriteHint}
        </p>
      ) : null}

      <div className="space-y-1.5 rounded-lg border border-border bg-surface px-2.5 py-2">
        {input.path === undefined ? null : (
          <MetadataRow
            label={intl.formatMessage({ id: "chat.permission.workflow.save.path" })}
            value={input.path}
            mono
          />
        )}
        {input.description === undefined ? null : (
          <MetadataRow
            key={`${request.requestId}:description`}
            label={intl.formatMessage({ id: "chat.permission.workflow.save.description" })}
            value={input.description}
            clamp
          />
        )}
        {input.whenToUse === undefined ? null : (
          <MetadataRow
            key={`${request.requestId}:whenToUse`}
            label={intl.formatMessage({ id: "chat.permission.workflow.save.whenToUse" })}
            value={input.whenToUse}
            clamp
          />
        )}
      </div>

      {input.args.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <p className="text-ui-sm font-medium text-foreground-subtle">
            {intl.formatMessage({ id: "chat.permission.workflow.save.args" })}
          </p>
          <WorkflowArgsTable
            args={allArgsShown ? input.args : input.args.slice(0, ARGS_PREVIEW_ROWS)}
          />
          {input.args.length > ARGS_PREVIEW_ROWS ? (
            <button
              type="button"
              aria-expanded={allArgsShown}
              className={DISCLOSURE_BUTTON_CLASS}
              data-workflow-save-args-toggle="true"
              onClick={() => setAllArgsShown((value) => !value)}
            >
              {allArgsShown
                ? intl.formatMessage({ id: "chat.permission.workflow.save.args.showFewer" })
                : intl.formatMessage(
                    { id: "chat.permission.workflow.save.args.showAll" },
                    { count: input.args.length },
                  )}
            </button>
          ) : null}
        </div>
      )}

      {input.script === undefined ? null : (
        <Collapsible open={scriptOpen} onOpenChange={setScriptOpen}>
          <CollapsibleTrigger className="flex min-w-0 items-center gap-1 rounded-md py-0.5 text-left text-ui-xs font-medium text-foreground-subtlest transition-colors hover:text-foreground-subtle">
            <ChevronRightIcon
              className={cn("size-3.5 shrink-0 transition-transform", scriptOpen && "rotate-90")}
            />
            <span className="min-w-0 truncate">{scriptToggleLabel}</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1.5">
            <CodeBlock
              code={input.script}
              language="typescript"
              renderMermaid={false}
              showLineNumbers
            />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
