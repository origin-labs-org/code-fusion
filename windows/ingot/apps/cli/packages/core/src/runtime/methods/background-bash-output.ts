import type { BackgroundBashOutputResult } from "@origin-ai/cf-shared";
import type { AgentRuntimeInternal } from "../internal.js";

export async function readBackgroundBashOutput(
  this: AgentRuntimeInternal,
  workId: string,
  sessionId = this.sessionId as string,
): Promise<BackgroundBashOutputResult> {
  if (!this.executionPort?.readBackgroundBashOutput) return { kind: "unsupported", workId };
  return this.executionPort.readBackgroundBashOutput(workId, sessionId);
}
