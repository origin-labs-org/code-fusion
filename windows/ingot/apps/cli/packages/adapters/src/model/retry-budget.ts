import { ModelRetryBudget } from "@origin-ai/cf-contracts";
import type { ResolvedAiSdkModelRetryOptions } from "./retry-policy.js";

export const UNBOUNDED_RETRY_MAX_ATTEMPTS = 0;

export const SINGLE_ATTEMPT_MAX_ATTEMPTS = 1;

export function isUnboundedRetryBudget(budget: ModelRetryBudget | undefined): boolean {
  return budget === ModelRetryBudget.Unbounded;
}

export function isSingleAttemptRetryBudget(budget: ModelRetryBudget | undefined): boolean {
  return budget === ModelRetryBudget.SingleAttempt;
}

export function resolveRetryOptionsForBudget(
  retry: ResolvedAiSdkModelRetryOptions,
  budget: ModelRetryBudget | undefined,
): ResolvedAiSdkModelRetryOptions {
  return isSingleAttemptRetryBudget(budget)
    ? { ...retry, maxAttempts: SINGLE_ATTEMPT_MAX_ATTEMPTS }
    : retry;
}

export function retryBudgetAllows(
  budget: ModelRetryBudget | undefined,
  retryBudgetAttempt: number,
  maxAttempts: number,
): boolean {
  return isUnboundedRetryBudget(budget) || retryBudgetAttempt < maxAttempts;
}

export function retryAttemptLoopContinues(
  budget: ModelRetryBudget | undefined,
  attempt: number,
  loopMaxAttempts: number,
): boolean {
  return isUnboundedRetryBudget(budget) || attempt <= loopMaxAttempts;
}

export function retryBudgetMaxAttempts(
  budget: ModelRetryBudget | undefined,
  maxAttempts: number,
): number {
  return isUnboundedRetryBudget(budget) ? UNBOUNDED_RETRY_MAX_ATTEMPTS : maxAttempts;
}
