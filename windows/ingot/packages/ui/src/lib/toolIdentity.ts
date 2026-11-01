import {
  getCfToolFamilyForName,
  isTodoPlanToolName,
  isCfFileContentWriteToolName,
  normalizeCfToolName,
  type CfKnownToolName,
  type CfToolFamily,
} from "@origin-ai/cf-shared";
import { normalizeAskUserQuestionInput, readAskUserQuestionInput } from "@/lib/askUserQuestion.js";

export type ToolCallPresentationFamily =
  | CfToolFamily
  | "plan-guidance"
  | "switch-mode"
  | "explore"
  | "unknown";

export type ToolCallIdentitySource =
  | "toolName"
  | "kind"
  | "title"
  | "raw"
  | "raw-cf-meta"
  | "raw-claude-meta"
  | "legacy-kind"
  | "legacy-title"
  | "legacy-payload"
  | "unknown";

export interface ToolCallIdentity {
  toolName: CfKnownToolName | string | null;
  family: ToolCallPresentationFamily;
  source: ToolCallIdentitySource;
  isLegacy: boolean;
}

interface ToolIdentityLike {
  toolName?: string | null;
  kind?: string | null;
  title?: string | null;
  input?: unknown;
  raw?: unknown;
}

const UNKNOWN_TOOL_IDENTITY: ToolCallIdentity = {
  toolName: null,
  family: "unknown",
  source: "unknown",
  isLegacy: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNestedString(value: unknown, path: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return readString(current);
}

function normalizeLegacyToken(value: string | null | undefined): string {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_") ?? ""
  );
}

function identityFromKnownToolName(
  value: string | null | undefined,
  source: ToolCallIdentitySource,
): ToolCallIdentity | null {
  if (["fetch", "web_fetch"].includes(normalizeLegacyToken(value))) {
    return identityFromLegacyFamily(value?.trim() ?? "WebFetch", "web-fetch", source);
  }
  const toolName = normalizeCfToolName(value);
  if (!toolName) {
    return null;
  }
  const family = getCfToolFamilyForName(toolName);
  if (!family) {
    return null;
  }
  return {
    toolName,
    family,
    source,
    isLegacy: false,
  };
}

function identityFromLegacyFamily(
  toolName: string | null,
  family: ToolCallPresentationFamily,
  source: ToolCallIdentitySource,
): ToolCallIdentity {
  return {
    toolName,
    family,
    source,
    isLegacy: true,
  };
}

function readRawToolNameCandidates(raw: unknown) {
  return {
    direct:
      readNestedString(raw, ["toolName"]) ??
      readNestedString(raw, ["tool_name"]) ??
      readNestedString(raw, ["name"]),
    cf: readNestedString(raw, ["_meta", "cf", "toolName"]),
    claudeCode: readNestedString(raw, ["_meta", "claudeCode", "toolName"]),
    rawKind: readNestedString(raw, ["kind"]),
    rawTitle: readNestedString(raw, ["title"]),
  };
}

function isLegacyAgentTool(
  toolCall: ToolIdentityLike,
  rawNames: ReturnType<typeof readRawToolNameCandidates>,
) {
  const kind = normalizeLegacyToken(toolCall.kind);
  const title = normalizeLegacyToken(toolCall.title);
  const rawDirect = normalizeLegacyToken(rawNames.direct);
  const rawCf = normalizeLegacyToken(rawNames.cf);
  const rawClaude = normalizeLegacyToken(rawNames.claudeCode);

  return (
    rawClaude === "agent" ||
    rawClaude === "task" ||
    rawCf === "agent" ||
    rawCf === "spawn_agent" ||
    rawDirect === "agent" ||
    rawDirect === "spawn_agent" ||
    kind === "agent" ||
    kind === "spawn_agent" ||
    (kind === "think" && (title === "agent" || title === "task")) ||
    (kind === "think" &&
      isRecord(toolCall.input) &&
      typeof toolCall.input.subagent_type === "string")
  );
}

function isLegacySkillTool(
  toolCall: ToolIdentityLike,
  rawNames: ReturnType<typeof readRawToolNameCandidates>,
) {
  const kind = normalizeLegacyToken(toolCall.kind);
  const title = normalizeLegacyToken(toolCall.title);
  const rawClaude = normalizeLegacyToken(rawNames.claudeCode);
  return (
    rawClaude === "skill" ||
    title === "skill" ||
    kind === "skill" ||
    (kind === "other" && isRecord(toolCall.input) && typeof toolCall.input.skill === "string")
  );
}

function hasAskUserQuestionPayload(toolCall: ToolIdentityLike): boolean {
  return normalizeAskUserQuestionInput(readAskUserQuestionInput(toolCall)).questions.length > 0;
}

function isLegacyGoalToolToken(value: string): boolean {
  return value === "goalcreate" || value === "goalupdate";
}

function resolveLegacyKindFamily(kind: string): ToolCallPresentationFamily | null {
  if (/^(?:read|view|open|cat|head|tail|read_file)(?:_|$)/i.test(kind)) {
    return "file-read";
  }
  if (
    /(?:^|_)(?:edit|patch|replace|multi_edit|multiedit|write|create|save|apply_patch)(?:_|$)/i.test(
      kind,
    )
  ) {
    return "file-write";
  }
  if (/^(?:execute|run|exec|bash|shell|command|terminal)(?:_|$)/i.test(kind)) {
    return "shell";
  }
  if (/^(?:fetch|web_fetch|webfetch)$/i.test(kind)) {
    return "web-fetch";
  }
  if (
    /^(?:search|grep|find|fetch|web_search|web_fetch|webfetch|query|lookup|glob|list|ls|dir|tree)(?:_|$)/i.test(
      kind,
    )
  ) {
    return "search";
  }
  if (/^(?:explore|inspect)(?:_|$)/i.test(kind)) {
    return "explore";
  }
  return null;
}

function isPlanModeExitToken(value: string): boolean {
  return (
    value === "switch_mode" ||
    value === "switchmode" ||
    value === "exited_plan_mode" ||
    value === "exitedplanmode" ||
    value === "exit_plan_mode" ||
    value === "exitplanmode"
  );
}

export function resolveToolCallIdentity(toolCall: ToolIdentityLike): ToolCallIdentity {
  const rawNames = readRawToolNameCandidates(toolCall.raw);
  const normalizedKind = normalizeLegacyToken(toolCall.kind);
  const normalizedTitle = normalizeLegacyToken(toolCall.title);

  if (normalizedKind === "explore") {
    return identityFromLegacyFamily("Explore", "explore", "legacy-kind");
  }

  for (const candidate of [
    { value: toolCall.toolName, source: "toolName" as const },
    { value: toolCall.kind, source: "kind" as const },
    { value: rawNames.direct, source: "raw" as const },
    { value: rawNames.cf, source: "raw-cf-meta" as const },
  ]) {
    const identity = identityFromKnownToolName(candidate.value, candidate.source);
    if (identity) {
      return identity;
    }
  }

  if (isLegacyAgentTool(toolCall, rawNames)) {
    return identityFromLegacyFamily(
      rawNames.direct ?? rawNames.cf ?? rawNames.claudeCode ?? "Agent",
      "agent",
      "legacy-payload",
    );
  }

  const titleIdentity = identityFromKnownToolName(toolCall.title, "title");
  if (titleIdentity) {
    return titleIdentity;
  }

  if (
    [
      toolCall.toolName,
      toolCall.kind,
      toolCall.title,
      rawNames.direct,
      rawNames.rawKind,
      rawNames.rawTitle,
    ]
      .filter((value): value is string => typeof value === "string")
      .some(isTodoPlanToolName)
  ) {
    return identityFromLegacyFamily("TodoWrite", "todo", "legacy-title");
  }

  if (
    [
      toolCall.toolName,
      toolCall.kind,
      toolCall.title,
      rawNames.direct,
      rawNames.rawKind,
      rawNames.rawTitle,
    ]
      .filter((value): value is string => typeof value === "string")
      .map(normalizeLegacyToken)
      .some(isLegacyGoalToolToken)
  ) {
    return identityFromLegacyFamily(
      toolCall.toolName?.trim() ?? toolCall.kind?.trim() ?? "GoalUpdate",
      "goal",
      "legacy-title",
    );
  }

  if (
    normalizedTitle === "enterplanmode" ||
    normalizeLegacyToken(rawNames.claudeCode) === "enterplanmode"
  ) {
    return identityFromLegacyFamily("EnterPlanMode", "plan-guidance", "legacy-title");
  }

  if (
    [
      toolCall.toolName,
      toolCall.kind,
      toolCall.title,
      rawNames.direct,
      rawNames.cf,
      rawNames.claudeCode,
      rawNames.rawKind,
      rawNames.rawTitle,
    ]
      .filter((value): value is string => typeof value === "string")
      .map(normalizeLegacyToken)
      .some(isPlanModeExitToken)
  ) {
    return identityFromLegacyFamily("switch_mode", "switch-mode", "legacy-kind");
  }

  if (isLegacySkillTool(toolCall, rawNames)) {
    return identityFromLegacyFamily("Skill", "skill", "legacy-payload");
  }

  if (
    normalizedKind === "ask_question" ||
    normalizedTitle === "askuserquestion" ||
    normalizeLegacyToken(rawNames.claudeCode) === "askuserquestion" ||
    hasAskUserQuestionPayload(toolCall)
  ) {
    return identityFromLegacyFamily("AskUserQuestion", "ask-user-question", "legacy-payload");
  }

  const legacyKindFamily = resolveLegacyKindFamily(normalizedKind);
  if (legacyKindFamily) {
    return identityFromLegacyFamily(toolCall.kind?.trim() ?? null, legacyKindFamily, "legacy-kind");
  }

  const titlePrefixFamily = resolveLegacyKindFamily(
    normalizeLegacyToken(toolCall.title).split("_")[0] ?? "",
  );
  if (titlePrefixFamily === "file-read") {
    return identityFromLegacyFamily(toolCall.title?.trim() ?? null, "file-read", "legacy-title");
  }

  const claudeIdentity = identityFromKnownToolName(rawNames.claudeCode, "raw-claude-meta");
  if (claudeIdentity) {
    return {
      ...claudeIdentity,
      isLegacy: true,
    };
  }

  return UNKNOWN_TOOL_IDENTITY;
}

export function isFileContentWriteToolCall(
  toolCall: ToolIdentityLike,
  identity = resolveToolCallIdentity(toolCall),
): boolean {
  if (identity.family !== "file-write") {
    return false;
  }
  if (isCfFileContentWriteToolName(identity.toolName)) {
    return true;
  }
  const legacyKind = normalizeLegacyToken(toolCall.kind);
  return /^(?:write|create|save)(?:_|$)/i.test(legacyKind);
}

export function isFileDiffToolCall(
  toolCall: ToolIdentityLike,
  identity = resolveToolCallIdentity(toolCall),
): boolean {
  return identity.family === "file-write" && !isFileContentWriteToolCall(toolCall, identity);
}
