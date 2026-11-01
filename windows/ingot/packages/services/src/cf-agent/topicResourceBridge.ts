import {
  cfTopicResourceReadParamsSchema,
  cfTopicResourceReadResultSchema,
  type CfTopicResourceReadParams,
  type CfTopicResourceReadResult,
  type CfPromptAttachment,
  type CfProtocolTrace,
} from "@origin-ai/cf-shared";

const RESOURCE_TIMEOUT_MS = 120_000;
export interface TopicResourceBridgeDependencies {
  validate(
    request: CfTopicResourceReadParams,
    signal: AbortSignal,
    trace?: CfProtocolTrace,
  ): Promise<void>;
  read(
    request: CfTopicResourceReadParams,
    signal: AbortSignal,
    trace?: CfProtocolTrace,
  ): Promise<CfPromptAttachment>;
  upload(
    request: CfTopicResourceReadParams,
    attachment: CfPromptAttachment,
    signal: AbortSignal,
    trace?: CfProtocolTrace,
  ): Promise<CfTopicResourceReadResult>;
}

export function createTopicResourceBridge(
  dependencies: TopicResourceBridgeDependencies | (() => TopicResourceBridgeDependencies),
) {
  const pending = new Map<string, { taskId: string; controller: AbortController }>();
  let disposed = false;
  return {
    async read(value: unknown, trace?: CfProtocolTrace): Promise<CfTopicResourceReadResult> {
      const request = cfTopicResourceReadParamsSchema.parse(value);
      if (disposed) throw new Error("Topic resource connection is closed");
      if (pending.has(request.requestId))
        throw new Error("Topic resource request is already active");
      const controller = new AbortController();
      pending.set(request.requestId, { taskId: request.taskId, controller });
      const timer = setTimeout(
        () => controller.abort(new Error("Topic resource request timed out")),
        RESOURCE_TIMEOUT_MS,
      );
      try {
        const deps = typeof dependencies === "function" ? dependencies() : dependencies;
        const attachment = await deps.read(request, controller.signal, trace);
        controller.signal.throwIfAborted();
        const result = await deps.upload(request, attachment, controller.signal, trace);
        controller.signal.throwIfAborted();
        await deps.validate(request, controller.signal, trace);
        controller.signal.throwIfAborted();
        return cfTopicResourceReadResultSchema.parse(result);
      } finally {
        clearTimeout(timer);
        pending.delete(request.requestId);
      }
    },
    cancel(request: { requestId: string; taskId: string }): boolean {
      const operation = pending.get(request.requestId);
      if (!operation || operation.taskId !== request.taskId) return false;
      operation.controller.abort(new Error("Topic resource request cancelled"));
      return true;
    },
    dispose() {
      disposed = true;
      for (const operation of pending.values())
        operation.controller.abort(new Error("Topic resource connection closed"));
      pending.clear();
    },
  };
}
