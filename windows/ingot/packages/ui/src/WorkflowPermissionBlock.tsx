import { ChevronRightIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { CfPermissionRequest } from "@origin-ai/cf-shared";
import { CodeBlock } from "@/components/ai-elements/code-block.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import { cn } from "@/components/lib/utils.js";
import { buildWorkflowTimeline } from "@/components/workflow-timeline/timeline-model.js";
import { workflowPhasesDetail } from "@/components/workflow-timeline/timeline-summary.js";
import { WorkflowCardHeader } from "@/components/workflow-timeline/WorkflowCardChrome.js";
import { WorkflowTimeline } from "@/components/workflow-timeline/WorkflowTimeline.js";
import {
  formatWorkflowArgValue,
  isWorkflowAmendPredecessorLive,
  readWorkflowAdjustableSettings,
  readWorkflowAmendPredecessor,
  readWorkflowAmendScriptInherited,
  readWorkflowAmendTarget,
  readWorkflowMaxConcurrency,
  readWorkflowName,
  readWorkflowSaved,
  readWorkflowScript,
  readWorkflowSubagentModel,
  workflowScriptNamesModels,
  type WorkflowSavedSource,
} from "@/ToolCallBlocks/renderers/createWorkflowInput.js";
import {
  describeWorkflowSubagentModel,
  workflowSubagentModelText,
  workflowSubagentModelTooltip,
} from "@/components/workflow-timeline/subagent-model-label.js";
import { WorkflowAskSettings } from "@/components/workflow-timeline/WorkflowAskSettingsLines.js";
import { WorkflowAskPlainSettings } from "@/components/workflow-timeline/WorkflowAskSettingsParts.js";
import type { WorkflowAskSettingsContent } from "@/components/workflow-timeline/workflowAskSettings.js";
import { useWorkflowSubagentModelProviderName } from "@/hooks/useWorkflowSubagentModelProviderName.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { isAmendWorkflowToolCall, isFillWorkflowHoleToolCall } from "@/lib/workflowToolNames.js";
import { readWorkflowHoleTarget } from "@/ToolCallBlocks/renderers/createWorkflowHoleInput.js";
import { narrowTimelineToFill } from "@/components/workflow-timeline/timeline-holes.js";
import { WorkflowPermissionHoles } from "@/WorkflowPermissionHoles.js";

function WorkflowSavedSourceBadge({ saved }: { saved: WorkflowSavedSource }) {
  const { intl } = useCfIntl();

  const savedLabel = intl.formatMessage({ id: "chat.permission.workflow.saved.badge" });
  const scopeLabel =
    saved.scope === "project"
      ? intl.formatMessage({ id: "chat.permission.workflow.saved.scope.project" })
      : saved.scope;
  const argsLabel = intl.formatMessage({ id: "chat.permission.workflow.saved.args" });
  const argEntries = Object.entries(saved.args);

  return (
    <div
      className="space-y-1.5 rounded-lg border border-border bg-surface px-2.5 py-2"
      data-workflow-saved-source="true"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="shrink-0 text-ui-sm font-medium text-foreground-subtle">
          {scopeLabel === undefined ? savedLabel : `${savedLabel} · ${scopeLabel}`}
        </span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-ui-sm text-foreground-subtlest"
          data-workflow-saved-name="true"
          title={saved.path ?? saved.name}
        >
          {saved.name}
        </span>
      </div>

      {saved.path === undefined ? null : (
        <p
          className="min-w-0 truncate font-mono text-ui-xs text-foreground-subtlest"
          data-workflow-saved-path="true"
          title={saved.path}
        >
          {saved.path}
        </p>
      )}

      {argEntries.length === 0 ? null : (
        <dl
          className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 pt-0.5"
          data-workflow-saved-args="true"
          aria-label={argsLabel}
        >
          {argEntries.map(([key, value]) => (
            <Fragment key={key}>
              <dt className="font-mono text-ui-sm text-foreground-subtlest">{key}</dt>
              <dd className="min-w-0 break-words font-mono text-ui-sm text-foreground-subtle">
                {formatWorkflowArgValue(value)}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

export function WorkflowPermissionBlock({
  onSettingsBlockedChange,
  onSettingsChange,
  remoteSessionId,
  request,
  sessionModel,
  settingsDisabled = false,
  workspaceIdentity,
  workspacePath,
}: {
  
  onSettingsBlockedChange?: (blocked: boolean) => void;
  
  onSettingsChange?: (content: WorkflowAskSettingsContent | undefined) => void;
  remoteSessionId?: string;
  request: CfPermissionRequest;
  
  sessionModel?: { providerId: string; modelId: string };
  
  settingsDisabled?: boolean;
  workspaceIdentity?: string;
  
  workspacePath?: string;
}) {
  const { intl } = useCfIntl();

  const scriptText = readWorkflowScript(request.raw);
  const workflowName = readWorkflowName(request.raw);
  const saved = readWorkflowSaved(request.raw);
  const amend = isAmendWorkflowToolCall(request);
  const fill = isFillWorkflowHoleToolCall(request);
  const holeTarget = fill ? readWorkflowHoleTarget(request.raw) : undefined;
  const amendTarget = amend ? readWorkflowAmendTarget(request.raw) : undefined;
  const predecessor = amend ? readWorkflowAmendPredecessor(request.raw) : undefined;
  const scriptInherited = amend && readWorkflowAmendScriptInherited(request.raw);
  const maxConcurrency = readWorkflowMaxConcurrency(request.raw);
  const subagentModel = readWorkflowSubagentModel(request.raw);
  const adjustable = readWorkflowAdjustableSettings(request.raw);
  const hasModelScope = Boolean(workspacePath?.trim() || workspaceIdentity?.trim());
  const subagentModelProviderName = useWorkflowSubagentModelProviderName(workspacePath);
  const describedSubagentModel = useMemo(
    () =>
      subagentModel === undefined
        ? undefined
        : describeWorkflowSubagentModel(subagentModel, {
            formatMessage: intl.formatMessage.bind(intl),
            ...(subagentModelProviderName === undefined
              ? {}
              : { providerName: subagentModelProviderName }),
          }),
    [intl, subagentModel, subagentModelProviderName],
  );

  const display = request.display?.kind === "create_workflow" ? request.display : null;
  const causalityGraph =
    display?.causalityGraph !== undefined && display.causalityGraph.steps.length > 0
      ? display.causalityGraph
      : undefined;
  const hasGraph = causalityGraph !== undefined;
  const holeId = holeTarget?.holeId;
  const holeName = holeTarget?.name;
  const model = useMemo(() => {
    if (causalityGraph === undefined) return undefined;
    if (holeId === undefined) return buildWorkflowTimeline(causalityGraph, undefined);
    const labels = new Map(holeName === undefined ? [] : [[holeId, { name: holeName }]]);
    const whole = buildWorkflowTimeline(causalityGraph, undefined, labels);
    return narrowTimelineToFill(whole, holeId) ?? whole;
  }, [causalityGraph, holeId, holeName]);

  const [scriptOpen, setScriptOpen] = useState(!hasGraph);

  useEffect(() => {
    setScriptOpen(!hasGraph);
  }, [hasGraph, request.requestId]);

  const fallbackName = intl.formatMessage({ id: "chat.toolCall.workflow.fallbackName" });
  const title = intl.formatMessage({
    id: fill
      ? "chat.permission.workflow.hole.title"
      : amend
        ? "chat.permission.workflow.amend.title"
        : "chat.permission.workflow.title",
  });
  const amendsLabel = intl.formatMessage({ id: "chat.permission.workflow.amends" });
  const stillRunningLabel = intl.formatMessage({ id: "chat.permission.workflow.amends.running" });
  const scriptUnchangedLabel = intl.formatMessage({
    id: "chat.permission.workflow.amends.scriptUnchanged",
  });
  const scriptToggleLabel = intl.formatMessage({
    id: scriptOpen ? "chat.permission.workflow.hideScript" : "chat.permission.workflow.showScript",
  });
  const detail =
    model === undefined
      ? undefined
      : workflowPhasesDetail(intl.formatMessage.bind(intl), model, causalityGraph);

  return (
    <div className="space-y-3" data-workflow-permission-block="true">
      {}
      <WorkflowCardHeader
        detail={detail}
        expanded
        kind={title}
        name={fill ? (holeName ?? holeId ?? fallbackName) : (workflowName ?? fallbackName)}
      />

      {}
      <WorkflowPermissionHoles holes={causalityGraph?.holes} />

      {}
      {amendTarget === undefined ? null : (
        <div
          className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5"
          data-workflow-amends="true"
          {...(isWorkflowAmendPredecessorLive(predecessor)
            ? { "data-workflow-amends-live": "true" }
            : {})}
          {...(scriptInherited ? { "data-workflow-amends-script-inherited": "true" } : {})}
        >
          <span className="shrink-0 text-ui-xs text-foreground-subtlest">{amendsLabel}</span>
          <span
            className="min-w-0 truncate font-mono text-ui-xs text-foreground-subtlest"
            title={amendTarget}
          >
            {amendTarget}
          </span>
          {scriptInherited ? (
            <span className="shrink-0 text-ui-xs text-foreground-subtlest">
              · {scriptUnchangedLabel}
            </span>
          ) : null}
          {isWorkflowAmendPredecessorLive(predecessor) ? (
            <span className="shrink-0 text-ui-xs text-warning">· {stillRunningLabel}</span>
          ) : null}
        </div>
      )}

      {}
      {adjustable === undefined ? (
        <WorkflowAskPlainSettings
          maxConcurrency={maxConcurrency}
          scriptNamesModels={workflowScriptNamesModels(request.raw)}
          subagentModel={
            describedSubagentModel === undefined
              ? undefined
              : {
                  text: workflowSubagentModelText(
                    intl.formatMessage.bind(intl),
                    describedSubagentModel,
                  ),
                  tooltip: workflowSubagentModelTooltip(
                    intl.formatMessage.bind(intl),
                    describedSubagentModel,
                  ),
                }
          }
        />
      ) : (
        <WorkflowAskSettings
          key={request.requestId}
          adjustable={{
            ...adjustable,
            subagentModel: adjustable.subagentModel && hasModelScope,
          }}
          disabled={settingsDisabled}
          input={request.raw}
          scope={{
            workspacePath: workspacePath ?? "",
            ...(workspaceIdentity === undefined ? {} : { workspaceIdentity }),
            ...(remoteSessionId === undefined ? {} : { remoteSessionId }),
            ...(sessionModel === undefined ? {} : { sessionModel }),
          }}
          {...(onSettingsChange === undefined ? {} : { onContentChange: onSettingsChange })}
          {...(onSettingsBlockedChange === undefined
            ? {}
            : { onBlockedChange: onSettingsBlockedChange })}
        />
      )}

      {saved ? <WorkflowSavedSourceBadge saved={saved} /> : null}

      {model === undefined ? null : <WorkflowTimeline className="py-1" model={model} />}

      {scriptText ? (
        <Collapsible open={scriptOpen} onOpenChange={setScriptOpen}>
          <CollapsibleTrigger className="flex min-w-0 items-center gap-1 rounded-md py-0.5 text-left text-ui-xs font-medium text-foreground-subtlest transition-colors hover:text-foreground-subtle">
            <ChevronRightIcon
              className={cn("size-3.5 shrink-0 transition-transform", scriptOpen && "rotate-90")}
            />
            <span className="min-w-0 truncate">{scriptToggleLabel}</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1.5">
            {}
            <div className="max-h-72 overflow-auto" data-testid="workflow-script-scroll">
              <CodeBlock
                code={scriptText}
                language="typescript"
                renderMermaid={false}
                showLineNumbers
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
