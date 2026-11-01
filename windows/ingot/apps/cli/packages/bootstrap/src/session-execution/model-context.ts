import type { ModelRequestAuth } from "@origin-ai/cf-contracts";
import type { ModelExecutionInput, ModelExecutionContext } from "./contract.js";

export function createModelExecutionContext(input: ModelExecutionInput): ModelExecutionContext {
  const requestAuth = input.requestAuth ? freezeRequestAuth(input.requestAuth) : undefined;
  return {
    ...(input.memoryExtraction ? { memoryExtraction: input.memoryExtraction } : {}),
    selectionScope: "execution",
    ...(input.offPeak ? { offPeak: input.offPeak } : {}),
    ...(requestAuth
      ? {
          requestDependencies: { requestAuth: { source: { resolve: async () => requestAuth } } },
        }
      : {}),
    ...(input.subagents ? { subagents: input.subagents } : {}),
    ...(input.selectionFallback ? { selectionFallback: input.selectionFallback } : {}),
  };
}

function freezeRequestAuth(input: ModelRequestAuth): ModelRequestAuth {
  return Object.freeze({
    ...(input.accountScope ? { accountScope: input.accountScope } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.apiKeyId ? { apiKeyId: input.apiKeyId } : {}),
    ...(input.headers ? { headers: Object.freeze({ ...input.headers }) } : {}),
  });
}
