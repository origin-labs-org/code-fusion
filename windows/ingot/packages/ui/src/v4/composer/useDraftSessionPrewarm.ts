
//
//
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { CommandAck, CommandType, SessionConfigState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { logger } from "@/logger.js";

type DispatchCommand = (
  type: CommandType,
  payload: Record<string, unknown>,
  targetSessionId: string | null,
) => Promise<CommandAck>;

export interface DraftPrewarmController {
  
  markPromotionPending(): void;
  
  markPromoted(): void;
  
  markDiscarded(): void;
  
  dispose(): void;
}

export function startDraftSessionPrewarm(params: {
  workspaceKey: string;
  dispatchCommand: DispatchCommand;
  onReady: (sessionId: string) => void;
  
  onSettled?: () => void;
  
  resolveInitialConfig?: () => Partial<SessionConfigState> | undefined;
}): DraftPrewarmController {
  const { workspaceKey, dispatchCommand, onReady, onSettled, resolveInitialConfig } = params;
  let disposed = false;
  let promotionState: "draft" | "pending" | "promoted" | "discarded" = "draft";
  let createdSessionId: string | null = null;

  const deleteCreatedSession = (sessionId: string) => {
    void dispatchCommand("deleteSession", {}, sessionId)
      .then((ack) => {
        if (ack.status !== "accepted" && ack.status !== "noop") {
          logger.warn("[v4-draft-prewarm] Prewarmed session cleanup rejected", {
            sessionId,
            status: ack.status,
            reasonCode: ack.reasonCode ?? null,
          });
        }
      })
      .catch(() => {
      });
  };

  const createPayload = () => {
    const createPayload: Record<string, unknown> = { workspaceId: workspaceKey };
    const initialConfig = resolveInitialConfig?.();
    if (initialConfig && Object.keys(initialConfig).length > 0) {
      createPayload.config = initialConfig;
    }
    return createPayload;
  };
  const dispatchCreateSession = () => {
    const createSessionPayload = createPayload();
    if (disposed) {
      return Promise.resolve(null);
    }
    return dispatchCommand("createSession", createSessionPayload, null);
  };
  const createSessionAck = dispatchCreateSession();
  void createSessionAck
    .then((ack) => {
      if (!ack) {
        return;
      }
      if (ack.status !== "accepted" || ack.result?.type !== "createSession") {
        logger.warn("[v4-draft-prewarm] createSession rejected", {
          status: ack.status,
          reasonCode: ack.reasonCode ?? null,
          workspaceKey,
        });
        return;
      }
      createdSessionId = ack.result.sessionId;
      if (disposed) {
        deleteCreatedSession(createdSessionId);
        return;
      }
      logger.info("[v4-draft-prewarm] draft session 预热就绪", {
        sessionId: createdSessionId,
        workspaceKey,
      });
      onReady(createdSessionId);
    })
    .catch((error) => {
      logger.warn("[v4-draft-prewarm] createSession 失败", {
        error: error instanceof Error ? error.message : String(error),
        workspaceKey,
      });
    })
    .finally(() => {
      onSettled?.();
    });

  return {
    markPromotionPending() {
      if (promotionState === "draft") {
        promotionState = "pending";
      }
    },
    markPromoted() {
      promotionState = "promoted";
    },
    markDiscarded() {
      if (promotionState !== "promoted") {
        promotionState = "discarded";
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (createdSessionId && promotionState === "draft") {
        deleteCreatedSession(createdSessionId);
      }
    },
  };
}

export interface DraftSessionPrewarm {
  
  binding: DraftPrewarmBinding | null;
  
  waitForSession(): Promise<DraftPrewarmBinding>;
}

export interface DraftPrewarmBinding {
  workspaceKey: string;
  sessionId: string;
  
  beginPromotion(): boolean;
  
  promote(): void;
  
  discard(): void;
}

interface DraftPrewarmSubscriber {
  generation: object;
  invalidationVersion: number;
  onBinding: (binding: DraftPrewarmBinding | null) => void;
}

interface DraftPrewarmCurrent {
  invalidationVersion: number;
  controller: DraftPrewarmController;
  binding: DraftPrewarmBinding | null;
  settled: boolean;
  completion: Promise<void>;
  retiring: boolean;
  
  retryAttempt: number;
}

const PREWARM_RETRY_DELAYS_MS = [500, 1000, 2000];

class DraftSessionPrewarmCoordinator {
  private readonly subscribers = new Map<symbol, DraftPrewarmSubscriber>();
  private current: DraftPrewarmCurrent | null = null;
  private blockedInvalidationVersion: number | null = null;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private dispatchCommand: DispatchCommand;
  private resolveInitialConfig: (() => Partial<SessionConfigState> | undefined) | undefined;

  constructor(
    private readonly workspaceKey: string,
    dispatchCommand: DispatchCommand,
    resolveInitialConfig: (() => Partial<SessionConfigState> | undefined) | undefined,
    private readonly onEmpty: () => void,
  ) {
    this.dispatchCommand = dispatchCommand;
    this.resolveInitialConfig = resolveInitialConfig;
  }

  update(
    dispatchCommand: DispatchCommand,
    resolveInitialConfig: (() => Partial<SessionConfigState> | undefined) | undefined,
  ): void {
    this.dispatchCommand = dispatchCommand;
    this.resolveInitialConfig = resolveInitialConfig;
  }

  async waitForSession(
    invalidationVersion: number,
    generation: object,
  ): Promise<DraftPrewarmBinding> {
    const assertCurrentSubscriber = () => {
      if (
        this.requestedInvalidationVersion() !== invalidationVersion ||
        !Array.from(this.subscribers.values()).some(
          (subscriber) => subscriber.generation === generation,
        )
      )
        throw new Error("Draft session has changed; please resend");
    };
    assertCurrentSubscriber();
    if (this.current?.retiring) {
      await this.current.completion;
      assertCurrentSubscriber();
    }
    if (this.current?.settled && !this.current.binding) {
      this.clearRetryTimer();
      this.blockedInvalidationVersion = null;
      this.current = null;
      this.startCurrent(invalidationVersion);
    }
    const current = this.current;
    if (!current) throw new Error("草稿会话尚未开始创建");
    await current.completion;
    assertCurrentSubscriber();
    if (
      this.current !== current ||
      current.retiring ||
      current.invalidationVersion !== invalidationVersion ||
      this.requestedInvalidationVersion() !== invalidationVersion
    )
      throw new Error("Draft session has changed; please resend");
    if (!current.binding) throw new Error("Failed to create draft session. Please try again");
    return current.binding;
  }

  acquire(params: {
    generation: object;
    invalidationVersion: number;
    onBinding: (binding: DraftPrewarmBinding | null) => void;
  }): () => void {
    if (this.cleanupTimer !== null) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    const token = Symbol("draft-prewarm-subscriber");
    this.subscribers.set(token, params);
    this.reconcile();
    this.emitBindingTo(params);

    return () => {
      if (!this.subscribers.delete(token) || this.subscribers.size > 0) {
        return;
      }
      this.cleanupTimer = setTimeout(() => {
        this.cleanupTimer = null;
        if (this.subscribers.size > 0) {
          return;
        }
        this.retireCurrent();
        if (!this.current) {
          this.onEmpty();
        }
      }, 0);
    };
  }

  private requestedInvalidationVersion(): number | null {
    let latest: number | null = null;
    for (const subscriber of this.subscribers.values()) {
      latest =
        latest === null
          ? subscriber.invalidationVersion
          : Math.max(latest, subscriber.invalidationVersion);
    }
    return latest;
  }

  private reconcile(): void {
    const requestedVersion = this.requestedInvalidationVersion();
    if (requestedVersion === null) {
      return;
    }
    if (
      this.blockedInvalidationVersion !== null &&
      this.blockedInvalidationVersion !== requestedVersion
    ) {
      this.blockedInvalidationVersion = null;
    }
    if (this.current) {
      if (!this.current.retiring && this.current.invalidationVersion === requestedVersion) {
        return;
      }
      this.retireCurrent();
      if (this.current) {
        return;
      }
    }
    if (this.blockedInvalidationVersion === requestedVersion) {
      return;
    }
    this.startCurrent(requestedVersion);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === null) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  
  private scheduleRetryAfterFailure(failed: DraftPrewarmCurrent): void {
    const delay = PREWARM_RETRY_DELAYS_MS[failed.retryAttempt];
    if (delay === undefined) return;
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.current !== failed || failed.retiring || failed.binding !== null) return;
      if (this.subscribers.size === 0) return;
      const requestedVersion = this.requestedInvalidationVersion();
      if (requestedVersion === null || this.blockedInvalidationVersion === requestedVersion) return;
      this.current = null;
      this.startCurrent(requestedVersion, failed.retryAttempt + 1);
    }, delay);
  }

  private startCurrent(invalidationVersion: number, retryAttempt = 0): void {
    let current!: DraftPrewarmCurrent;
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const controller = startDraftSessionPrewarm({
      workspaceKey: this.workspaceKey,
      dispatchCommand: (type, payload, targetSessionId) =>
        this.dispatchCommand(type, payload, targetSessionId),
      resolveInitialConfig: () => this.resolveInitialConfig?.(),
      onReady: (sessionId) => {
        if (this.current !== current || current.retiring) {
          return;
        }
        let binding!: DraftPrewarmBinding;
        binding = {
          workspaceKey: this.workspaceKey,
          sessionId,
          beginPromotion: () => {
            if (this.current !== current || current.binding !== binding) {
              return false;
            }
            current.controller.markPromotionPending();
            return true;
          },
          promote: () => {
            if (this.current !== current || current.binding !== binding) {
              return;
            }
            current.controller.markPromoted();
          },
          discard: () => {
            if (this.current !== current || current.binding !== binding) {
              return;
            }
            current.controller.markDiscarded();
            current.binding = null;
            this.blockedInvalidationVersion = current.invalidationVersion;
            this.emitBindings();
          },
        };
        current.binding = binding;
        this.emitBindings();
      },
      onSettled: () => {
        current.settled = true;
        complete();
        if (this.current !== current || !current.retiring) {
          if (this.current === current && !current.retiring && current.binding === null) {
            this.scheduleRetryAfterFailure(current);
          }
          return;
        }
        this.current = null;
        if (this.subscribers.size > 0) {
          this.reconcile();
        } else {
          this.onEmpty();
        }
      },
    });
    current = {
      invalidationVersion,
      controller,
      binding: null,
      settled: false,
      completion,
      retiring: false,
      retryAttempt,
    };
    this.current = current;
  }

  private retireCurrent(): void {
    const current = this.current;
    if (!current || current.retiring) {
      return;
    }
    this.clearRetryTimer();
    current.retiring = true;
    current.binding = null;
    current.controller.dispose();
    this.emitBindings();
    if (current.settled) {
      this.current = null;
    }
  }

  private emitBindings(): void {
    for (const subscriber of this.subscribers.values()) {
      this.emitBindingTo(subscriber);
    }
  }

  private emitBindingTo(subscriber: DraftPrewarmSubscriber): void {
    const current = this.current;
    subscriber.onBinding(
      current && !current.retiring && current.invalidationVersion === subscriber.invalidationVersion
        ? current.binding
        : null,
    );
  }
}

const draftPrewarmCoordinatorsByTransport = new Map<
  unknown,
  Map<string, DraftSessionPrewarmCoordinator>
>();

function logicalDraftOwnerKey(workspaceKey: string, paneId: string): string {
  return JSON.stringify([workspaceKey, paneId]);
}

function getDraftSessionPrewarmCoordinator(params: {
  workspaceKey: string;
  paneId: string;
  transportIdentity: unknown;
  dispatchCommand: DispatchCommand;
  resolveInitialConfig: (() => Partial<SessionConfigState> | undefined) | undefined;
}): DraftSessionPrewarmCoordinator {
  let transportCoordinators = draftPrewarmCoordinatorsByTransport.get(params.transportIdentity);
  if (!transportCoordinators) {
    transportCoordinators = new Map();
    draftPrewarmCoordinatorsByTransport.set(params.transportIdentity, transportCoordinators);
  }
  const ownerKey = logicalDraftOwnerKey(params.workspaceKey, params.paneId);
  let coordinator = transportCoordinators.get(ownerKey);
  if (!coordinator) {
    coordinator = new DraftSessionPrewarmCoordinator(
      params.workspaceKey,
      params.dispatchCommand,
      params.resolveInitialConfig,
      () => {
        if (transportCoordinators?.get(ownerKey) !== coordinator) {
          return;
        }
        transportCoordinators.delete(ownerKey);
        if (transportCoordinators.size === 0) {
          draftPrewarmCoordinatorsByTransport.delete(params.transportIdentity);
        }
      },
    );
    transportCoordinators.set(ownerKey, coordinator);
  }
  return coordinator;
}

export function useDraftSessionPrewarm(params: {
  
  enabled: boolean;
  workspaceKey: string;
  
  paneId: string;
  
  invalidationVersion?: number;
  
  transportIdentity: unknown;
  dispatchCommand: DispatchCommand;
  
  resolveInitialConfig?: () => Partial<SessionConfigState> | undefined;
}): DraftSessionPrewarm {
  const {
    enabled,
    workspaceKey,
    paneId,
    transportIdentity,
    invalidationVersion = 0,
    dispatchCommand,
    resolveInitialConfig,
  } = params;
  const owner = useMemo(
    () => ({ workspaceKey, paneId, transportIdentity }),
    [paneId, transportIdentity, workspaceKey],
  );
  const coordinator = useMemo(
    () =>
      getDraftSessionPrewarmCoordinator({
        workspaceKey,
        paneId,
        transportIdentity,
        dispatchCommand,
        resolveInitialConfig,
      }),
    [owner],
  );
  useLayoutEffect(() => {
    coordinator.update(dispatchCommand, resolveInitialConfig);
  }, [coordinator, dispatchCommand, resolveInitialConfig]);
  const generation = useMemo(() => ({ owner }), [enabled, invalidationVersion, owner]);
  const [ready, setReady] = useState<{
    generation: typeof generation;
    binding: DraftPrewarmBinding;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    return coordinator.acquire({
      generation,
      invalidationVersion,
      onBinding: (binding) => {
        setReady((current) => {
          if (!binding) {
            return current?.generation === generation ? null : current;
          }
          return { generation, binding };
        });
      },
    });
  }, [coordinator, enabled, generation, invalidationVersion]);

  const waitForSession = useCallback(async () => {
    if (!enabled) throw new Error("草稿会话尚未启用");
    return coordinator.waitForSession(invalidationVersion, generation);
  }, [coordinator, enabled, generation, invalidationVersion]);

  return { binding: ready?.generation === generation ? ready.binding : null, waitForSession };
}
