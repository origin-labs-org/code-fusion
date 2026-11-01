//
//
//
import { ASK_USER_QUESTION_E2E_CLOCK_SCALE_ENV } from "@origin-ai/cf-shared";

export type V4InteractionAnswer = {
  optionId?: string;
  freeText?: string;
  action?: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
};

export const ASK_USER_QUESTION_HIDDEN_GRACE_MS = 60_000;
export const ASK_USER_QUESTION_AUTO_RESOLUTION_MS = 300_000;
export interface V4InteractionRegistryOptions {
  hiddenGraceMs?: number;
  autoResolutionMs?: number;
  now?: () => number;
}

export function resolveV4InteractionRegistryOptionsFromEnv(
  env: NodeJS.ProcessEnv,
): V4InteractionRegistryOptions | undefined {
  if (env.CF_ENV !== "test") return undefined;
  const rawScale = env[ASK_USER_QUESTION_E2E_CLOCK_SCALE_ENV]?.trim();
  if (!rawScale) return undefined;
  const scale = Number(rawScale);
  if (!Number.isFinite(scale) || scale < 1 || scale > 1_000) {
    throw new Error(`${ASK_USER_QUESTION_E2E_CLOCK_SCALE_ENV} must be between 1 and 1000`);
  }
  return {
    hiddenGraceMs: Math.max(1, Math.round(ASK_USER_QUESTION_HIDDEN_GRACE_MS / scale)),
    autoResolutionMs: Math.max(1, Math.round(ASK_USER_QUESTION_AUTO_RESOLUTION_MS / scale)),
  };
}

export type V4InteractionAutoResolution =
  | {
      state: "hiddenGrace" | "visibleCountdown";
      startedAt: number;
      visibleAt: number;
      deadlineAt: number;
    }
  | {
      state: "snoozed";
      startedAt: number;
      snoozedAt: number;
    };

export interface V4InteractionRegistrationOptions {
  sessionId: string;
  kind: "askUserQuestion" | "other";
  fullAccess?: () => Promise<void>;
  initialAutoResolution?: V4InteractionAutoResolution;
  onAutoResolutionUpdated?: (state: V4InteractionAutoResolution) => void | Promise<void>;
}

interface RegisteredInteraction {
  
  resolve: (answer: V4InteractionAnswer) => void;
  options?: V4InteractionRegistrationOptions;
  autoResolution?: V4InteractionAutoResolution;
  
  fullAccessPending?: Promise<void>;
  autoResolutionEligible: boolean;
  visibleTimer?: ReturnType<typeof setTimeout>;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  token: symbol;
}

export class V4InteractionRegistry {
  private readonly pending = new Map<string, RegisteredInteraction>();
  private readonly queuesBySession = new Map<string, string[]>();
  private readonly hiddenGraceMs: number;
  private readonly autoResolutionMs: number;
  private readonly now: () => number;
  private askUserQuestionAutoResolutionEnabled = true;
  private interactionPreferenceCommandApplied = false;

  constructor(options: V4InteractionRegistryOptions = {}) {
    this.hiddenGraceMs = options.hiddenGraceMs ?? ASK_USER_QUESTION_HIDDEN_GRACE_MS;
    this.autoResolutionMs = options.autoResolutionMs ?? ASK_USER_QUESTION_AUTO_RESOLUTION_MS;
    this.now = options.now ?? Date.now;
  }

  
  register(
    interactionId: string,
    resolve: (answer: V4InteractionAnswer) => void,
    options?: V4InteractionRegistrationOptions,
  ): () => void {
    const previous = this.pending.get(interactionId);
    const token = Symbol(interactionId);
    if (previous) {
      this.clearTimers(previous);
    }
    const entry: RegisteredInteraction = {
      resolve,
      options,
      token,
      autoResolutionEligible:
        previous?.autoResolutionEligible ??
        (options?.kind === "askUserQuestion" ? this.askUserQuestionAutoResolutionEnabled : false),
      ...(previous?.autoResolution || options?.initialAutoResolution
        ? { autoResolution: previous?.autoResolution ?? options?.initialAutoResolution }
        : {}),
    };
    this.pending.set(interactionId, entry);
    if (options && !previous) {
      const queue = this.queuesBySession.get(options.sessionId) ?? [];
      queue.push(interactionId);
      this.queuesBySession.set(options.sessionId, queue);
    }
    if (options) {
      if (entry.autoResolution) {
        if (options.kind === "askUserQuestion" && !entry.autoResolutionEligible) {
          void this.convertToSnoozed(entry);
        } else {
          this.resumeAutoResolution(interactionId, entry);
        }
      } else {
        this.activateHead(options.sessionId);
      }
    }
    return () => {
      const current = this.pending.get(interactionId);
      if (!current || current.token !== token) return;
      this.remove(interactionId, current);
    };
  }

  
  resolve(interactionId: string, answer: V4InteractionAnswer): boolean {
    const entry = this.pending.get(interactionId);
    if (!entry || entry.fullAccessPending) return false;
    this.remove(interactionId, entry);
    entry.resolve(answer);
    return true;
  }

  
  async resolveFullAccess(interactionId: string, sessionId: string): Promise<boolean> {
    const entry = this.pending.get(interactionId);
    if (!entry) return false;
    if (entry.options?.sessionId !== sessionId || !entry.options.fullAccess) {
      throw new Error("Full access is not supported for this interaction");
    }
    if (entry.fullAccessPending) {
      await entry.fullAccessPending;
      return true;
    }
    const operation = entry.options.fullAccess();
    entry.fullAccessPending = operation;
    try {
      await operation;
      if (this.pending.get(interactionId) !== entry) return false;
      this.remove(interactionId, entry);
      entry.resolve({ optionId: "allowOnce" });
      return true;
    } finally {
      delete entry.fullAccessPending;
    }
  }

  
  async snoozeAutoResolution(interactionId: string): Promise<boolean> {
    const entry = this.pending.get(interactionId);
    if (
      !entry?.options ||
      entry.options.kind !== "askUserQuestion" ||
      !entry.autoResolution ||
      entry.autoResolution.state === "snoozed"
    ) {
      return false;
    }
    await this.convertToSnoozed(entry);
    return true;
  }

  
  async setAskUserQuestionAutoResolutionEnabled(enabled: boolean): Promise<number> {
    this.interactionPreferenceCommandApplied = true;
    return this.applyAskUserQuestionAutoResolutionEnabled(enabled);
  }

  
  async initializeAskUserQuestionAutoResolutionEnabled(enabled: boolean): Promise<number> {
    if (this.interactionPreferenceCommandApplied) return 0;
    return this.applyAskUserQuestionAutoResolutionEnabled(enabled);
  }

  private async applyAskUserQuestionAutoResolutionEnabled(enabled: boolean): Promise<number> {
    this.askUserQuestionAutoResolutionEnabled = enabled;
    if (enabled) return 0;

    const persistence: Promise<void>[] = [];
    let snoozedInteractionCount = 0;
    for (const entry of this.pending.values()) {
      if (entry.options?.kind !== "askUserQuestion") continue;
      entry.autoResolutionEligible = false;
      if (entry.autoResolution && entry.autoResolution.state !== "snoozed") {
        snoozedInteractionCount += 1;
        persistence.push(this.convertToSnoozed(entry));
      }
    }
    await Promise.all(persistence);
    return snoozedInteractionCount;
  }

  has(interactionId: string): boolean {
    return this.pending.has(interactionId);
  }

  
  hasPendingForSession(sessionId: string): boolean {
    for (const entry of this.pending.values()) {
      if (entry.options?.sessionId === sessionId) return true;
    }
    return false;
  }

  private activateHead(sessionId: string): void {
    const queue = this.queuesBySession.get(sessionId);
    const interactionId = queue?.[0];
    if (!interactionId) return;
    const entry = this.pending.get(interactionId);
    if (
      !entry?.options ||
      entry.options.kind !== "askUserQuestion" ||
      !entry.autoResolutionEligible ||
      entry.autoResolution
    ) {
      return;
    }
    const startedAt = this.now();
    const visibleAt = startedAt + this.hiddenGraceMs;
    const deadlineAt = startedAt + this.autoResolutionMs;
    entry.autoResolution = {
      state: "hiddenGrace",
      startedAt,
      visibleAt,
      deadlineAt,
    };
    this.notifyAutoResolution(entry);
    this.scheduleActiveAutoResolution(interactionId, entry);
  }

  private resumeAutoResolution(interactionId: string, entry: RegisteredInteraction): void {
    const sessionId = entry.options?.sessionId;
    if (!sessionId || this.queuesBySession.get(sessionId)?.[0] !== interactionId) {
      return;
    }
    const autoResolution = entry.autoResolution;
    if (!autoResolution) return;
    if (autoResolution.state === "snoozed") {
      this.notifyAutoResolution(entry);
      return;
    }
    const now = this.now();
    if (now >= autoResolution.deadlineAt) {
      queueMicrotask(() => {
        this.resolve(interactionId, {
          action: "accept",
          content: { answers: {} },
        });
      });
      return;
    }
    if (autoResolution.state === "hiddenGrace" && now >= autoResolution.visibleAt) {
      entry.autoResolution = {
        ...autoResolution,
        state: "visibleCountdown",
      };
    }
    this.notifyAutoResolution(entry);
    this.scheduleActiveAutoResolution(interactionId, entry);
  }

  private scheduleActiveAutoResolution(interactionId: string, entry: RegisteredInteraction): void {
    const autoResolution = entry.autoResolution;
    if (!autoResolution || autoResolution.state === "snoozed") return;
    const now = this.now();
    if (autoResolution.state === "hiddenGrace") {
      entry.visibleTimer = setTimeout(
        () => {
          const current = this.pending.get(interactionId);
          if (current !== entry || current.autoResolution?.state !== "hiddenGrace") {
            return;
          }
          current.autoResolution = {
            state: "visibleCountdown",
            startedAt: autoResolution.startedAt,
            visibleAt: autoResolution.visibleAt,
            deadlineAt: autoResolution.deadlineAt,
          };
          this.notifyAutoResolution(current);
        },
        Math.max(0, autoResolution.visibleAt - now),
      );
    }
    entry.deadlineTimer = setTimeout(
      () => {
        this.resolve(interactionId, {
          action: "accept",
          content: { answers: {} },
        });
      },
      Math.max(0, autoResolution.deadlineAt - now),
    );
  }

  private notifyAutoResolution(entry: RegisteredInteraction): void {
    if (!entry.autoResolution) return;
    void entry.options?.onAutoResolutionUpdated?.(entry.autoResolution);
  }

  private async convertToSnoozed(entry: RegisteredInteraction): Promise<void> {
    const autoResolution = entry.autoResolution;
    if (!autoResolution || autoResolution.state === "snoozed") return;
    this.clearTimers(entry);
    entry.autoResolution = {
      state: "snoozed",
      startedAt: autoResolution.startedAt,
      snoozedAt: this.now(),
    };
    await entry.options?.onAutoResolutionUpdated?.(entry.autoResolution);
  }

  private clearTimers(entry: RegisteredInteraction): void {
    if (entry.visibleTimer) clearTimeout(entry.visibleTimer);
    if (entry.deadlineTimer) clearTimeout(entry.deadlineTimer);
    delete entry.visibleTimer;
    delete entry.deadlineTimer;
  }

  private remove(interactionId: string, entry: RegisteredInteraction): void {
    this.pending.delete(interactionId);
    this.clearTimers(entry);
    const sessionId = entry.options?.sessionId;
    if (!sessionId) return;
    const queue = this.queuesBySession.get(sessionId);
    if (!queue) return;
    const index = queue.indexOf(interactionId);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) {
      this.queuesBySession.delete(sessionId);
      return;
    }
    this.activateHead(sessionId);
  }
}
