import type { ToolEntry } from "../types.js";
import { normalizeToolExecutionInput } from "../input-normalization.js";
import type { ToolExecutorDeps } from "./types.js";
import { validateInput } from "./validation.js";

export function snapshotPermissionInput<T>(input: T): T {
  const snapshot = structuredClone(input);
  function freeze(value: unknown): void {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  freeze(snapshot);
  return snapshot;
}

export function preparePermissionInput(
  input: unknown,
  entry: ToolEntry,
  deps: ToolExecutorDeps,
): unknown {
  const normalized = normalizeToolExecutionInput({
    entry,
    input,
    logger: deps.logger,
    source: "permission",
  });
  const error = validateInput(normalized, entry);
  if (error) throw error;
  return normalized;
}
