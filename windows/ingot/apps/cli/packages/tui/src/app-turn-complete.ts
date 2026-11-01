//
import type React from "react";
import type { ModelUsageSummary } from "@origin-ai/cf-contracts";
import type { CacheStats, Message } from "./app-model.js";
import { cacheStatsFromPayload, usageFromPayload } from "./app-event-data.js";
import { projectedTranscriptHasResponse } from "./app-transcript-stream.js";
import { stringField } from "./state.js";

export function applyTurnCompleteFallbackResponse(
  payload: Record<string, unknown>,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
): void {
  const response = stringField(payload, "response");
  if (!response || response.trim().length === 0) return;
  setMessages((current) =>
    projectedTranscriptHasResponse(current, response)
      ? current
      : [...current, { content: response, role: "agent", streamProjected: true }],
  );
}

export function applyTurnCompleteEvent(
  payload: Record<string, unknown>,
  setUsage: React.Dispatch<React.SetStateAction<ModelUsageSummary | undefined>>,
  setCacheStats: React.Dispatch<React.SetStateAction<CacheStats | undefined>>,
): void {
  const turnUsage = usageFromPayload(payload);
  if (turnUsage) setUsage(turnUsage);

  const cacheStats = cacheStatsFromPayload(payload);
  if (cacheStats) setCacheStats(cacheStats);
}
