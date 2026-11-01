

import type { ConcurrencyChange, ConcurrencyChangeReason } from "./types.js";

export const CONCURRENCY_DECREASE_FACTOR = 0.75;

export const CONCURRENCY_INCREASE_STEP = 1;

export const CONCURRENCY_INCREASE_AFTER_SUCCESSES = 4;

export const CONCURRENCY_FLOOR = 1;

export const CONCURRENCY_IDLE_RESET_MS = 300_000;

export type ConcurrencyThrottleReason = Extract<
  ConcurrencyChangeReason,
  "rate_limited" | "provider_overloaded" | "offpeak_queued"
>;

export interface ConcurrencyControllerSnapshot {
  readonly key: string;
  
  readonly initial: number;
  
  readonly growthLimit: number;
  readonly cap: number;
  
  readonly epoch: number;
  readonly inFlight: number;
  readonly waiters: number;
  readonly successStreak: number;
  readonly cooldownUntil?: number;
  readonly lastRequestAt?: number;
  readonly lastGood?: number;
  readonly lastBad?: number;
  
  readonly lastThrottledAt?: number;
}

export class ConcurrencyController {
  private cap: number;
  private growthLimit_: number;
  private epoch = 0;
  private inFlight = 0;
  private waiters_ = 0;
  private successStreak = 0;
  private cooldownUntil?: number;
  private lastRequestAt?: number;
  private lastGood?: number;
  private lastBad?: number;
  private lastThrottledAt?: number;

  
  constructor(
    readonly key: string,
    readonly initial: number,
    growthLimit: number = initial,
  ) {
    this.cap = initial;
    this.growthLimit_ = Math.max(initial, growthLimit);
  }

  snapshot(): ConcurrencyControllerSnapshot {
    return {
      key: this.key,
      initial: this.initial,
      growthLimit: this.growthLimit_,
      cap: this.cap,
      epoch: this.epoch,
      inFlight: this.inFlight,
      waiters: this.waiters_,
      successStreak: this.successStreak,
      ...(this.cooldownUntil === undefined ? {} : { cooldownUntil: this.cooldownUntil }),
      ...(this.lastRequestAt === undefined ? {} : { lastRequestAt: this.lastRequestAt }),
      ...(this.lastGood === undefined ? {} : { lastGood: this.lastGood }),
      ...(this.lastBad === undefined ? {} : { lastBad: this.lastBad }),
      ...(this.lastThrottledAt === undefined ? {} : { lastThrottledAt: this.lastThrottledAt }),
    };
  }

  
  canAdmit(now: number): boolean {
    return (
      this.inFlight < this.cap && (this.cooldownUntil === undefined || now >= this.cooldownUntil)
    );
  }

  
  observe(now: number): ConcurrencyChange[] {
    return this.idleReset(now);
  }

  
  admitted(now: number): number {
    this.lastRequestAt = now;
    this.inFlight += 1;
    return this.epoch;
  }

  
  succeeded(now: number, epoch: number): ConcurrencyChange[] {
    const changes = this.idleReset(now);
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (epoch !== this.epoch) return changes;
    this.successStreak += 1;
    if (this.successStreak < CONCURRENCY_INCREASE_AFTER_SUCCESSES) return changes;
    if (this.lastGood === undefined || this.cap > this.lastGood) this.lastGood = this.cap;
    if (this.waiters_ <= 0 || this.cap >= this.growthLimit_) return changes;
    const previous = this.cap;
    this.cap = Math.min(this.growthLimit_, previous + CONCURRENCY_INCREASE_STEP);
    this.successStreak = 0;
    changes.push(this.change(previous, "recovered"));
    return changes;
  }

  
  throttled(
    now: number,
    epoch: number,
    reason: ConcurrencyThrottleReason,
    retryAfterMs?: number,
  ): ConcurrencyChange[] {
    const changes = this.idleReset(now);
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.successStreak = 0;
    this.lastThrottledAt = now;
    const cooldownMs = retryAfterMs !== undefined && retryAfterMs > 0 ? retryAfterMs : undefined;
    if (cooldownMs !== undefined) {
      this.cooldownUntil = Math.max(this.cooldownUntil ?? 0, now + cooldownMs);
    }
    if (epoch !== this.epoch) return changes;

    const previous = this.cap;
    if (this.lastGood !== undefined && this.cap > this.lastGood) {
      this.lastBad = this.cap;
      this.cap = this.lastGood;
    } else {
      this.cap = Math.max(CONCURRENCY_FLOOR, Math.floor(this.cap * CONCURRENCY_DECREASE_FACTOR));
      this.lastBad = previous;
      this.lastGood = undefined;
    }
    this.epoch += 1;
    if (previous === this.cap && cooldownMs === undefined) return changes;
    changes.push(this.change(previous, reason, cooldownMs));
    return changes;
  }

  
  failedTransient(now: number): ConcurrencyChange[] {
    const changes = this.idleReset(now);
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.successStreak = 0;
    return changes;
  }

  
  ended(now: number): ConcurrencyChange[] {
    const changes = this.idleReset(now);
    this.inFlight = Math.max(0, this.inFlight - 1);
    return changes;
  }

  
  waiters(now: number, count: number): ConcurrencyChange[] {
    const changes = this.idleReset(now);
    this.waiters_ = Math.max(0, count);
    return changes;
  }

  
  setGrowthLimit(now: number, limit: number): ConcurrencyChange[] {
    const changes = this.idleReset(now);
    this.growthLimit_ = Math.max(this.initial, Math.floor(limit));
    if (this.cap <= this.growthLimit_) return changes;
    const previous = this.cap;
    this.cap = this.growthLimit_;
    if (this.lastGood !== undefined && this.lastGood > this.cap) this.lastGood = this.cap;
    this.successStreak = 0;
    this.epoch += 1;
    changes.push(this.change(previous, "limit_lowered"));
    return changes;
  }

  
  seed(now: number, target: number): ConcurrencyChange[] {
    const changes = this.idleReset(now);
    const next = Math.min(this.growthLimit_, Math.floor(target));
    if (next <= this.cap) return changes;
    if (
      this.lastThrottledAt !== undefined &&
      now - this.lastThrottledAt < CONCURRENCY_IDLE_RESET_MS
    ) {
      return changes;
    }
    const previous = this.cap;
    this.cap = next;
    this.lastGood = undefined;
    this.lastBad = undefined;
    this.successStreak = 0;
    this.epoch += 1;
    changes.push(this.change(previous, "seeded"));
    return changes;
  }

  
  private idleReset(now: number): ConcurrencyChange[] {
    if (
      this.lastRequestAt === undefined ||
      this.inFlight !== 0 ||
      now - this.lastRequestAt < CONCURRENCY_IDLE_RESET_MS
    ) {
      return [];
    }
    const previous = this.cap;
    if (
      previous === this.initial &&
      this.successStreak === 0 &&
      this.cooldownUntil === undefined &&
      this.lastGood === undefined &&
      this.lastBad === undefined &&
      this.lastThrottledAt === undefined
    ) {
      return [];
    }
    this.cap = this.initial;
    this.successStreak = 0;
    this.cooldownUntil = undefined;
    this.lastGood = undefined;
    this.lastBad = undefined;
    this.lastThrottledAt = undefined;
    this.epoch += 1;
    return previous === this.cap ? [] : [this.change(previous, "idle_reset")];
  }

  private change(
    previous: number,
    reason: ConcurrencyChangeReason,
    cooldownMs?: number,
  ): ConcurrencyChange {
    return {
      key: this.key,
      previous,
      next: this.cap,
      reason,
      ...(this.lastGood === undefined ? {} : { lastGood: this.lastGood }),
      ...(this.lastBad === undefined ? {} : { lastBad: this.lastBad }),
      ...(cooldownMs === undefined ? {} : { cooldownMs }),
    };
  }
}
