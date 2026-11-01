//
import { SessionEventType, type SessionEvent } from "@origin-ai/cf-contracts";
import type {
  CommandEnvelope,
  ConversationDelta,
  ConversationRowTarget,
  ConversationSnapshot,
  ConversationTopicFrame,
  DeliveryProfile,
  DeliveryProfileName,
  QueueItem,
  SubscribeAck,
  ToolCallRow,
  TopicFrameDeliveryKind,
  V4ConversationPlansResult,
  V4ConversationRowsRangeResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  DELIVERY_PROFILES,
  statePatchSchema,
  PROTOCOL_V4_LIMITS,
  clampWorkflowRunsForLegacy,
  coalesceConversationDeltas,
  filterConversationDeltasForProfile,
  filterConversationRowsForProfile,
  utf8JsonByteLength,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { Buffer } from "node:buffer";
import {
  encodeConversationDeltasForLegacy,
  workflowRunDeltaGrowthUpperBound,
} from "./conversation-workflow-run-deltas.js";
import {
  ProductProjection,
  type ConversationRowTargetAction,
  type ConversationRowTargetResolution,
  type SessionConfigSeed,
  type SessionSubagentsSeed,
  type SessionUsageSeed,
  type StableForkCandidateResolution,
} from "./product-projection.js";
import type { TopicFrameReservation } from "./topic-frame-reservation.js";

interface LogEntry {
  seq: number;
  deltas: ConversationDelta[];
}

const TERMINAL_PLAN_STATUSES: ReadonlySet<ToolCallRow["status"]> = new Set([
  "success",
  "error",
  "cancelled",
]);

export function coldHydrationJsonByteLength(value: unknown): number {
  const json = JSON.stringify(value);
  return json === undefined ? 0 : Buffer.byteLength(json, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPlanMarkdown(row: ToolCallRow): boolean {
  if (isRecord(row.input)) {
    const plan = row.input.plan;
    if (typeof plan === "string" && plan.trim().length > 0) return true;
  }
  if (!row.inputText.trim()) return false;
  try {
    const parsed: unknown = JSON.parse(row.inputText);
    return isRecord(parsed) && typeof parsed.plan === "string" && parsed.plan.trim().length > 0;
  } catch {
    return false;
  }
}

interface Subscription {
  subscriptionId: string;
  connectionId: string;
  profile: DeliveryProfile;
  
  workflowRunDeltas: boolean;
  
  buffer: ConversationDelta[];
  bufferBytes: number;
  
  resyncRequired: boolean;
  
  sentSeq: number;
  
  inFlight: TopicFrameReservation<ConversationTopicFrame> | null;
  nextLogicalFrameOrdinal: number;
}

export interface ConversationSubscribeParams {
  connectionId: string;
  base?: { logEpoch: string; seq: number };
  
  deliveryProfile?: DeliveryProfileName;
  
  workflowRunDeltas?: boolean;
}

export interface ConversationSubscribeResult {
  ack: SubscribeAck;
  reservation: TopicFrameReservation<ConversationTopicFrame> | null;
  
  rollback(): boolean;
  
  readonly frame: ConversationTopicFrame | null;
}

export interface ConversationResyncRequest {
  base: { logEpoch: string; seq: number } | null;
  forceSnapshot?: boolean;
}

export interface ConversationTopicPublisherOptions {
  
  now?: () => number;
  
  retention?: number;
  
  subscriberBufferMaxOps?: number;
  
  subscriberBufferMaxBytes?: number;
}

export interface ConversationSubscriberBufferLimits {
  maxOps?: number;
  
  maxBytes?: number;
  
  snapshotBytesUpperBound?: number;
}

export class ProjectionPayloadTooLargeError extends Error {
  readonly reasonCode = "proto.payloadTooLarge";

  constructor(readonly logicalBytes: number) {
    super(
      `conversation projection exceeds ${PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxBytes} bytes`,
    );
    this.name = "ProjectionPayloadTooLargeError";
  }
}

export const PROJECTION_TERMINAL_RESERVE_BYTES = 64 * 1024;

const HYDRATION_ACTION_BYTES_PER_WIRE_ROW = 128;
const HYDRATION_EVENT_WIRE_OVERHEAD_BYTES = 64;
const HYDRATION_SEQUENCE_NUMBER_OCCURRENCES = 2;

function hydrationSequenceNumberBytes(sequenceNumber: number): number {
  return String(sequenceNumber).length * HYDRATION_SEQUENCE_NUMBER_OCCURRENCES;
}

export type ConversationSubscriberBufferResult =
  | {
      kind: "buffered";
      deltas: ConversationDelta[];
      encodedBytes: number;
    }
  | { kind: "overflow" };

function nonNegativeHardBound(value: number | undefined, maximum: number, name: string): number {
  const resolved = value ?? maximum;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
  return Math.min(Math.floor(resolved), maximum);
}

export function conversationSubscriberBufferByteLimit(
  floorBytes: number,
  snapshotBytesUpperBound: number,
): number {
  return Math.min(
    Math.max(floorBytes, snapshotBytesUpperBound),
    PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxBytes - PROJECTION_TERMINAL_RESERVE_BYTES,
  );
}

export function appendConversationSubscriberBuffer(
  current: readonly ConversationDelta[],
  incoming: readonly ConversationDelta[],
  limits: ConversationSubscriberBufferLimits = {},
): ConversationSubscriberBufferResult {
  const maxOps = nonNegativeHardBound(
    limits.maxOps,
    PROTOCOL_V4_LIMITS.subscriberBufferMaxOps,
    "maxOps",
  );
  const maxBytes = nonNegativeHardBound(
    limits.maxBytes,
    PROTOCOL_V4_LIMITS.subscriberBufferMaxBytes,
    "maxBytes",
  );
  const byteLimit = conversationSubscriberBufferByteLimit(
    maxBytes,
    limits.snapshotBytesUpperBound ?? 0,
  );
  const deltas = coalesceConversationDeltas([...current, ...incoming]);
  if (deltas.length > maxOps) return { kind: "overflow" };
  const encodedBytes = utf8JsonByteLength({ kind: "deltas", deltas });
  if (encodedBytes > byteLimit) return { kind: "overflow" };
  return { kind: "buffered", deltas, encodedBytes };
}

export class ConversationTopicPublisher {
  readonly topic: string;
  private projection: ProductProjection;
  private readonly now: () => number;
  private readonly retention: number;
  private readonly subscriberBufferMaxOps: number;
  private readonly subscriberBufferMaxBytes: number;
  
  private readonly log: LogEntry[] = [];
  
  private floorSeq = 0;
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly subscriptionIdByConnection = new Map<string, string>();
  private nextSubscriptionSerial = 1;
  private nextLogicalFrameSerial = 1;
  
  private wireSnapshotBytesUpperBound: number;

  constructor(
    private readonly sessionId: string,
    private readonly logEpoch: string,
    options: ConversationTopicPublisherOptions = {},
  ) {
    this.topic = `conversation/${sessionId}`;
    this.projection = new ProductProjection(sessionId, logEpoch);
    this.now = options.now ?? Date.now;
    this.retention = options.retention ?? PROTOCOL_V4_LIMITS.eventRetentionPerSession;
    this.subscriberBufferMaxOps = nonNegativeHardBound(
      options.subscriberBufferMaxOps,
      PROTOCOL_V4_LIMITS.subscriberBufferMaxOps,
      "subscriberBufferMaxOps",
    );
    this.subscriberBufferMaxBytes = nonNegativeHardBound(
      options.subscriberBufferMaxBytes,
      PROTOCOL_V4_LIMITS.subscriberBufferMaxBytes,
      "subscriberBufferMaxBytes",
    );
    this.wireSnapshotBytesUpperBound = this.measureWireSnapshotBytes(this.getWireSnapshot());
  }

  getSnapshot(): ConversationSnapshot {
    return this.projection.getSnapshot();
  }

  
  setRuntimeInitialization(
    state: NonNullable<ConversationSnapshot["runtimeInitialization"]>,
  ): void {
    this.projection.setRuntimeInitialization(state);
    this.wireSnapshotBytesUpperBound = this.measureWireSnapshotBytes(this.getWireSnapshot());
    this.appendDeltas(this.currentSeq, [
      { op: "state.updated", patch: statePatchSchema.parse(this.getSnapshot()) },
    ]);
  }

  
  getWireSnapshotLogicalBytes(): number {
    return this.measureWireSnapshotBytes(this.getWireSnapshot());
  }

  resolveStableForkCandidate(rowId: number): StableForkCandidateResolution {
    return this.projection.resolveStableForkCandidate(rowId);
  }

  
  seedConfig(seed: SessionConfigSeed): void {
    this.projection.seedConfig(seed);
    this.wireSnapshotBytesUpperBound = this.measureWireSnapshotBytes(this.getWireSnapshot());
  }

  
  seedSharedContextImport(
    source: ConversationSnapshot["sharedContextImport"] | null | undefined,
  ): void {
    this.projection.seedSharedContextImport(source);
    this.wireSnapshotBytesUpperBound = this.measureWireSnapshotBytes(this.getWireSnapshot());
  }

  
  seedUsage(seed: SessionUsageSeed): void {
    this.projection.seedUsage(seed);
    this.wireSnapshotBytesUpperBound = this.measureWireSnapshotBytes(this.getWireSnapshot());
  }

  
  seedSubagents(seed: SessionSubagentsSeed): void {
    this.projection.seedSubagents(seed);
    this.wireSnapshotBytesUpperBound = this.measureWireSnapshotBytes(this.getWireSnapshot());
  }

  
  private getWireSnapshot(snapshot = this.projection.getSnapshot()): ConversationSnapshot {
    return this.getWireSnapshotForProfile(DELIVERY_PROFILES.continuous, snapshot);
  }

  private getWireSnapshotForProfile(
    profile: DeliveryProfile,
    snapshot = this.projection.getSnapshot(),
  ): ConversationSnapshot {
    const visibleRows = filterConversationRowsForProfile(snapshot.rows.window, profile);
    const visibleSnapshot: ConversationSnapshot = {
      ...snapshot,
      rows: {
        ...snapshot.rows,
        window: visibleRows,
        totalCount: visibleRows.length,
        firstRowId: visibleRows[0]?.rowId ?? null,
      },
    };
    const limit = PROTOCOL_V4_LIMITS.snapshotTailWindowRows;
    if (visibleRows.length <= limit) return visibleSnapshot;
    return {
      ...visibleSnapshot,
      rows: { ...visibleSnapshot.rows, window: visibleRows.slice(-limit) },
    };
  }

  
  private getWireSnapshotForSubscription(subscription: Subscription): ConversationSnapshot {
    const snapshot = this.getWireSnapshotForProfile(subscription.profile);
    if (subscription.workflowRunDeltas || snapshot.workflowRuns === undefined) return snapshot;
    const workflowRuns = clampWorkflowRunsForLegacy(snapshot.workflowRuns);
    return workflowRuns === snapshot.workflowRuns ? snapshot : { ...snapshot, workflowRuns };
  }

  
  private encodeDeltasForSubscription(
    deltas: readonly ConversationDelta[],
    subscription: Subscription,
  ): readonly ConversationDelta[] {
    const filtered = filterConversationDeltasForProfile(deltas, subscription.profile);
    if (subscription.workflowRunDeltas) return filtered;
    return encodeConversationDeltasForLegacy(filtered, this.projection.getSnapshot().workflowRuns);
  }

  
  measureInputAdmissionProjectionBytes(
    envelope: CommandEnvelope,
    admission: { admissionSeq: number; admittedAt: number; queueItemId: string },
  ): number | null {
    const raw = envelope.payload as {
      text?: string;
      displayText?: string;
      attachments?: QueueItem["attachments"];
      firstInput?: { text: string; attachments?: QueueItem["attachments"] };
    };
    const input = envelope.type === "createSession" ? raw.firstInput : raw;
    if (
      !input ||
      (envelope.type !== "createSession" &&
        envelope.type !== "sendText" &&
        envelope.type !== "sendGoalCommand" &&
        envelope.type !== "compact")
    ) {
      return null;
    }
    const snapshot = this.projection.getSnapshot();
    const queueItem: QueueItem = {
      sourceCommandId: envelope.commandId,
      queueItemId: admission.queueItemId,
      clientId: envelope.clientId || "cli",
      kind:
        envelope.type === "compact"
          ? "compact"
          : envelope.type === "sendGoalCommand"
            ? "sendGoalCommand"
            : "sendText",
      text:
        envelope.type === "compact"
          ? "/compact"
          : envelope.type === "sendGoalCommand"
            ? raw.displayText?.trim() || `/goal ${(input.text ?? "").trim()}`
            : (input.text ?? ""),
      attachments: input.attachments ?? [],
      delivery: { requested: "queue", admitted: "queue" },
      order: {
        admissionSeq: admission.admissionSeq,
        queuePosition: snapshot.queue.items.length,
      },
      steer: { state: "notRequested" },
      dispatch: { state: "queued" },
      admittedAt: admission.admittedAt,
    };
    const candidate: ConversationSnapshot = {
      ...snapshot,
      queue: { ...snapshot.queue, items: [...snapshot.queue.items, queueItem] },
    };
    return this.measureWireSnapshotBytes(this.getWireSnapshot(candidate));
  }

  private measureWireSnapshotBytes(snapshot: ConversationSnapshot): number {
    const frame: ConversationTopicFrame = {
      topic: this.topic,
      subscriptionId: `sub-${this.logEpoch}-${Number.MAX_SAFE_INTEGER}`,
      fromSeq: 0,
      toSeq: snapshot.seq,
      sentAt: Number.MAX_SAFE_INTEGER,
      payload: { kind: "snapshot", snapshot },
    };
    return utf8JsonByteLength(frame);
  }

  
  getRowsRange(
    params: { beforeRowId?: number; limit: number },
    deliveryProfile: DeliveryProfileName = "replayable",
  ): V4ConversationRowsRangeResult {
    const snapshot = this.projection.getSnapshot();
    const limit = Math.max(1, Math.min(params.limit, PROTOCOL_V4_LIMITS.rowsRangeMaxLimit));
    const visibleRows = filterConversationRowsForProfile(
      snapshot.rows.window,
      DELIVERY_PROFILES[deliveryProfile],
    );
    const eligible =
      params.beforeRowId === undefined
        ? visibleRows
        : visibleRows.filter((row) => row.rowId < (params.beforeRowId as number));
    const rows = eligible.slice(-limit);
    return {
      rows,
      atSeq: snapshot.seq,
      atRevision: snapshot.revision,
      atLogEpoch: this.logEpoch,
      hasMore: eligible.length > rows.length,
    };
  }

  
  getPlans(): V4ConversationPlansResult {
    const snapshot = this.projection.getSnapshot();
    const plans = snapshot.rows.window
      .filter(
        (row): row is ToolCallRow =>
          row.kind === "toolCall" &&
          row.toolName === "ExitPlanMode" &&
          TERMINAL_PLAN_STATUSES.has(row.status) &&
          hasPlanMarkdown(row),
      )
      .toSorted((left, right) => right.rowId - left.rowId);
    return {
      plans,
      atSeq: snapshot.seq,
      atLogEpoch: this.logEpoch,
    };
  }

  
  getMessageIdForRow(rowId: number): string | null {
    return this.projection.getMessageIdForRow(rowId);
  }

  resolveRowActionTarget(
    target: ConversationRowTarget,
    action: ConversationRowTargetAction,
  ): ConversationRowTargetResolution {
    return this.projection.resolveRowActionTarget(target, action);
  }

  
  getMessageIdsForTurnRow(rowId: number): string[] {
    return this.projection.getMessageIdsForTurnRow(rowId);
  }

  
  isLatestAssistantSegmentRow(rowId: number): boolean {
    return this.projection.isLatestAssistantSegmentRow(rowId);
  }

  
  isLatestRetryAssistantRow(rowId: number): boolean {
    return this.projection.isLatestRetryAssistantRow(rowId);
  }

  
  isLatestEditableUserRow(rowId: number): boolean {
    return this.projection.isLatestEditableUserRow(rowId);
  }

  
  getTurnIdForRow(rowId: number): string | null {
    return this.projection.getTurnIdForRow(rowId);
  }

  
  getDroppedContentStreamEventCount(): number {
    return this.projection.getDroppedContentStreamEventCount();
  }

  
  getTurnRewindAnchor(rowId: number): string | null {
    return this.projection.getTurnRewindAnchor(rowId);
  }

  private get currentSeq(): number {
    return this.projection.getSnapshot().seq;
  }

  
  ingest(event: SessionEvent): void {
    const projectionLimit =
      event.type === SessionEventType.TurnComplete || event.type === SessionEventType.TurnError
        ? PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxBytes
        : PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxBytes - PROJECTION_TERMINAL_RESERVE_BYTES;
    const streamingAppend = this.projection.establishedStreamingAppend(event);
    const streamingUpperBound =
      streamingAppend === null ? null : utf8JsonByteLength(streamingAppend) + 64;
    let deltas: ConversationDelta[] | null;
    if (
      streamingUpperBound !== null &&
      this.wireSnapshotBytesUpperBound + streamingUpperBound <= projectionLimit
    ) {
      deltas = this.projection.applyEvent(event);
      this.wireSnapshotBytesUpperBound += streamingUpperBound;
    } else {
      let candidateBytes = 0;
      let nextUpperBound = 0;
      deltas = this.projection.applyEventAtomically(event, (snapshot, produced) => {
        const growth = workflowRunDeltaGrowthUpperBound(produced);
        if (growth !== null && this.wireSnapshotBytesUpperBound + growth <= projectionLimit) {
          nextUpperBound = this.wireSnapshotBytesUpperBound + growth;
          return true;
        }
        candidateBytes = this.measureWireSnapshotBytes(this.getWireSnapshot(snapshot));
        nextUpperBound = candidateBytes;
        return candidateBytes <= projectionLimit;
      });
      if (deltas === null) throw new ProjectionPayloadTooLargeError(candidateBytes);
      this.wireSnapshotBytesUpperBound = nextUpperBound;
    }
    this.appendDeltas(event.sequenceNumber, deltas);
  }

  private appendDeltas(seq: number, deltas: ConversationDelta[]): void {
    this.log.push({ seq, deltas });
    while (this.log.length > this.retention) {
      const evicted = this.log.shift();
      if (evicted) this.floorSeq = evicted.seq;
    }
    if (deltas.length === 0) return;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.resyncRequired) continue;
      const filtered = this.encodeDeltasForSubscription(deltas, subscription);
      const next = appendConversationSubscriberBuffer(
        subscription.buffer,
        filtered,
        this.subscriberBufferLimits(),
      );
      if (next.kind === "overflow") {
        subscription.buffer = [];
        subscription.bufferBytes = 0;
        subscription.resyncRequired = true;
        continue;
      }
      subscription.buffer = next.deltas;
      subscription.bufferBytes = next.encodedBytes;
    }
  }

  
  rehydrate(
    events: readonly SessionEvent[],
    options: { onPayloadTooLarge?: (error: ProjectionPayloadTooLargeError) => void } = {},
  ): void {
    let candidate = new ConversationTopicPublisher(this.sessionId, this.logEpoch, {
      now: this.now,
      retention: this.retention,
      subscriberBufferMaxOps: this.subscriberBufferMaxOps,
      subscriberBufferMaxBytes: this.subscriberBufferMaxBytes,
    });
    const usedBatchHydration = candidate.tryBatchHydration(events);
    if (!usedBatchHydration) {
      candidate = new ConversationTopicPublisher(this.sessionId, this.logEpoch, {
        now: this.now,
        retention: this.retention,
        subscriberBufferMaxOps: this.subscriberBufferMaxOps,
        subscriberBufferMaxBytes: this.subscriberBufferMaxBytes,
      });
      for (const event of events) {
        try {
          candidate.ingest(event);
        } catch (error) {
          if (!(error instanceof ProjectionPayloadTooLargeError)) throw error;
          if (!options.onPayloadTooLarge) throw error;
          options.onPayloadTooLarge(error);
        }
      }
    }

    const previous = this.projection.getSnapshot();
    if (previous.runtimeInitialization) {
      candidate.projection.setRuntimeInitialization(
        previous.runtimeInitialization,
        previous.seq + 1,
        previous.revision + 1,
      );
    }
    this.projection = candidate.projection;
    const current = this.getSnapshot();
    if (
      previous.runtimeInitialization &&
      previous.rows.window.length === current.rows.window.length &&
      previous.rows.window.every(
        (row, index) =>
          row.rowId === current.rows.window[index]?.rowId &&
          row.kind === current.rows.window[index]?.kind,
      )
    ) {
      const deltas: ConversationDelta[] = [
        { op: "state.updated", patch: statePatchSchema.parse(current) },
      ];
      current.rows.window.forEach((row, index) => {
        if (JSON.stringify(row) !== JSON.stringify(previous.rows.window[index]))
          deltas.push({ op: "row.upserted", row });
      });
      this.wireSnapshotBytesUpperBound = this.measureWireSnapshotBytes(this.getWireSnapshot());
      this.appendDeltas(current.seq, deltas);
      return;
    }

    if (usedBatchHydration || previous.runtimeInitialization) {
      this.log.splice(0, this.log.length);
      this.floorSeq = candidate.currentSeq;
    } else {
      this.log.splice(0, this.log.length, ...candidate.log);
      this.floorSeq = candidate.floorSeq;
    }
    this.wireSnapshotBytesUpperBound = candidate.wireSnapshotBytesUpperBound;
    for (const subscription of this.subscriptions.values()) {
      subscription.buffer = [];
      subscription.bufferBytes = 0;
      subscription.resyncRequired = true;
      subscription.sentSeq = 0;
      subscription.inFlight = null;
    }
  }

  
  private tryBatchHydration(events: readonly SessionEvent[]): boolean {
    this.projection.beginHydrationReplay();
    let measuredBytes = this.wireSnapshotBytesUpperBound;
    let measuredSequenceNumberBytes = hydrationSequenceNumberBytes(
      this.projection.getSnapshot().seq,
    );
    let encodedGrowthSinceMeasurement = 0;

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]!;
      const deltas = this.projection.applyHydrationEvent(event);
      const finalEvent = index === events.length - 1;
      const projectionLimit = this.projectionLimitForEvent(event);
      const mustMeasureSnapshot = finalEvent || deltas.some((delta) => delta.op === "row.removed");

      if (finalEvent) this.projection.completeHydrationReplay();
      const snapshot = this.projection.getSnapshot();
      if (!mustMeasureSnapshot && deltas.length > 0) {
        let wireRowIds: Set<number> | undefined;
        const wireDeltas = deltas.filter((delta) => {
          if (delta.op === "state.updated" || delta.op === "row.appended") return true;
          if (delta.op === "row.removed") return false;
          if (
            delta.op === "pluginUi.resourceUpdated" ||
            delta.op === "pluginUi.resourceListChanged" ||
            delta.op === "pluginUi.appToolCall" ||
            delta.op === "pluginUi.instanceClosed"
          )
            return false;
          if (delta.op === "workflowRun.updated" || delta.op === "workflowRun.removed") return true;
          wireRowIds ??= new Set(
            snapshot.rows.window
              .slice(-PROTOCOL_V4_LIMITS.snapshotTailWindowRows)
              .map((row) => row.rowId),
          );
          const rowId = delta.op === "row.upserted" ? delta.row.rowId : delta.rowId;
          return wireRowIds.has(rowId);
        });
        if (wireDeltas.length > 0) {
          encodedGrowthSinceMeasurement +=
            coldHydrationJsonByteLength({ kind: "deltas", deltas: wireDeltas }) +
            HYDRATION_EVENT_WIRE_OVERHEAD_BYTES;
        }
      }

      const actionBytesUpperBound = finalEvent
        ? 0
        : Math.min(snapshot.rows.window.length, PROTOCOL_V4_LIMITS.snapshotTailWindowRows) *
          HYDRATION_ACTION_BYTES_PER_WIRE_ROW;
      const currentSequenceNumberBytes = hydrationSequenceNumberBytes(snapshot.seq);
      const sequenceNumberGrowth = Math.max(
        0,
        currentSequenceNumberBytes - measuredSequenceNumberBytes,
      );
      let upperBound =
        measuredBytes +
        encodedGrowthSinceMeasurement +
        sequenceNumberGrowth +
        actionBytesUpperBound;
      if (mustMeasureSnapshot || upperBound > projectionLimit) {
        measuredBytes = this.measureWireSnapshotBytes(this.getWireSnapshot());
        measuredSequenceNumberBytes = currentSequenceNumberBytes;
        encodedGrowthSinceMeasurement = 0;
        upperBound = measuredBytes + actionBytesUpperBound;
      }
      if (upperBound > projectionLimit) return false;
    }

    if (events.length === 0) {
      this.projection.completeHydrationReplay();
      measuredBytes = this.measureWireSnapshotBytes(this.getWireSnapshot());
    }
    this.wireSnapshotBytesUpperBound = measuredBytes;
    return true;
  }

  private projectionLimitForEvent(event: SessionEvent): number {
    return event.type === SessionEventType.TurnComplete || event.type === SessionEventType.TurnError
      ? PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxBytes
      : PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxBytes - PROJECTION_TERMINAL_RESERVE_BYTES;
  }

  
  subscribe(params: ConversationSubscribeParams): ConversationSubscribeResult {
    const result = this.subscribeReserved(params);
    result.reservation?.commit();
    return result;
  }

  
  subscribeReserved(params: ConversationSubscribeParams): ConversationSubscribeResult {
    const previousId = this.subscriptionIdByConnection.get(params.connectionId);
    const previousSubscription =
      previousId === undefined ? undefined : this.subscriptions.get(previousId);
    if (previousId !== undefined) this.subscriptions.delete(previousId);

    const profile = DELIVERY_PROFILES[params.deliveryProfile ?? "replayable"];
    const subscription: Subscription = {
      subscriptionId: `sub-${this.logEpoch}-${this.nextSubscriptionSerial++}`,
      connectionId: params.connectionId,
      profile,
      workflowRunDeltas: params.workflowRunDeltas === true,
      buffer: [],
      bufferBytes: 0,
      resyncRequired: false,
      sentSeq: 0,
      inFlight: null,
      nextLogicalFrameOrdinal: 1,
    };
    this.subscriptions.set(subscription.subscriptionId, subscription);
    this.subscriptionIdByConnection.set(params.connectionId, subscription.subscriptionId);
    const rollback = (): boolean => {
      if (
        subscription.inFlight === null ||
        this.subscriptions.get(subscription.subscriptionId) !== subscription ||
        this.subscriptionIdByConnection.get(params.connectionId) !== subscription.subscriptionId
      ) {
        return false;
      }
      this.subscriptions.delete(subscription.subscriptionId);
      if (previousId !== undefined && previousSubscription) {
        this.subscriptions.set(previousId, previousSubscription);
        this.subscriptionIdByConnection.set(params.connectionId, previousId);
      } else {
        this.subscriptionIdByConnection.delete(params.connectionId);
      }
      return true;
    };

    const base = params.base;
    const resumable =
      base !== undefined &&
      base.logEpoch === this.logEpoch &&
      base.seq >= this.floorSeq &&
      base.seq <= this.currentSeq;

    if (!resumable) {
      const reservation = this.reserveFrame(
        subscription,
        {
          ...this.frameShell(subscription),
          fromSeq: 0,
          toSeq: this.currentSeq,
          payload: {
            kind: "snapshot",
            snapshot: this.getWireSnapshotForSubscription(subscription),
          },
        },
        false,
        "initial",
      );
      return this.subscribeResult(this.ackFor(subscription, "snapshot"), reservation, rollback);
    }

    const replay = coalesceConversationDeltas(
      this.encodeDeltasForSubscription(
        this.log.flatMap((entry) => (entry.seq > base.seq ? entry.deltas : [])),
        subscription,
      ),
    );
    if (base.seq === this.currentSeq) {
      subscription.sentSeq = base.seq;
      return this.subscribeResult(this.ackFor(subscription, "resume"), null, () => false);
    }
    subscription.sentSeq = base.seq;
    const reservation = this.reserveFrame(
      subscription,
      {
        ...this.frameShell(subscription),
        fromSeq: base.seq,
        toSeq: this.currentSeq,
        payload: { kind: "deltas", deltas: replay },
      },
      false,
      "initial",
    );
    return this.subscribeResult(this.ackFor(subscription, "resume"), reservation, rollback);
  }

  unsubscribe(subscriptionId: string, connectionId?: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return;
    if (connectionId !== undefined && subscription.connectionId !== connectionId) {
      return;
    }
    this.subscriptions.delete(subscriptionId);
    if (this.subscriptionIdByConnection.get(subscription.connectionId) === subscriptionId) {
      this.subscriptionIdByConnection.delete(subscription.connectionId);
    }
  }

  hasSubscription(subscriptionId: string, connectionId?: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    return Boolean(
      subscription && (connectionId === undefined || subscription.connectionId === connectionId),
    );
  }

  
  hasSubscribers(): boolean {
    return this.subscriptions.size > 0;
  }

  connectionIdForSubscription(subscriptionId: string): string | null {
    return this.subscriptions.get(subscriptionId)?.connectionId ?? null;
  }

  
  reserveFlush(subscriptionId: string): TopicFrameReservation<ConversationTopicFrame> | null {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return null;
    if (subscription.inFlight) return subscription.inFlight;
    if (subscription.resyncRequired) {
      subscription.buffer = [];
      subscription.bufferBytes = 0;
      return this.reserveFrame(
        subscription,
        {
          ...this.frameShell(subscription),
          fromSeq: 0,
          toSeq: this.currentSeq,
          payload: {
            kind: "snapshot",
            snapshot: this.getWireSnapshotForSubscription(subscription),
          },
        },
        true,
        "online",
      );
    }
    if (subscription.buffer.length === 0 && subscription.sentSeq === this.currentSeq) {
      return null;
    }
    const deltas = subscription.buffer;
    const frame: ConversationTopicFrame = {
      ...this.frameShell(subscription),
      fromSeq: subscription.sentSeq,
      toSeq: this.currentSeq,
      payload: { kind: "deltas", deltas },
    };
    subscription.buffer = [];
    subscription.bufferBytes = 0;
    return this.reserveFrame(subscription, frame, false, "online");
  }

  
  flush(subscriptionId: string): ConversationTopicFrame | null {
    const reservation = this.reserveFlush(subscriptionId);
    if (!reservation || !reservation.commit()) return null;
    return reservation.frame;
  }

  
  resyncReserved(
    subscriptionId: string,
    request: ConversationResyncRequest,
  ): ConversationSubscribeResult | null {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return null;

    const previous = {
      buffer: subscription.buffer,
      bufferBytes: subscription.bufferBytes,
      resyncRequired: subscription.resyncRequired,
      sentSeq: subscription.sentSeq,
      inFlight: subscription.inFlight,
    };

    subscription.inFlight = null;
    subscription.buffer = [];
    subscription.bufferBytes = 0;
    subscription.resyncRequired = false;

    const base = request.base;
    const resumable =
      !request.forceSnapshot &&
      base !== null &&
      base.logEpoch === this.logEpoch &&
      base.seq >= this.floorSeq &&
      base.seq <= this.currentSeq;

    if (!resumable) {
      subscription.sentSeq = 0;
      const reservation = this.reserveFrame(
        subscription,
        {
          ...this.frameShell(subscription),
          fromSeq: 0,
          toSeq: this.currentSeq,
          payload: {
            kind: "snapshot",
            snapshot: this.getWireSnapshotForSubscription(subscription),
          },
        },
        false,
        "recovery",
      );
      return this.subscribeResult(
        this.ackFor(subscription, "snapshot"),
        reservation,
        this.resyncRollback(subscription, reservation, previous),
      );
    }

    subscription.sentSeq = base.seq;
    const replay = coalesceConversationDeltas(
      this.encodeDeltasForSubscription(
        this.log.flatMap((entry) => (entry.seq > base.seq ? entry.deltas : [])),
        subscription,
      ),
    );
    const reservation = this.reserveFrame(
      subscription,
      {
        ...this.frameShell(subscription),
        fromSeq: base.seq,
        toSeq: this.currentSeq,
        payload: { kind: "deltas", deltas: replay },
      },
      false,
      "recovery",
    );
    return this.subscribeResult(
      this.ackFor(subscription, "resume"),
      reservation,
      this.resyncRollback(subscription, reservation, previous),
    );
  }

  private resyncRollback(
    subscription: Subscription,
    reservation: TopicFrameReservation<ConversationTopicFrame>,
    previous: Pick<
      Subscription,
      "buffer" | "bufferBytes" | "resyncRequired" | "sentSeq" | "inFlight"
    >,
  ): () => boolean {
    let rolledBack = false;
    return (): boolean => {
      if (rolledBack) return true;
      if (
        this.subscriptions.get(subscription.subscriptionId) !== subscription ||
        subscription.inFlight !== reservation
      ) {
        return false;
      }
      const recoveryBuffer = subscription.buffer;
      const recoveryResyncRequired = subscription.resyncRequired;
      const merged = appendConversationSubscriberBuffer(
        previous.buffer,
        recoveryBuffer,
        this.subscriberBufferLimits(),
      );
      if (merged.kind === "overflow" || previous.resyncRequired || recoveryResyncRequired) {
        subscription.buffer = [];
        subscription.bufferBytes = 0;
        subscription.resyncRequired = true;
      } else {
        subscription.buffer = merged.deltas;
        subscription.bufferBytes = merged.encodedBytes;
        subscription.resyncRequired = false;
      }
      subscription.sentSeq = previous.sentSeq;
      subscription.inFlight = previous.inFlight;
      rolledBack = true;
      return true;
    };
  }

  private subscriberBufferLimits(): ConversationSubscriberBufferLimits {
    return {
      maxOps: this.subscriberBufferMaxOps,
      maxBytes: this.subscriberBufferMaxBytes,
      snapshotBytesUpperBound: this.wireSnapshotBytesUpperBound,
    };
  }

  
  resync(subscriptionId: string): ConversationTopicFrame | null {
    const reservation = this.resyncReserved(subscriptionId, {
      base: null,
      forceSnapshot: true,
    })?.reservation;
    if (!reservation || !reservation.commit()) return null;
    return reservation.frame;
  }

  private reserveFrame(
    subscription: Subscription,
    frame: ConversationTopicFrame,
    snapshotRecovery: boolean,
    deliveryKind: TopicFrameDeliveryKind,
  ): TopicFrameReservation<ConversationTopicFrame> {
    let committed = false;
    const reservation: TopicFrameReservation<ConversationTopicFrame> = {
      deliveryKind,
      logicalFrameId: `${subscription.subscriptionId}-lf-${this.nextLogicalFrameSerial++}`,
      logicalFrameOrdinal: subscription.nextLogicalFrameOrdinal++,
      frame,
      commit: () => {
        if (committed) return true;
        if (
          this.subscriptions.get(subscription.subscriptionId) !== subscription ||
          subscription.inFlight !== reservation
        ) {
          return false;
        }
        subscription.sentSeq = frame.toSeq;
        subscription.inFlight = null;
        if (snapshotRecovery) {
          subscription.resyncRequired = this.currentSeq > frame.toSeq;
        }
        committed = true;
        return true;
      },
    };
    subscription.inFlight = reservation;
    return reservation;
  }

  private subscribeResult(
    ack: SubscribeAck,
    reservation: TopicFrameReservation<ConversationTopicFrame> | null,
    rollback: () => boolean,
  ): ConversationSubscribeResult {
    return {
      ack,
      reservation,
      rollback,
      get frame() {
        reservation?.commit();
        return reservation?.frame ?? null;
      },
    };
  }

  private ackFor(subscription: Subscription, mode: SubscribeAck["mode"]): SubscribeAck {
    return {
      subscriptionId: subscription.subscriptionId,
      mode,
      logEpoch: this.logEpoch,
    };
  }

  private frameShell(
    subscription: Subscription,
  ): Pick<ConversationTopicFrame, "topic" | "subscriptionId" | "sentAt"> {
    return {
      topic: this.topic,
      subscriptionId: subscription.subscriptionId,
      sentAt: this.now(),
    };
  }
}
