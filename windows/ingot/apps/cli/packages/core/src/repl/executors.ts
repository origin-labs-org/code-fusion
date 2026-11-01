import { runInContext, type Context } from "node:vm";
import {
  instrumentForContextPersistence,
  parseReplCode,
  rewriteDynamicImportsForRepl,
} from "./instrument.js";

export interface ReplExecutor {
  run(
    code: string,
    context: Context,
    signal?: AbortSignal,
    syncTimeoutMs?: number,
  ): Promise<unknown>;
}

export class IifeContextExecutor implements ReplExecutor {
  async run(
    code: string,
    context: Context,
    signal?: AbortSignal,
    syncTimeoutMs = 5_000,
  ): Promise<unknown> {
    if (signal?.aborted) {
      throw abortReason(signal);
    }
    const rewrittenCode = rewriteDynamicImportsForRepl(code);
    const rewrittenParsed = parseReplCode(rewrittenCode);
    const effectiveCode =
      "ast" in rewrittenParsed
        ? instrumentForContextPersistence(rewrittenCode, rewrittenParsed.ast)
        : rewrittenCode;

    const wrapped = `(async () => {\n${effectiveCode}\n})()`;
    const promise = runInContext(wrapped, context, {
      timeout: Math.max(1, Math.trunc(syncTimeoutMs)),
    }) as Promise<unknown>;

    return signal ? await raceAbort(promise, signal) : await promise;
  }
}

function abortReason(signal: AbortSignal): unknown {
  const reason = signal.reason;
  if (reason && typeof reason === "object" && "name" in reason) return reason;
  return new DOMException(typeof reason === "string" ? reason : "aborted", "AbortError");
}

function raceAbort(promise: Promise<unknown>, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }
  return new Promise<unknown>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
