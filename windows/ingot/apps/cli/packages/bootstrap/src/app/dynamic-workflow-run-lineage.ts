// ============================================================
// ============================================================

import type { RunStatus } from "@origin-ai/cf-dynamic-workflow";

interface SupersedableSettlement {
  status: RunStatus;
  supersededBy?: string;
}

export function supersededByOf(
  entry: { terminal?: SupersedableSettlement } | undefined,
  record: { status?: RunStatus; supersededBy?: string } | undefined,
): string | undefined {
  if (entry?.terminal !== undefined) {
    return entry.terminal.status === "stopped" ? entry.terminal.supersededBy : undefined;
  }
  return record?.status === "stopped" ? record.supersededBy : undefined;
}

export function lineageFields(
  resumedFrom: string | undefined,
  supersededBy: string | undefined,
): { resumedFrom?: string; supersededBy?: string } {
  return {
    ...(resumedFrom === undefined ? {} : { resumedFrom }),
    ...(supersededBy === undefined ? {} : { supersededBy }),
  };
}
