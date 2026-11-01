// ============================================================
// ============================================================
//
//
//
//

import {
  isWorkspaceMutatingToolCall,
  isWorldTouchingToolCall,
  SessionEventType,
  type SessionEvent,
  type SessionId,
  type ToolCallScheduledPayload,
  type ToolCallStartedPayload,
} from "@origin-ai/cf-contracts";
import type { AgentRuntime } from "@origin-ai/cf-core";
import type { AskLastTool } from "@origin-ai/cf-dynamic-workflow";
import { summarizeToolCall } from "./workflow-driver-tool-target.js";

const MAX_PENDING_SCHEDULED_CALLS = 64;

export interface ActorToolCounts {
  
  toolCalls: number;
  
  worldToolCalls: number;
}

interface ActorToolActivity {
  
  reset(): void;
  
  counts(): ActorToolCounts;
  
  inFlight(): number;
  
  lastTool(): AskLastTool | undefined;
  
  observe(runtime: AgentRuntime, sessionId: SessionId): void;
  unsubscribe(): void;
}

export function createActorToolActivity(handlers: {
  
  onMutating(): void;
}): ActorToolActivity {
  let reported = false;
  let toolCalls = 0;
  let worldToolCalls = 0;
  let lastTool: AskLastTool | undefined;
  
  const scheduled = new Map<string, ToolCallSummaryHold>();
  
  const running = new Set<string>();
  let unsubscribeEvents: (() => void) | undefined;
  return {
    reset: () => {
      reported = false;
      toolCalls = 0;
      worldToolCalls = 0;
      lastTool = undefined;
      scheduled.clear();
      running.clear();
    },
    counts: () => ({ toolCalls, worldToolCalls }),
    inFlight: () => running.size,
    lastTool: () => lastTool,
    observe: (runtime, sessionId) => {
      if (typeof (runtime as Partial<AgentRuntime>).subscribeEvents !== "function") return;
      unsubscribeEvents = runtime.subscribeEvents({
        onSessionEvent: (event: SessionEvent) => {
          if (event.sessionId !== sessionId) return;
          if (event.type === SessionEventType.ToolCallScheduled) {
            holdScheduled(scheduled, event.payload as ToolCallScheduledPayload);
            return;
          }
          if (
            event.type === SessionEventType.ToolCallResult ||
            event.type === SessionEventType.ToolCallError
          ) {
            running.delete(String((event.payload as { toolCallId: unknown }).toolCallId));
            return;
          }
          if (event.type !== SessionEventType.ToolCallStarted) return;
          const capability = event.payload as ToolCallStartedPayload;
          running.add(String(capability.toolCallId));
          const hold = scheduled.get(String(capability.toolCallId));
          scheduled.delete(String(capability.toolCallId));
          lastTool =
            summarizeToolCall({
              ...(hold === undefined ? {} : { input: hold.input }),
              toolName: capability.toolName ?? hold?.toolName,
            }) ?? lastTool;
          toolCalls++;
          if (isWorldTouchingToolCall(capability)) worldToolCalls++;
          if (!isWorkspaceMutatingToolCall(capability)) return;
          if (reported) return;
          reported = true;
          handlers.onMutating();
        },
      });
    },
    unsubscribe: () => {
      unsubscribeEvents?.();
      unsubscribeEvents = undefined;
    },
  };
}

interface ToolCallSummaryHold {
  toolName?: string;
  input?: unknown;
}

function holdScheduled(
  scheduled: Map<string, ToolCallSummaryHold>,
  payload: ToolCallScheduledPayload,
): void {
  scheduled.set(String(payload.toolCallId), { toolName: payload.toolName, input: payload.input });
  while (scheduled.size > MAX_PENDING_SCHEDULED_CALLS) {
    const oldest = scheduled.keys().next();
    if (oldest.done === true) return;
    scheduled.delete(oldest.value);
  }
}
