import { ConversationProjectionStore } from "@/v4/conversationProjectionStore.js";
import { ConversationRowPool } from "@/v4/conversationRowSharing.js";
import { shouldExposeE2EStoreBridge } from "@/lib/e2eStoreBridge.js";
import type { SessionOpenKind } from "@/lib/sessionOpenArmsTelemetry.js";
import { conversationTopic, type ConversationTransport } from "@/v4/transport.js";
import { logger } from "@/logger.js";
import type { CommandsQueryParams, CommandsQueryResult } from "@origin-ai/cf-shared/cf-protocol-v4";

export interface SessionLease {
  readonly sessionId: string;
  readonly store: ConversationProjectionStore;
  
  readonly openKind: SessionOpenKind;
  
  readonly startedAt: number;
  release(): void;
}

export interface SessionDataLayerOptions {
  transport: ConversationTransport;
  
  keepWarmMs?: number;
}

export const SESSION_DATA_LAYER_KEEP_WARM_MS = 30_000;
export const E2E_SESSION_DATA_LAYER_KEEP_WARM_MS = 1_000;

export function resolveSessionDataLayerKeepWarmMs(
  e2eStoreBridgeEnabled = shouldExposeE2EStoreBridge(),
): number {
  return e2eStoreBridgeEnabled
    ? E2E_SESSION_DATA_LAYER_KEEP_WARM_MS
    : SESSION_DATA_LAYER_KEEP_WARM_MS;
}

interface SessionEntry {
  store: ConversationProjectionStore;
  refCount: number;
  keepWarmTimer: ReturnType<typeof setTimeout> | null;
}

function monotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export class SessionDataLayer {
  private readonly transport: ConversationTransport;
  private readonly keepWarmMs: number;
  private readonly entries = new Map<string, SessionEntry>();
  // （docs/performance/conversation-row-structural-sharing.md）。
  private readonly rowPool = new ConversationRowPool();
  private readonly offFrame: () => void;
  private disposed = false;

  constructor(options: SessionDataLayerOptions) {
    this.transport = options.transport;
    this.keepWarmMs = options.keepWarmMs ?? resolveSessionDataLayerKeepWarmMs();
    this.offFrame = this.transport.onFrame((frame, context) => {
      this.entries.get(frame.topic)?.store.handleFrame(frame, context);
    });
  }

  
  acquire(sessionId: string): SessionLease {
    if (this.disposed) {
      throw new Error("SessionDataLayer has been disposed and cannot be acquired again");
    }
    const topic = conversationTopic(sessionId);
    const startedAt = monotonicNow();
    let entry = this.entries.get(topic);
    let openKind: SessionOpenKind;
    if (entry) {
      openKind = entry.keepWarmTimer !== null ? "keep_warm" : "warm";
      entry.refCount++;
      if (entry.keepWarmTimer !== null) {
        clearTimeout(entry.keepWarmTimer);
        entry.keepWarmTimer = null;
      }
    } else {
      const store = new ConversationProjectionStore(topic, this.transport, this.rowPool);
      entry = { store, refCount: 1, keepWarmTimer: null };
      this.entries.set(topic, entry);
      openKind = "cold";
      void store.connect({ rendererPrepareStartedAt: startedAt });
    }
    logger.lifecycle.info("v4 session data lease acquired", {
      event: "v4.session_data.acquire",
      keepWarm: entry.keepWarmTimer !== null,
      module: "ui.v4.session_data_layer",
      openKind,
      refCount: entry.refCount,
      sessionId,
      status: "completed",
      topic,
    });

    let released = false;
    return {
      sessionId,
      store: entry.store,
      openKind,
      startedAt,
      release: () => {
        if (released) return;
        released = true;
        this.releaseEntry(topic);
      },
    };
  }

  
  get size(): number {
    return this.entries.size;
  }

  
  queryCommands(params: CommandsQueryParams): Promise<CommandsQueryResult> {
    return this.transport.queryCommands(params);
  }

  private releaseEntry(topic: string): void {
    const entry = this.entries.get(topic);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount > 0 || this.disposed) {
      logger.lifecycle.info("v4 session data lease released", {
        event: "v4.session_data.release",
        module: "ui.v4.session_data_layer",
        refCount: entry.refCount,
        status: "completed",
        topic,
      });
      return;
    }
    entry.keepWarmTimer = setTimeout(() => {
      this.entries.delete(topic);
      logger.lifecycle.info("v4 session data keep-warm expired", {
        event: "v4.session_data.keep_warm_expired",
        module: "ui.v4.session_data_layer",
        refCount: 0,
        status: "completed",
        topic,
      });
      void entry.store.close();
    }, this.keepWarmMs);
    logger.lifecycle.info("v4 session data lease released", {
      event: "v4.session_data.release",
      keepWarmMs: this.keepWarmMs,
      module: "ui.v4.session_data_layer",
      refCount: 0,
      status: "keep_warm",
      topic,
    });
  }

  
  dispose(): void {
    if (this.disposed) return;
    logger.lifecycle.info("v4 session data layer dispose started", {
      entryCount: this.entries.size,
      event: "v4.session_data.dispose.started",
      module: "ui.v4.session_data_layer",
      status: "started",
    });
    this.disposed = true;
    this.offFrame();
    for (const entry of this.entries.values()) {
      if (entry.keepWarmTimer !== null) {
        clearTimeout(entry.keepWarmTimer);
      }
      void entry.store.close();
    }
    this.entries.clear();
    logger.lifecycle.info("v4 session data layer dispose completed", {
      event: "v4.session_data.dispose.completed",
      module: "ui.v4.session_data_layer",
      status: "completed",
    });
  }
}
