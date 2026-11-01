

import { refToString, WorkflowError, type InstanceRef } from "./types.js";

export function hashMismatch(instance: InstanceRef, expected: string, got: string): WorkflowError {
  return new WorkflowError(
    "InputHashMismatch",
    `Replay hit at ${refToString(instance)} but inputHash differs (expected ${expected}, got ` +
      `${got}): the script is not deterministic, so the journal cannot be replayed.`,
    { mismatch: { expected, got } },
  );
}
