import type { TraceContext } from "../tracing/tracer.js";

export interface TopicResourcePort {
  
  reply?(
    request: import("@origin-ai/cf-shared").ChannelReplyRequest,
    context: { signal: AbortSignal; trace?: TraceContext },
  ): Promise<import("@origin-ai/cf-shared").ChannelReplyResult>;
  read(
    request: {
      taskId: string;
      inputId: string;
      authorizationId: string;
      messageId: string;
      resourceIndex: number;
    },
    context: { signal: AbortSignal; trace?: TraceContext },
  ): Promise<{ ref: string; fileName: string; mime: string; bytes: number }>;
}
