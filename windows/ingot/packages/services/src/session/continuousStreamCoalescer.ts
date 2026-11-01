import type { CfStreamEvent } from "@origin-ai/cf-shared";

const CONTINUOUS_CHUNK_FLUSH_DELAY_MS = 16;
const CONTINUOUS_CHUNK_MAX_CHARS = 4096;
const CONTINUOUS_CHUNK_MAX_EVENTS = 128;
const CONTINUOUS_CHUNK_KEY_SEPARATOR = "\u0000";

type ContinuousCoalescibleChunk =
  | Extract<CfStreamEvent, { type: "agent_message_chunk" }>
  | Extract<CfStreamEvent, { type: "agent_thought_chunk" }>;

type ContinuousCoalescibleState =
  | Extract<CfStreamEvent, { type: "usage_update" }>
  | Extract<CfStreamEvent, { type: "session_info_update" }>;

interface PendingContinuousChunkItem {
  kind: "chunk";
  event: ContinuousCoalescibleChunk;
  chunkCount: number;
  charCount: number;
}

interface PendingContinuousStateItem {
  kind: "state";
  event: ContinuousCoalescibleState;
  stateKey: string;
}

type PendingContinuousItem = PendingContinuousChunkItem | PendingContinuousStateItem;

interface ContinuousStreamCoalescer {
  accept(event: CfStreamEvent): void;
  flush(): void;
  dispose(): void;
}

function isContinuousCoalescibleChunk(event: CfStreamEvent): event is ContinuousCoalescibleChunk {
  return (
    event.type === "agent_thought_chunk" ||
    (event.type === "agent_message_chunk" && !event.cfTimeline)
  );
}

function isContinuousCoalescibleState(event: CfStreamEvent): event is ContinuousCoalescibleState {
  if (event.type === "usage_update") {
    return true;
  }

  return (
    event.type === "session_info_update" &&
    event.title === undefined &&
    event.target === undefined &&
    "apiRetry" in event
  );
}

function normalizeChunkParentToolUseId(event: ContinuousCoalescibleChunk): string {
  return event.parentToolUseId ?? "";
}

function getContinuousChunkMergeKey(event: ContinuousCoalescibleChunk): string {
  return [
    event.type,
    event.taskId,
    event.traceId,
    normalizeChunkParentToolUseId(event),
    event.type === "agent_message_chunk" ? event.messageId ?? "" : "",
  ].join(CONTINUOUS_CHUNK_KEY_SEPARATOR);
}

function getContinuousStateMergeKey(event: ContinuousCoalescibleState): string {
  return [
    event.type,
    event.taskId,
    event.traceId,
  ].join(CONTINUOUS_CHUNK_KEY_SEPARATOR);
}

function mergeContinuousChunks(
  current: ContinuousCoalescibleChunk,
  next: ContinuousCoalescibleChunk,
): ContinuousCoalescibleChunk {
  return {
    ...current,
    content: `${current.content}${next.content}`,
  };
}

export function createContinuousStreamCoalescer(params: {
  emit: (event: CfStreamEvent) => void;
  flushDelayMs?: number;
  maxChars?: number;
  maxEvents?: number;
}): ContinuousStreamCoalescer {
  const flushDelayMs = params.flushDelayMs ?? CONTINUOUS_CHUNK_FLUSH_DELAY_MS;
  const maxChars = params.maxChars ?? CONTINUOUS_CHUNK_MAX_CHARS;
  const maxEvents = params.maxEvents ?? CONTINUOUS_CHUNK_MAX_EVENTS;
  let pendingItems: PendingContinuousItem[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function clearFlushTimer(): void {
    if (!flushTimer) {
      return;
    }
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  function flushPending(): void {
    if (pendingItems.length === 0) {
      clearFlushTimer();
      return;
    }
    const events = pendingItems.map((item) => item.event);
    pendingItems = [];
    clearFlushTimer();
    for (const event of events) {
      params.emit(event);
    }
  }

  function scheduleFlush(): void {
    if (flushTimer || disposed || flushDelayMs <= 0) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPending();
    }, flushDelayMs);
  }

  function startPendingChunk(event: ContinuousCoalescibleChunk): void {
    pendingItems.push({
      kind: "chunk",
      event,
      chunkCount: 1,
      charCount: event.content.length,
    });
    if (event.content.length >= maxChars || pendingItems.length >= maxEvents || flushDelayMs <= 0) {
      flushPending();
      return;
    }
    scheduleFlush();
  }

  function acceptPendingState(event: ContinuousCoalescibleState): void {
    const stateKey = getContinuousStateMergeKey(event);
    const existingItem = pendingItems.find(
      (item): item is PendingContinuousStateItem =>
        item.kind === "state" && item.stateKey === stateKey,
    );
    if (existingItem) {
      existingItem.event = event;
      return;
    }

    pendingItems.push({ kind: "state", event, stateKey });
    if (pendingItems.length >= maxEvents || flushDelayMs <= 0) {
      flushPending();
      return;
    }
    scheduleFlush();
  }

  return {
    accept(event: CfStreamEvent): void {
      if (disposed) {
        return;
      }

      if (isContinuousCoalescibleState(event)) {
        acceptPendingState(event);
        return;
      }

      if (!isContinuousCoalescibleChunk(event)) {
        flushPending();
        params.emit(event);
        return;
      }

      const lastItem = pendingItems[pendingItems.length - 1];
      if (!lastItem) {
        startPendingChunk(event);
        return;
      }

      if (
        lastItem.kind !== "chunk" ||
        getContinuousChunkMergeKey(lastItem.event) !== getContinuousChunkMergeKey(event)
      ) {
        startPendingChunk(event);
        return;
      }

      const nextItem: PendingContinuousChunkItem = {
        kind: "chunk",
        event: mergeContinuousChunks(lastItem.event, event),
        chunkCount: lastItem.chunkCount + 1,
        charCount: lastItem.charCount + event.content.length,
      };
      pendingItems[pendingItems.length - 1] = nextItem;
      if (nextItem.charCount >= maxChars || nextItem.chunkCount >= maxEvents) {
        flushPending();
      }
    },

    flush(): void {
      flushPending();
    },

    dispose(): void {
      disposed = true;
      pendingItems = [];
      clearFlushTimer();
    },
  };
}
