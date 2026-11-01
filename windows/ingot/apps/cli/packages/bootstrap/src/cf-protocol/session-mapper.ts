import {
  CF_PROTOCOL_NAME,
  CF_PROTOCOL_VERSION,
  getCfGoalActiveIterationCount,
  cfApiRetryFromModelNetworkStatusPayload,
  cfApiRetryFromStreamRecoveryPayload,
  cfContextUsageBreakdownSchema,
  type CfActiveToolCall,
  type CfContextUsageBreakdownItem,
  type CfDeliveryKind,
  type CfPendingPermission,
  type CfSessionContextUsage,
  type CfSessionEvent,
  type CfSessionGoal,
  type CfSessionGoalVerification,
  type CfSessionGoalVerificationTimeline,
  type CfSessionGoalStats,
  type CfSessionInfo,
  type CfSessionKind,
  type CfSessionProjection,
  type CfSessionRuntimeState,
  type CfSessionSettingsState,
  type CfSessionStateSnapshot,
  type CfSessionTodoGroup,
  type CfWorkspaceRef,
  isMainAgentToolProjectionSource,
} from "@origin-ai/cf-shared";
import {
  EventReducer,
  SessionEventType,
  getModelUsageContextTokens,
  type ActiveToolCall,
  type BackgroundTaskInfo,
  type GoalCompletionVerificationOutput,
  type MessageWithParts,
  type ModelCompletePayload,
  type PendingPermission,
  type SessionEvent,
  type SessionGoal,
  type SessionInfo,
  type SessionProjection,
  type TodoItem,
  type ToolState,
} from "@origin-ai/cf-contracts";
import type { CfApp } from "../app/types.js";
import { mapMessageWithParts } from "./message-mapper.js";
import { formatProtocolModelSelection, optionalModelSelectionFromString } from "./model-mapper.js";
import {
  buildProtocolPermissionOptions,
  toLegacyPermissionOptionsPolicy,
} from "./permission-options.js";
import {
  listProtocolSlashCommands,
  type ListProtocolSlashCommandsOptions,
} from "./slash-commands.js";

const SNAPSHOT_INLINE_IMAGE_DATA_URL_MAX_BYTES = 20 * 1024 * 1024;

export async function buildSessionSnapshot(input: {
  app: CfApp;
  deliveryKind?: CfDeliveryKind;
  eventSeq: number;
  fallbackCreatedAt?: number;
  fallbackUpdatedAt?: number;
  lastError?: SessionProjection["lastError"];
  messages: MessageWithParts[];
  modelAvailability?: "all" | "current";
  persistedGoalVerificationEvents?: SessionEvent[];
  persistedContextUsageBreakdownEvents?: SessionEvent[];
  session?: SessionInfo | null;
  stateRevision: number;
  slashCommandOptions?: ListProtocolSlashCommandsOptions;
  target?: SessionGoal | null;
  todos?: TodoItem[];
  workspace: CfWorkspaceRef;
}): Promise<CfSessionStateSnapshot> {
  const runtimeProjection = await input.app.runtime.getProjection();
  const activeTurn = input.app.runtime.getActiveTurnInfo();
  const persistedGoalProjection = mergePersistedGoalVerificationEvents(
    runtimeProjection,
    input.persistedGoalVerificationEvents ?? [],
    input.target === undefined ? runtimeProjection.target : input.target,
  );
  const projectionWithoutTitleFallback =
    input.target === undefined && input.lastError === undefined
      ? persistedGoalProjection
      : {
          ...persistedGoalProjection,
          ...(input.target === undefined ? {} : { target: input.target }),
          ...(input.lastError === undefined ? {} : { lastError: input.lastError }),
        };
  const projection = withGoalSummaryTitleFallback(
    projectionWithoutTitleFallback,
    input.session,
    input.messages,
  );
  const messages = await mapSnapshotMessages(input.app, input.messages);
  return {
    messages,
    projection: mapSessionProjection(projection),
    protocol: {
      name: CF_PROTOCOL_NAME,
      version: CF_PROTOCOL_VERSION,
    },
    runtime: mapRuntimeState({
      activeTurn,
      deliveryKind: input.deliveryKind,
      eventSeq: input.eventSeq,
      messages: input.messages,
      persistedContextUsageBreakdownEvents: input.persistedContextUsageBreakdownEvents,
      projection,
      stateRevision: input.stateRevision,
    }),
    session: mapSessionInfo({
      app: input.app,
      fallbackCreatedAt: input.fallbackCreatedAt,
      fallbackUpdatedAt: input.fallbackUpdatedAt,
      projection,
      session: input.session,
      workspace: input.workspace,
    }),
    settings: await mapSessionSettings(input.app, {
      currentModelContextWindow: projection.contextWindow,
      modelAvailability: input.modelAvailability,
    }),
    slashCommands: await listProtocolSlashCommands({
      ...input.slashCommandOptions,
      workingDirectory: input.workspace.workspacePath,
    }),
    goalStats: buildGoalStats(projection, input.messages),
    todos: input.todos?.map(mapTodoItem) ?? [],
    todoGroups: buildTodoGroups(input.messages, input.todos ?? [], projection),
  };
}

async function mapSnapshotMessages(
  app: Pick<CfApp, "readToolResultArtifact">,
  messages: readonly MessageWithParts[],
) {
  const mapped = messages.map(mapMessageWithParts);
  return await Promise.all(
    mapped.map(async (message) => ({
      ...message,
      parts: await Promise.all(message.parts.map((part) => hydrateSnapshotFilePartUrl(app, part))),
    })),
  );
}

async function hydrateSnapshotFilePartUrl(
  app: Pick<CfApp, "readToolResultArtifact">,
  part: ReturnType<typeof mapMessageWithParts>["parts"][number],
) {
  if (part.type !== "file" || !isImageMime(part.mime) || isUsableDataUrl(part.url)) {
    return part;
  }
  const artifactUri = snapshotFilePartArtifactUri(part);
  if (!artifactUri) {
    return part;
  }

  try {
    const artifact = await app.readToolResultArtifact(artifactUri);
    const dataUrl = dataUrlFromSnapshotArtifact(artifact.content, artifact.contentType, part.mime);
    if (!dataUrl || Buffer.byteLength(dataUrl, "utf8") > SNAPSHOT_INLINE_IMAGE_DATA_URL_MAX_BYTES) {
      return part;
    }
    return { ...part, url: dataUrl };
  } catch {
    return part;
  }
}

function snapshotFilePartArtifactUri(
  part: Extract<ReturnType<typeof mapMessageWithParts>["parts"][number], { type: "file" }>,
): string | undefined {
  const metadataArtifactUri =
    typeof part.metadata?.artifactUri === "string" ? part.metadata.artifactUri : undefined;
  const artifactUri = metadataArtifactUri ?? part.url;
  return artifactUri.startsWith("cf-artifact://") ? artifactUri : undefined;
}

function dataUrlFromSnapshotArtifact(
  content: string,
  contentType: string,
  fallbackMime: string,
): string | undefined {
  if (isUsableDataUrl(content)) {
    return content;
  }
  const mediaType = concreteImageMime(contentType) ?? concreteImageMime(fallbackMime);
  if (!mediaType) {
    return undefined;
  }
  return `data:${mediaType};base64,${content}`;
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function resolveSessionContextUsage(input: {
  messages: readonly MessageWithParts[];
  persistedContextUsageBreakdownEvents?: readonly SessionEvent[];
  projection: SessionProjection;
}): CfSessionContextUsage | undefined {
  const persistedContextUsage = contextUsageFromPersistedMessages(
    input.messages,
    input.projection.contextWindow,
  );
  return applyContextUsageBreakdown(
    contextUsageFromProjection(
      input.projection,
      persistedContextUsage?.used === input.projection.contextUsed
        ? persistedContextUsage.cache
        : undefined,
    ) ?? persistedContextUsage,
    latestContextUsageBreakdownFromEvents(input.persistedContextUsageBreakdownEvents ?? []),
  );
}

function applyContextUsageBreakdown(
  contextUsage: CfSessionContextUsage | undefined,
  candidate: ContextUsageBreakdownCandidate | undefined,
): CfSessionContextUsage | undefined {
  if (!contextUsage || !candidate || candidate.breakdown.length === 0) {
    return contextUsage;
  }
  if (contextUsage.breakdown && contextUsage.breakdown.length > 0) {
    return contextUsage;
  }
  if (candidate.used !== contextUsage.used) {
    return contextUsage;
  }
  if (candidate.contextWindow !== undefined && candidate.contextWindow !== contextUsage.size) {
    return contextUsage;
  }
  return {
    ...contextUsage,
    breakdown: candidate.breakdown,
  };
}

function latestContextUsageBreakdownFromEvents(
  events: readonly SessionEvent[],
): ContextUsageBreakdownCandidate | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.type !== SessionEventType.ModelComplete) {
      continue;
    }
    const payload = event.payload as Partial<ModelCompletePayload>;
    const querySource = stringValue(payload.querySource);
    if (querySource !== undefined && querySource !== "main_turn") {
      continue;
    }
    const parsed = cfContextUsageBreakdownSchema.safeParse(payload.contextUsageBreakdown);
    const used = getModelUsageContextTokens(payload.usage);
    if (!parsed.success || parsed.data.length === 0 || used === undefined) {
      continue;
    }
    const contextWindow = positiveInteger(payload.contextWindow);
    return {
      breakdown: parsed.data,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      used,
    };
  }
  return undefined;
}

function mapGoalVerifications(
  verifications: SessionProjection["targetCompletionVerifications"] | undefined,
): CfSessionGoalVerification[] {
  return (verifications ?? []).map((verification) => ({
    nextAction: verification.nextAction ?? null,
    passed: verification.passed,
    reason: verification.reason,
  }));
}

function mapGoalVerificationTimeline(
  timeline: SessionProjection["targetCompletionVerificationTimeline"] | undefined,
): CfSessionGoalVerificationTimeline[] {
  return (timeline ?? []).map((item) => ({
    version: 1,
    kind: "synthetic",
    type: "goal_verification",
    display: "separator",
    targetId: item.targetId,
    verificationId: item.verificationId,
    status: item.status,
    ...(item.goalIteration ? { goalIteration: item.goalIteration } : {}),
    ...(item.anchorAssistantMessageId
      ? { anchorAssistantMessageId: item.anchorAssistantMessageId }
      : {}),
    ...(item.anchorTurnId ? { anchorTurnId: item.anchorTurnId } : {}),
    ...(item.verification
      ? {
          verification: {
            nextAction: item.verification.nextAction ?? null,
            passed: item.verification.passed,
            reason: item.verification.reason,
          },
        }
      : {}),
    ...(item.startedAt ? { startedAt: item.startedAt.getTime() } : {}),
    updatedAt: item.updatedAt.getTime(),
  }));
}

function contextUsageFromProjection(
  projection: SessionProjection,
  cache: CfSessionContextUsage["cache"] | undefined,
): CfSessionContextUsage | undefined {
  if (projection.contextUsed <= 0 || projection.contextWindow <= 0) {
    return undefined;
  }
  return {
    ...(cache ? { cache } : {}),
    cost: null,
    size: projection.contextWindow,
    used: projection.contextUsed,
  };
}

function contextUsageFromPersistedMessages(
  messages: readonly MessageWithParts[],
  contextWindow: number,
): CfSessionContextUsage | undefined {
  if (contextWindow <= 0) {
    return undefined;
  }
  const cache = contextCacheUsageFromMessages(messages);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (message.info.role === "user" && message.info.summary) {
      const compactPart = message.parts.find(
        (part) => part.type === "compaction" && part.compactBoundary,
      );
      if (compactPart?.type === "compaction" && compactPart.compactBoundary) {
        const used = positiveInteger(
          compactPart.compactBoundary.truePostCompactTokenCount ??
            compactPart.compactBoundary.postCompactTokenCount,
        );
        if (used !== undefined) {
          return {
            cost: null,
            size: contextWindow,
            used,
          };
        }
      }
    }
    if (message.info.role !== "assistant" || message.info.summary) {
      continue;
    }
    const used = contextUsedFromTokens(message.info.tokens);
    if (used === undefined) {
      continue;
    }
    return {
      ...(cache ? { cache } : {}),
      cost: null,
      size: contextWindow,
      used,
    };
  }
  return undefined;
}

function contextUsedFromTokens(
  tokens:
    | {
        total?: number;
        input: number;
        output?: number;
      }
    | undefined,
): number | undefined {
  if (!tokens) {
    return undefined;
  }

  const total = positiveInteger(tokens.total);
  if (total !== undefined) {
    return total;
  }

  const input = positiveInteger(tokens.input);
  if (input === undefined) {
    return undefined;
  }

  return input + (nonNegativeInteger(tokens.output) ?? 0);
}

function contextCacheUsageFromMessages(
  messages: readonly MessageWithParts[],
): CfSessionContextUsage["cache"] | undefined {
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let requestCount = 0;
  let latestInputTokens = 0;
  let latestCacheReadTokens = 0;
  let latestCacheWriteTokens = 0;

  for (const message of messages) {
    if (message.info.role !== "assistant" || message.info.summary) {
      continue;
    }
    const input = nonNegativeInteger(message.info.tokens.input) ?? 0;
    const read = nonNegativeInteger(message.info.tokens.cache.read) ?? 0;
    const write = nonNegativeInteger(message.info.tokens.cache.write) ?? 0;
    if (input <= 0 && read <= 0 && write <= 0) {
      continue;
    }
    requestCount += 1;
    inputTokens += input;
    cacheReadTokens += read;
    cacheWriteTokens += write;
    latestInputTokens = input;
    latestCacheReadTokens = read;
    latestCacheWriteTokens = write;
  }

  if (requestCount <= 0) {
    return undefined;
  }
  return {
    inputTokens: latestInputTokens,
    cacheReadTokens: latestCacheReadTokens,
    cacheWriteTokens: latestCacheWriteTokens,
    latestHitRate: latestInputTokens > 0 ? latestCacheReadTokens / latestInputTokens : null,
    hitRate: inputTokens > 0 ? cacheReadTokens / inputTokens : null,
    hitRateRequestCount: requestCount,
    totalInputTokens: inputTokens,
    totalCacheReadTokens: cacheReadTokens,
    totalCacheWriteTokens: cacheWriteTokens,
  };
}

function mapPendingPermission(
  permission: PendingPermission,
): CfPendingPermission {
  return {
    input: permission.input,
    ...(permission.origin ? { origin: permission.origin } : {}),
    options: buildProtocolPermissionOptions({
      ...permission,
      optionsPolicy: toLegacyPermissionOptionsPolicy(permission.optionsPolicy),
    }),
    reason: permission.reason ?? "",
    requestId: permission.requestId ?? permission.toolCallId,
    requestedAt: permission.requestedAt.getTime(),
    riskLevel: permission.riskLevel,
    toolCallId: permission.toolCallId,
    toolName: permission.toolName,
  };
}

function mapPermissionRequestedPayload(
  payload: unknown,
): Record<string, unknown> {
  const { display: _display, optionsPolicy, ...record } = asRecord(payload);
  const toolName = stringValue(record.toolName) ?? "unknown";
  return {
    ...record,
    options: buildProtocolPermissionOptions({
      approvalMode: record.approvalMode === "user-once" ? "user-once" : undefined,
      input: record.input,
      suggestedPermissionUpdates: Array.isArray(record.suggestedPermissionUpdates)
        ? (record.suggestedPermissionUpdates as PendingPermission["suggestedPermissionUpdates"])
        : undefined,
      optionsPolicy: toLegacyPermissionOptionsPolicy(optionsPolicy),
      toolName,
    }),
  };
}

function mapActiveToolCall(toolCall: ActiveToolCall): CfActiveToolCall {
  return {
    startedAt: toolCall.startedAt?.getTime(),
    status: toolCall.status,
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
  };
}

function mapBackgroundTask(task: BackgroundTaskInfo): Record<string, unknown> {
  return { ...task };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function mergePersistedGoalVerificationEvents(
  projection: SessionProjection,
  events: readonly SessionEvent[],
  target?: SessionGoal | null,
): SessionProjection {
  if (events.length === 0) {
    return projection;
  }

  const baseProjection = {
    ...projection,
    targetCompletionVerifications: projection.targetCompletionVerifications ?? [],
    targetCompletionVerificationTimeline: projection.targetCompletionVerificationTimeline ?? [],
  };
  const targetId = target?.targetID ?? projection.target?.targetID;
  const reducer = new EventReducer();
  const restored = [...events]
    .filter((event) => event.type === SessionEventType.TargetCompletionVerification)
    .filter((event) => {
      const payload = asRecord(event.payload);
      const eventTargetId = stringValue(payload.targetId);
      return !targetId || !eventTargetId || eventTargetId === targetId;
    })
    .sort(compareEventsByTimelineTime)
    .reduce((current, event) => reducer.apply(current, event), baseProjection);
  const timeline = getTargetGoalVerificationTimeline(restored, target).sort(
    compareGoalVerificationTimeline,
  );
  return {
    ...restored,
    targetCompletionVerificationTimeline: timeline,
    targetCompletionVerifications: mergeGoalVerificationSummaries(
      restored.targetCompletionVerifications,
      timeline,
    ),
  };
}

function compareEventsByTimelineTime(left: SessionEvent, right: SessionEvent): number {
  const byTime = left.timestamp.getTime() - right.timestamp.getTime();
  if (byTime !== 0) return byTime;
  return left.sequenceNumber - right.sequenceNumber;
}

function mergeGoalVerificationSummaries(
  verifications: readonly GoalCompletionVerificationOutput[],
  timeline: readonly SessionProjection["targetCompletionVerificationTimeline"][number][],
): GoalCompletionVerificationOutput[] {
  const result: GoalCompletionVerificationOutput[] = [];
  const seen = new Set<string>();
  for (const verification of [
    ...verifications,
    ...timeline
      .map((item) => item.verification)
      .filter((item): item is GoalCompletionVerificationOutput => item !== undefined),
  ]) {
    const key = goalVerificationSummaryKey(verification);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(verification);
  }
  return result;
}

function goalVerificationSummaryKey(verification: GoalCompletionVerificationOutput): string {
  return [
    verification.passed ? "1" : "0",
    normalizeTodoContent(verification.reason),
    normalizeTodoContent(verification.nextAction ?? ""),
  ].join("\u0000");
}

function withGoalSummaryTitleFallback(
  projection: SessionProjection,
  session: SessionInfo | null | undefined,
  messages: readonly MessageWithParts[],
): SessionProjection {
  const target = projection.target;
  if (!target || target.summaryTitle || !session?.title) {
    return projection;
  }
  const firstUserMessage = messages
    .filter((message) => message.info.role === "user")
    .sort(compareMessagesByCreatedTime)[0];
  if (
    !firstUserMessage ||
    Math.abs(firstUserMessage.info.time.created - target.time.created) > 5_000
  ) {
    return projection;
  }
  if (normalizeText(readMessageText(firstUserMessage)) !== normalizeText(target.objective)) {
    return projection;
  }
  return {
    ...projection,
    target: {
      ...target,
      summaryTitle: session.title,
    },
  };
}

function readMessageText(message: MessageWithParts): string {
  return message.parts
    .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function mapSessionGoal(goal: SessionGoal | null | undefined): CfSessionGoal | null | undefined {
  if (goal === undefined) return undefined;
  if (goal === null) return null;
  return {
    createdAt: goal.time.created,
    objective: goal.objective,
    sessionId: String(goal.sessionID),
    status: goal.status,
    summaryTitle: goal.summaryTitle,
    targetId: goal.targetID,
    timeUsedSeconds: goal.timeUsedSeconds ?? 0,
    tokenBudget: goal.tokenBudget ?? null,
    tokensUsed: goal.tokensUsed ?? 0,
    activeInputId: goal.activeInputId ?? null,
    activeRunStartedAtMs: goal.activeRunStartedAtMs ?? null,
    activeRunLastSeenAtMs: goal.activeRunLastSeenAtMs ?? null,
    updatedAt: goal.time.updated,
  };
}

function mapTodoItem(todo: TodoItem): TodoItem {
  return {
    content: todo.content,
    priority: todo.priority,
    status: todo.status,
  };
}

interface GoalIterationBucket {
  goalIteration: number;
  id: string;
  messageIds: Set<string>;
  startedAt?: number;
  targetId?: string;
  toolCallCount: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  updatedAt?: number;
}

function buildGoalStats(
  projection: SessionProjection,
  messages: readonly MessageWithParts[],
): CfSessionGoalStats | undefined {
  const target = projection.target;
  if (!target) {
    return undefined;
  }
  const goalIterations = collectGoalIterationBuckets(messages, {
    projection,
    target,
  });
  const activeIterationCount = getGoalActiveIterationCount(projection, target);
  const derivedTokensUsed = goalIterations.reduce(
    (sum, iteration) => sum + iteration.tokensUsed,
    0,
  );
  const derivedTimeUsedSeconds = goalIterations.reduce(
    (sum, iteration) => sum + iteration.timeUsedSeconds,
    0,
  );
  return {
    contextUsed: projection.contextUsed,
    contextWindow: projection.contextWindow,
    iterationCount: activeIterationCount,
    timeUsedSeconds:
      target.timeUsedSeconds > 0 || target.activeRunStartedAtMs != null
        ? target.timeUsedSeconds
        : derivedTimeUsedSeconds,
    tokenBudget: target.tokenBudget ?? null,
    tokensUsed: target.tokensUsed > 0 ? target.tokensUsed : derivedTokensUsed,
    toolCallCount: goalIterations.reduce((sum, iteration) => sum + iteration.toolCallCount, 0),
  };
}

function buildTodoGroups(
  messages: readonly MessageWithParts[],
  currentTodos: readonly TodoItem[],
  projection: SessionProjection,
): CfSessionTodoGroup[] {
  const target = projection.target;
  const timeline = getTargetGoalVerificationTimeline(projection, target);
  const groups = new Map<string, CfSessionTodoGroup>();
  const todoOwners = new Map<string, { fingerprint: string; groupId: string }>();
  const sortedMessages = [...messages].sort(compareMessagesByCreatedTime);

  for (const message of sortedMessages) {
    if (message.info.role !== "assistant") {
      continue;
    }
    const goalIteration = getGoalIterationForMessageTime(
      message.info.time.created,
      target,
      timeline,
    );
    for (const part of message.parts) {
      if (
        part.type !== "tool" ||
        !isTodoWriteToolName(part.tool) ||
        !isMainAgentToolProjectionSource(part.metadata, readToolStateMetadata(part.state))
      ) {
        continue;
      }
      const todos = readTodosFromToolInput(part.state.input);
      if (!todos) {
        continue;
      }
      const updatedAt =
        readToolStateUpdatedAt(part.state) ??
        message.info.time.completed ??
        message.info.time.created;
      const groupId = goalIteration ? `goal-iteration-${goalIteration}` : "session";
      const group = ensureTodoGroup(groups, {
        goalIteration,
        groupId,
        startedAt: goalIteration
          ? getGoalIterationStartedAt(goalIteration, target, timeline, message.info.time.created)
          : message.info.time.created,
        targetId: goalIteration ? target?.targetID : undefined,
        updatedAt,
      });
      for (const todo of todos) {
        const fingerprint = normalizeTodoContent(todo.content);
        const ownerKey = `${target?.targetID ?? "session"}\u0000${fingerprint}`;
        const owner = todoOwners.get(ownerKey);
        if (owner) {
          const ownerGroup = groups.get(owner.groupId);
          if (ownerGroup) {
            addOrUpdateTodoInGroup(ownerGroup, owner.fingerprint, todo);
            ownerGroup.updatedAt = Math.max(ownerGroup.updatedAt ?? 0, updatedAt);
          }
          continue;
        }
        todoOwners.set(ownerKey, { fingerprint, groupId });
        addOrUpdateTodoInGroup(group, fingerprint, todo);
      }
    }
  }

  if (groups.size === 0 && currentTodos.length > 0) {
    groups.set("session-current", {
      id: "session-current",
      source: "session",
      todos: currentTodos.map(mapTodoItem),
    });
  }

  return [...groups.values()].sort((left, right) => {
    const leftTime = left.startedAt ?? Number.MAX_SAFE_INTEGER;
    const rightTime = right.startedAt ?? Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });
}

function ensureTodoGroup(
  groups: Map<string, CfSessionTodoGroup>,
  input: {
    goalIteration: number | undefined;
    groupId: string;
    startedAt: number;
    targetId?: string;
    updatedAt: number;
  },
): CfSessionTodoGroup {
  const existing = groups.get(input.groupId);
  if (existing) {
    existing.updatedAt = Math.max(existing.updatedAt ?? 0, input.updatedAt);
    return existing;
  }
  const group: CfSessionTodoGroup = {
    id: input.groupId,
    source: input.goalIteration ? "goal_iteration" : "session",
    ...(input.goalIteration ? { goalIteration: input.goalIteration } : {}),
    ...(input.targetId ? { targetId: input.targetId } : {}),
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    todos: [],
  };
  groups.set(input.groupId, group);
  return group;
}

function addOrUpdateTodoInGroup(
  group: CfSessionTodoGroup,
  fingerprint: string,
  todo: TodoItem,
): void {
  const nextTodo = mapTodoItem(todo);
  const existingIndex = group.todos.findIndex(
    (item) => normalizeTodoContent(item.content) === fingerprint,
  );
  if (existingIndex >= 0) {
    group.todos[existingIndex] = nextTodo;
    return;
  }
  group.todos.push(nextTodo);
}

function getGoalActiveIterationCount(
  projection: SessionProjection,
  target?: SessionGoal | null,
): number {
  const timeline = getTargetGoalVerificationTimeline(projection, target);
  return getCfGoalActiveIterationCount({
    targetStatus: target?.status ?? null,
    timeline,
  });
}

function collectGoalIterationBuckets(
  messages: readonly MessageWithParts[],
  options: { projection: SessionProjection; target?: SessionGoal | null },
): GoalIterationBucket[] {
  const target = options.target ?? null;
  const timeline = getTargetGoalVerificationTimeline(options.projection, target);
  const buckets: GoalIterationBucket[] = [];
  const byIteration = new Map<number, GoalIterationBucket>();
  const sortedMessages = [...messages].sort(compareMessagesByCreatedTime);

  for (const message of sortedMessages) {
    if (message.info.role !== "assistant") {
      continue;
    }
    const goalIteration = getGoalIterationForMessageTime(
      message.info.time.created,
      target,
      timeline,
    );
    if (!goalIteration) {
      continue;
    }
    const bucket =
      byIteration.get(goalIteration) ??
      createGoalIterationBucket(goalIteration, target, timeline, message.info.time.created);
    if (!byIteration.has(goalIteration)) {
      byIteration.set(goalIteration, bucket);
      buckets.push(bucket);
    }
    const messageId = String(message.info.id);
    bucket.messageIds.add(messageId);
    const completedAt = message.info.time.completed ?? message.info.time.created;
    bucket.toolCallCount += message.parts.filter((part) => part.type === "tool").length;
    bucket.tokensUsed += tokenTotal(message.info.tokens);
    bucket.timeUsedSeconds += Math.max(
      0,
      Math.ceil((completedAt - message.info.time.created) / 1000),
    );
    bucket.updatedAt = Math.max(bucket.updatedAt ?? 0, completedAt);
  }

  return buckets;
}

function createGoalIterationBucket(
  goalIteration: number,
  target: SessionGoal | null,
  timeline: readonly SessionProjection["targetCompletionVerificationTimeline"][number][],
  fallbackStartedAt: number,
): GoalIterationBucket {
  return {
    goalIteration,
    id: `goal-iteration-${goalIteration}`,
    messageIds: new Set(),
    startedAt: getGoalIterationStartedAt(goalIteration, target, timeline, fallbackStartedAt),
    targetId: target?.targetID,
    toolCallCount: 0,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    updatedAt: fallbackStartedAt,
  };
}

function getTargetGoalVerificationTimeline(
  projection: SessionProjection,
  target?: SessionGoal | null,
): SessionProjection["targetCompletionVerificationTimeline"] {
  const targetId = target?.targetID;
  return (projection.targetCompletionVerificationTimeline ?? [])
    .filter((item) => !targetId || item.targetId === targetId)
    .sort(compareGoalVerificationTimeline);
}

function compareGoalVerificationTimeline(
  left: SessionProjection["targetCompletionVerificationTimeline"][number],
  right: SessionProjection["targetCompletionVerificationTimeline"][number],
): number {
  const leftIteration = left.goalIteration ?? 0;
  const rightIteration = right.goalIteration ?? 0;
  if (leftIteration !== rightIteration && leftIteration > 0 && rightIteration > 0) {
    return leftIteration - rightIteration;
  }
  const byTime = goalVerificationTimelineTime(left) - goalVerificationTimelineTime(right);
  if (byTime !== 0) return byTime;
  return left.verificationId.localeCompare(right.verificationId);
}

function goalVerificationTimelineTime(
  item: SessionProjection["targetCompletionVerificationTimeline"][number],
): number {
  return (item.startedAt ?? item.updatedAt).getTime();
}

function getGoalIterationForMessageTime(
  messageCreatedAt: number,
  target: SessionGoal | null | undefined,
  timeline: readonly SessionProjection["targetCompletionVerificationTimeline"][number][],
): number | undefined {
  if (!target || messageCreatedAt < target.time.created) {
    return undefined;
  }
  let activeIteration = 1;
  for (const item of timeline) {
    const itemIteration = item.goalIteration ?? activeIteration;
    const boundaryTime = item.updatedAt.getTime();
    if (messageCreatedAt <= boundaryTime) {
      return itemIteration;
    }
    if (item.status === "started") {
      activeIteration = itemIteration;
      continue;
    }
    if (isPassingGoalVerification(item)) {
      return undefined;
    }
    activeIteration = itemIteration + 1;
  }
  return activeIteration;
}

function getGoalIterationStartedAt(
  goalIteration: number,
  target: SessionGoal | null | undefined,
  timeline: readonly SessionProjection["targetCompletionVerificationTimeline"][number][],
  fallbackStartedAt: number,
): number {
  if (!target || goalIteration <= 1) {
    return target?.time.created ?? fallbackStartedAt;
  }
  const previousBoundary = [...timeline]
    .filter((item) => (item.goalIteration ?? 0) === goalIteration - 1)
    .filter((item) => item.status !== "started")
    .sort(compareGoalVerificationTimeline)
    .at(-1);
  return previousBoundary?.updatedAt.getTime() ?? fallbackStartedAt;
}

function isPassingGoalVerification(
  item: SessionProjection["targetCompletionVerificationTimeline"][number],
): boolean {
  return item.status === "completed" && item.verification?.passed === true;
}

function normalizeTodoContent(content: string): string {
  return normalizeText(content);
}

function readTodosFromToolInput(input: Record<string, unknown>): TodoItem[] | undefined {
  const rawTodos = input.todos;
  if (!Array.isArray(rawTodos)) {
    return undefined;
  }
  const todos = rawTodos.map(readTodoItem).filter((todo): todo is TodoItem => todo !== null);
  return todos.length === rawTodos.length ? todos : undefined;
}

function readTodoItem(value: unknown): TodoItem | null {
  const record = asRecord(value);
  const content = stringValue(record.content)?.trim();
  const status = stringValue(record.status);
  const priority = stringValue(record.priority);
  if (!content || !isTodoStatus(status) || !isTodoPriority(priority)) {
    return null;
  }
  return { content, priority, status };
}

function isTodoWriteToolName(toolName: string): boolean {
  return toolName.toLowerCase().replace(/[_\s-]/g, "") === "todowrite";
}

function readToolStateMetadata(state: ToolState): Record<string, unknown> | undefined {
  switch (state.status) {
    case "pending":
      return undefined;
    case "running":
    case "completed":
    case "error":
      return state.metadata;
  }
}

function isTodoStatus(status: string | undefined): status is TodoItem["status"] {
  return status === "pending" || status === "in_progress" || status === "completed";
}

function isTodoPriority(priority: string | undefined): priority is TodoItem["priority"] {
  return priority === "high" || priority === "medium" || priority === "low";
}

function readToolStateUpdatedAt(state: ToolState): number | undefined {
  if (state.status === "completed" || state.status === "error") {
    return state.time.end;
  }
  if (state.status === "running") {
    return state.time.start;
  }
  return undefined;
}

function tokenTotal(tokens: {
  cache: { read: number; write: number };
  input: number;
  output: number;
  reasoning: number;
  total?: number;
}): number {
  return (
    tokens.total ??
    tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  );
}

function compareMessagesByCreatedTime(left: MessageWithParts, right: MessageWithParts): number {
  const byTime = left.info.time.created - right.info.time.created;
  if (byTime !== 0) return byTime;
  return String(left.info.id).localeCompare(String(right.info.id));
}

function mapSessionEventType(type: SessionEvent["type"]): CfSessionEvent["type"] {
  switch (type) {
    case SessionEventType.SessionCreated:
      return "session.created";
    case SessionEventType.SessionResumed:
      return "session.resumed";
    case SessionEventType.SessionTitleUpdated:
      return "session.titleUpdated";
    case SessionEventType.SessionEnded:
      return "session.closed";
    case SessionEventType.TurnStarted:
      return "turn.started";
    case SessionEventType.TurnSteerQueued:
      return "turn.steerQueued";
    case SessionEventType.TurnSteerDrained:
      return "turn.steerDrained";
    case SessionEventType.TurnComplete:
      return "turn.completed";
    case SessionEventType.TurnError:
      return "turn.failed";
    case SessionEventType.UserMessage:
    case SessionEventType.AssistantMessage:
    case SessionEventType.SystemMessage:
      return "message.upserted";
    case SessionEventType.ModelStreaming:
      return "model.streaming";
    case SessionEventType.ToolCallScheduled:
    case SessionEventType.ToolCallStarted:
    case SessionEventType.ToolCallProgress:
    case SessionEventType.ToolCallResult:
    case SessionEventType.ToolCallError:
    case SessionEventType.ToolBatchComplete:
      return "tool.updated";
    case SessionEventType.PermissionRequested:
      return "permission.requested";
    case SessionEventType.PermissionResolved:
    case SessionEventType.PermissionDenied:
      return "permission.resolved";
    case SessionEventType.CheckpointCreated:
      return "checkpoint.created";
    case SessionEventType.RewindTriggered:
      return "rewind.triggered";
    case SessionEventType.StreamRecoveryAnchorCreated:
    case SessionEventType.StreamRecoveryStarted:
    case SessionEventType.StreamRecoveryAnchorSelected:
    case SessionEventType.StreamRecoveryRetryStarted:
    case SessionEventType.StreamRecoveryTailDiscarded:
    case SessionEventType.StreamRecoveryBlocked:
      return "streamRecovery.updated";
    default:
      return "session.updated";
  }
}
