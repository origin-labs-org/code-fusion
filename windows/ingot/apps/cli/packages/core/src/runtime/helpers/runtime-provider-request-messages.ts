import { buildToolExposure } from "../../tool/search/exposure.js";
import type { ModelToolContract } from "@origin-ai/cf-contracts";
import type { RuntimeMessageEntry } from "../../agent/message-history.js";
import type { ToolRegistry } from "../../tool/registry.js";
import type { Model } from "../deps.js";
import type { AgentRuntimeConfig } from "../types.js";
import {
  buildProviderRequestMessages,
  type ProviderRequestMessageProjectionResult,
} from "./provider-request-messages.js";

type RequestRuntime = {
  readonly config: Pick<AgentRuntimeConfig, "midConversationSystem" | "toolSearch">;
};

interface MessageProjectionInput {
  entries: readonly RuntimeMessageEntry[];
  applyCacheControl?: boolean;
  skipCacheWrite?: boolean;
  model: Model;
  loadedToolCallIds?: ReadonlySet<string>;
}

export function prepareRuntimeProviderRequest(
  runtime: RequestRuntime,
  input: MessageProjectionInput & {
    tools: readonly ModelToolContract[];
    registry?: Pick<ToolRegistry, "get">;
    prompt?: string;
  },
) {
  const exposure = buildToolExposure({
    model: input.model,
    mode: runtime.config.toolSearch?.mode,
    tools: input.tools,
    registry: input.registry,
    entries: input.entries,
  });
  const projection = buildRuntimeProviderRequestMessages(runtime, {
    entries:
      input.prompt === undefined
        ? exposure.entries
        : [...exposure.entries, { message: { role: "user", content: input.prompt } }],
    model: input.model,
    loadedToolCallIds: exposure.loadedToolCallIds,
    applyCacheControl: input.applyCacheControl,
    skipCacheWrite: input.skipCacheWrite,
  });
  return {
    request: {
      messages: projection.messages,
      tools: exposure.tools,
      toolSearchEnabled: exposure.context.mode === "native",
    },
    projection,
    entries: exposure.entries,
    loadedToolCallIds: exposure.loadedToolCallIds,
    toolSearch: exposure.context,
    reason: exposure.reason,
  };
}

export function buildRuntimeProviderRequestMessages(
  runtime: RequestRuntime,
  input: MessageProjectionInput,
): ProviderRequestMessageProjectionResult {
  const useMidConversationSystem =
    runtime.config.midConversationSystem?.mode === "force" ||
    input.model.properties.supportsMidConversationSystem;
  return buildProviderRequestMessages({
    ...input,
    useMidConversationSystem,
  });
}
