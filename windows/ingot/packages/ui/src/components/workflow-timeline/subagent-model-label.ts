import { thoughtLevelLabelId } from "@/chat-input-toolbar/thoughtLevelLabels.js";
import { parseModelPickerValue } from "@/lib/cfSessionProjection.js";
import { formatProviderModelLabel } from "@/v4/composer/modelTriggerDisplay.js";

type FormatMessage = (
  descriptor: { id: string },
  values?: Record<string, string | number>,
) => string;

export interface WorkflowSubagentModelLabel {
  
  name: string;
  
  level?: string;
  
  canonical: string;
}

export interface WorkflowSubagentModelDeps {
  formatMessage: FormatMessage;
  
  providerName?: (providerId: string) => string | undefined;
}

function fallbackName(canonical: string): string {
  const separatorIndex = canonical.indexOf("/");
  const rest = separatorIndex > 0 ? canonical.slice(separatorIndex + 1) : canonical;
  const levelIndex = rest.indexOf("$");
  const name = levelIndex > 0 ? rest.slice(0, levelIndex) : rest;
  return name.length > 0 ? name : canonical;
}

export function describeWorkflowSubagentModel(
  canonical: string,
  deps: WorkflowSubagentModelDeps,
): WorkflowSubagentModelLabel {
  const trimmed = canonical.trim();
  let parsed: ReturnType<typeof parseModelPickerValue> | undefined;
  try {
    parsed = parseModelPickerValue(trimmed);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined) {
    return { canonical: trimmed, name: fallbackName(trimmed) };
  }

  const resolvedName = deps.providerName?.(parsed.providerId)?.trim();
  const providerName =
    resolvedName === undefined || resolvedName === parsed.providerId ? undefined : resolvedName;
  const name = formatProviderModelLabel(parsed.providerId, providerName, parsed.modelId);

  const rawLevel = parsed.options?.reasoningLevel;
  if (rawLevel === undefined) {
    return { canonical: trimmed, name };
  }
  const labelId = thoughtLevelLabelId(rawLevel);
  return {
    canonical: trimmed,
    level: labelId === undefined ? rawLevel : deps.formatMessage({ id: labelId }),
    name,
  };
}

export function workflowSubagentModelText(
  formatMessage: FormatMessage,
  label: WorkflowSubagentModelLabel,
): string {
  return label.level === undefined
    ? label.name
    : formatMessage(
        { id: "chat.toolCall.workflow.subagentModel.withLevel" },
        { level: label.level, model: label.name },
      );
}

export function workflowSubagentModelTooltip(
  formatMessage: FormatMessage,
  label: WorkflowSubagentModelLabel,
): string {
  const explained = formatMessage(
    { id: "chat.toolCall.workflow.subagentModel.tooltip" },
    { model: workflowSubagentModelText(formatMessage, label) },
  );
  return `${explained}\n${label.canonical}`;
}

export function workflowSubagentModelCardLabel(
  canonical: string | undefined,
  deps: WorkflowSubagentModelDeps,
): { name: string; title: string } | undefined {
  if (canonical === undefined) {
    return undefined;
  }
  const label = describeWorkflowSubagentModel(canonical, deps);
  return { name: label.name, title: workflowSubagentModelTooltip(deps.formatMessage, label) };
}

export function workflowActorModelLabels(
  actors: readonly { siteId: string; ordinal: number; model?: string }[] | undefined,
  deps: WorkflowSubagentModelDeps,
): ReadonlyMap<string, { name: string; canonical: string }> {
  const labels = new Map<string, { name: string; canonical: string }>();
  for (const actor of actors ?? []) {
    if (actor.model === undefined) continue;
    const label = describeWorkflowSubagentModel(actor.model, deps);
    labels.set(`${actor.siteId}@${actor.ordinal}`, {
      name: label.name,
      canonical: label.canonical,
    });
  }
  return labels;
}
