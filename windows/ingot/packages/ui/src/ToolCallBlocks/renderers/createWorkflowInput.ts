

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readWorkflowKindMessageId(
  raw: unknown,
  isRunning: boolean,
  amend: WorkflowKindVocabulary = false,
  
  retuning = false,
): string {
  const ids = workflowKindIds(amend);
  if (!isRunning) {
    return ids.ran;
  }

  const v4Status = isPlainRecord(raw) ? raw.v4Status : undefined;
  if (v4Status === "pendingApproval") {
    return ids.awaitingConfirmation;
  }
  if (v4Status === "inputStreaming" || retuning) {
    return ids.writing;
  }

  return ids.running;
}

export function readWorkflowPrelaunchKindMessageId(
  phase: { compileErrors: boolean; failed: boolean; writing: boolean; revising: boolean },
  amend: WorkflowKindVocabulary,
): string {
  const ids = workflowKindIds(amend);
  if (phase.compileErrors) return ids.draft;
  if (phase.failed) return ids.ran;
  if (phase.writing) return phase.revising ? ids.revising : ids.writing;
  return ids.awaitingConfirmation;
}

interface WorkflowKindIds {
  writing: string;
  revising: string;
  awaitingConfirmation: string;
  running: string;
  ran: string;
  draft: string;
}

const CREATE_KIND_IDS: WorkflowKindIds = {
  writing: "chat.toolCall.workflow.writing",
  revising: "chat.toolCall.workflow.revising",
  awaitingConfirmation: "chat.toolCall.workflow.awaitingConfirmation",
  running: "chat.toolCall.workflow.running",
  ran: "chat.toolCall.workflow.ran",
  draft: "chat.toolCall.workflow.draft",
};

const AMEND_KIND_IDS: WorkflowKindIds = {
  writing: "chat.toolCall.workflow.amend.writing",
  revising: "chat.toolCall.workflow.amend.revising",
  awaitingConfirmation: "chat.toolCall.workflow.amend.awaitingConfirmation",
  running: "chat.toolCall.workflow.running",
  ran: "chat.toolCall.workflow.amend.ran",
  draft: "chat.toolCall.workflow.amend.draft",
};

const HOLE_KIND_IDS: WorkflowKindIds = {
  writing: "chat.toolCall.workflow.hole.writing",
  revising: "chat.toolCall.workflow.hole.revising",
  awaitingConfirmation: "chat.toolCall.workflow.hole.awaitingConfirmation",
  running: "chat.toolCall.workflow.running",
  ran: "chat.toolCall.workflow.hole.ran",
  draft: "chat.toolCall.workflow.hole.draft",
};

export type WorkflowKindVocabulary = boolean | "hole";

function workflowKindIds(vocabulary: WorkflowKindVocabulary): WorkflowKindIds {
  if (vocabulary === "hole") return HOLE_KIND_IDS;
  return vocabulary ? AMEND_KIND_IDS : CREATE_KIND_IDS;
}

export function readWorkflowName(input: unknown): string | undefined {
  if (isPlainRecord(input) && typeof input.name === "string") {
    const trimmed = input.name.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

export function readWorkflowScript(input: unknown): string | undefined {
  if (isPlainRecord(input) && typeof input.script === "string" && input.script.length > 0) {
    return input.script;
  }

  return undefined;
}

export function readWorkflowAmendTarget(input: unknown): string | undefined {
  return isPlainRecord(input) ? readTrimmedString(input.run_id) : undefined;
}

interface WorkflowAmendPredecessor {
  status: string | undefined;
  name: string | undefined;
}

export function readWorkflowAmendPredecessor(input: unknown): WorkflowAmendPredecessor | undefined {
  if (!isPlainRecord(input) || !isPlainRecord(input.predecessor)) {
    return undefined;
  }
  const predecessor = input.predecessor;
  return {
    status: readTrimmedString(predecessor.status),
    name: readTrimmedString(predecessor.name),
  };
}

export function readWorkflowMaxConcurrency(input: unknown): number | undefined {
  if (!isPlainRecord(input)) {
    return undefined;
  }
  const value = input.max_concurrency;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export interface WorkflowRetuneCall {
  runId: string;
  
  requested: number | null;
}

export function readWorkflowRetuneCall(input: unknown): WorkflowRetuneCall | undefined {
  if (!isPlainRecord(input)) return undefined;
  const runId = readWorkflowAmendTarget(input);
  if (runId === undefined) return undefined;
  const bound = input.max_concurrency;
  const requested = bound === null ? null : readWorkflowMaxConcurrency(input);
  if (requested === undefined) return undefined;
  if (readWorkflowScript(input) !== undefined || readTrimmedString(input.path) !== undefined) {
    return undefined;
  }
  if (input.subagent_model !== undefined || input.name !== undefined) return undefined;
  return { runId, requested };
}

export function readWorkflowSubagentModel(input: unknown): string | undefined {
  return isPlainRecord(input) ? readTrimmedString(input.subagent_model) : undefined;
}

export function workflowScriptNamesModels(input: unknown): boolean {
  return (
    isPlainRecord(input) &&
    isPlainRecord(input.model_bindings) &&
    Object.keys(input.model_bindings).length > 0
  );
}

export interface WorkflowAdjustableSettings {
  
  subagentModel: boolean;
  
  defaultConcurrency?: number;
}

export function readWorkflowAdjustableSettings(
  input: unknown,
): WorkflowAdjustableSettings | undefined {
  if (!isPlainRecord(input) || !isPlainRecord(input.adjustable_settings)) {
    return undefined;
  }
  const block = input.adjustable_settings;
  const defaultConcurrency = block.concurrency_ceiling;
  return {
    subagentModel: block.subagent_model === true,
    ...(typeof defaultConcurrency === "number" &&
    Number.isInteger(defaultConcurrency) &&
    defaultConcurrency > 0
      ? { defaultConcurrency }
      : {}),
  };
}

export function readWorkflowAmendScriptInherited(input: unknown): boolean {
  if (!isPlainRecord(input)) {
    return false;
  }
  if (isPlainRecord(input.predecessor) && input.predecessor.script_inherited === true) {
    return true;
  }
  return readWorkflowScript(input) === undefined && readTrimmedString(input.path) === undefined;
}

export function readWorkflowCardKeptScript(toolCall: {
  input: unknown;
  snapshotRefs?: readonly { field: string }[];
}): boolean {
  const trimmed = (toolCall.snapshotRefs ?? []).some((ref) => ref.field === "input");
  return !trimmed && readWorkflowAmendScriptInherited(toolCall.input);
}

export function isWorkflowAmendPredecessorLive(
  predecessor: WorkflowAmendPredecessor | undefined,
): boolean {
  return predecessor?.status === "running" || predecessor?.status === "pending";
}

export interface WorkflowSavedSource {
  name: string;
  path: string | undefined;
  scope: string | undefined;
  
  args: Record<string, unknown>;
}

export function readWorkflowSaved(input: unknown): WorkflowSavedSource | undefined {
  if (!isPlainRecord(input) || !isPlainRecord(input.saved)) {
    return undefined;
  }

  const saved = input.saved;
  const name = typeof saved.name === "string" ? saved.name.trim() : "";
  if (name.length === 0) {
    return undefined;
  }

  return {
    name,
    path: readTrimmedString(saved.path),
    scope: readTrimmedString(saved.scope),
    args: isPlainRecord(saved.args) ? saved.args : {},
  };
}

export function formatWorkflowArgValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
