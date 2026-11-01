import type { BrowserCommandResult } from "@origin-ai/cf-shared";

export type BrowserCommandDone = (
  partial: Omit<BrowserCommandResult, "elapsedMs">,
) => BrowserCommandResult;

export function refNotFound(ref: string): Omit<BrowserCommandResult, "elapsedMs"> {
  return {
    ok: false,
    error: {
      code: "ref_not_found",
      message: `ref ${ref} not found (take a fresh snapshot() first)`,
    },
  };
}

export function executionError(message: string): Omit<BrowserCommandResult, "elapsedMs"> {
  return { ok: false, error: { code: "execution_error", message } };
}
