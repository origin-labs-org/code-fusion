

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolToken(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/gu, "") : "";
}

interface WorkflowToolNameSource {
  toolName?: string | null;
  kind?: string | null;
  title?: string | null;
  raw?: unknown;
}

function matchesToolName(source: WorkflowToolNameSource, token: string): boolean {
  const rawNames = isPlainRecord(source.raw)
    ? [source.raw.toolName, source.raw.tool_name, source.raw.name]
    : [];
  return [source.toolName, source.kind, source.title, ...rawNames].some(
    (value) => normalizeToolToken(value) === token,
  );
}

export function isSaveWorkflowToolCall(source: WorkflowToolNameSource): boolean {
  return matchesToolName(source, "saveworkflow");
}

export function isListSavedWorkflowsToolCall(source: WorkflowToolNameSource): boolean {
  return matchesToolName(source, "listsavedworkflows");
}

export function isEscalateToolCall(source: WorkflowToolNameSource): boolean {
  return matchesToolName(source, "escalate");
}

export function isResolveWorkflowQuestionToolCall(source: WorkflowToolNameSource): boolean {
  return matchesToolName(source, "resolveworkflowquestion");
}

export function isGetWorkflowRunToolCall(source: WorkflowToolNameSource): boolean {
  return matchesToolName(source, "getworkflowrun");
}

export function isListWorkflowRunsToolCall(source: WorkflowToolNameSource): boolean {
  return matchesToolName(source, "listworkflowruns");
}

export function isEvalWorkflowSnippetToolCall(source: WorkflowToolNameSource): boolean {
  return matchesToolName(source, "evalworkflowsnippet");
}

export function isResumeWorkflowRunToolCall(source: WorkflowToolNameSource): boolean {
  return matchesToolName(source, "resumeworkflowrun");
}

export function isListModelsToolCall(source: WorkflowToolNameSource): boolean {
  return matchesToolName(source, "listmodels");
}

export function isCreateWorkflowToolCall(source: WorkflowToolNameSource): boolean {
  return matchesToolName(source, "createworkflow");
}

export function isAmendWorkflowToolCall(source: WorkflowToolNameSource): boolean {
  return matchesToolName(source, "amendworkflow");
}

export function isFillWorkflowHoleToolCall(source: WorkflowToolNameSource): boolean {
  return matchesToolName(source, "fillworkflowhole");
}
