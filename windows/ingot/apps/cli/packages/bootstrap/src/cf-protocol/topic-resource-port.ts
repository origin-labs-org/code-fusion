import { channelReplyResultSchema } from "@origin-ai/cf-shared";
import { randomUUID } from "node:crypto";
import type { TopicResourcePort } from "@origin-ai/cf-contracts";
import {
  cfProtocolMethods,
  cfTopicResourceReadResultSchema,
  cfTopicResourceCancelResultSchema,
} from "@origin-ai/cf-shared";
import {
  protocolTraceFromTraceContext,
  type CfProtocolAgentServerContext,
} from "./server-types.js";

const RESOURCE_TIMEOUT_MS = 120_000;

export function createProtocolTopicResourcePort(
  context: CfProtocolAgentServerContext,
): TopicResourcePort {
  return {
    async reply(request, options) {
      options.signal.throwIfAborted();
      return context.requestClient(
        cfProtocolMethods.channelReply,
        request,
        channelReplyResultSchema,
        {
          signal: options.signal,
          trace: options.trace ? protocolTraceFromTraceContext(options.trace) : undefined,
          timeoutMs: 60_000,
        },
      );
    },
    async read(request, options) {
      options.signal.throwIfAborted();
      const requestId = randomUUID();
      const trace = options.trace ? protocolTraceFromTraceContext(options.trace) : undefined;
      const cancel = async () => {
        try {
          await context.requestClient(
            cfProtocolMethods.topicResourceCancel,
            { requestId, taskId: request.taskId },
            cfTopicResourceCancelResultSchema,
            { timeoutMs: RESOURCE_TIMEOUT_MS, trace },
          );
        } catch {
        }
      };
      options.signal.addEventListener("abort", cancel, { once: true });
      try {
        const result = await context.requestClient(
          cfProtocolMethods.topicResourceRead,
          { ...request, requestId },
          cfTopicResourceReadResultSchema,
          { signal: options.signal, trace, timeoutMs: RESOURCE_TIMEOUT_MS },
        );
        options.signal.throwIfAborted();
        return result;
      } finally {
        options.signal.removeEventListener("abort", cancel);
      }
    },
  };
}
