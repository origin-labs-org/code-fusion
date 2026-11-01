

import { SUBMIT_RESULT_TOOL_NAME } from "@origin-ai/cf-contracts";

export type WireFormat = "anthropic-messages" | "openai-chat-completions";

export interface CannedModelOptions {
  
  turns?: number;
  
  submitPayload?: unknown;
  
  visibleText?: string;
}

const DEFAULT_CANNED_TURNS = 3;
const DEFAULT_SUBMIT_PAYLOAD: { note: string } = { note: "done" };
const CANNED_GLOB_INPUT: { pattern: string } = { pattern: "**
export function cannedTurn(toolResultCount: number, options: CannedModelOptions): CannedTurn {
  const turns = options.turns ?? DEFAULT_CANNED_TURNS;
  if (toolResultCount < turns) {
    return {
      toolName: "Glob",
      toolInput: CANNED_GLOB_INPUT,
      toolCallId: `call-glob-${toolResultCount + 1}`,
    };
  }
  return {
    toolName: SUBMIT_RESULT_TOOL_NAME,
    toolInput: { result: options.submitPayload ?? DEFAULT_SUBMIT_PAYLOAD },
    toolCallId: `call-submit-${toolResultCount + 1}`,
  };
}

function sseFrame(event: string | undefined, data: unknown): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return event === undefined ? `data: ${payload}\n\n` : `event: ${event}\ndata: ${payload}\n\n`;
}

// ————————————————————————————————————————————————————————————————
// Anthropic Messages
// ————————————————————————————————————————————————————————————————

function anthropicMessageStart(ordinal: number): string {
  return sseFrame("message_start", {
    type: "message_start",
    message: {
      id: `msg_${ordinal}`,
      type: "message",
      role: "assistant",
      model: MODEL_NAME,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: USAGE_IN, output_tokens: 0 },
    },
  });
}

function anthropicVisibleText(index: number, text: string): string {
  return [
    sseFrame("content_block_start", {
      type: "content_block_start",
      index,
      content_block: { type: "text", text: "" },
    }),
    sseFrame("content_block_delta", {
      type: "content_block_delta",
      index,
      delta: { type: "text_delta", text },
    }),
    sseFrame("content_block_stop", { type: "content_block_stop", index }),
  ].join("");
}

function anthropicToolUseFrames(index: number, turn: CannedTurn): string {
  const json = JSON.stringify(turn.toolInput);
  const half = Math.ceil(json.length / 2);
  return [
    sseFrame("content_block_start", {
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id: turn.toolCallId, name: turn.toolName, input: {} },
    }),
    sseFrame("content_block_delta", {
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: json.slice(0, half) },
    }),
    sseFrame("content_block_delta", {
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: json.slice(half) },
    }),
    sseFrame("content_block_stop", { type: "content_block_stop", index }),
    sseFrame("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: USAGE_OUT },
    }),
    sseFrame("message_stop", { type: "message_stop" }),
  ].join("");
}

function anthropicNonStreamBody(ordinal: number, turn: CannedTurn): unknown {
  return {
    id: `msg_${ordinal}`,
    type: "message",
    role: "assistant",
    model: MODEL_NAME,
    content: [{ type: "tool_use", id: turn.toolCallId, name: turn.toolName, input: turn.toolInput }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: USAGE_IN, output_tokens: USAGE_OUT },
  };
}

// ————————————————————————————————————————————————————————————————
// OpenAI chat completions
// ————————————————————————————————————————————————————————————————

function openaiChunk(
  ordinal: number,
  choice: Record<string, unknown> | undefined,
  extra?: Record<string, unknown>,
): string {
  return sseFrame(undefined, {
    id: `chatcmpl-${ordinal}`,
    object: "chat.completion.chunk",
    created: 1,
    model: MODEL_NAME,
    choices: choice === undefined ? [] : [{ index: 0, finish_reason: null, ...choice }],
    ...extra,
  });
}

function openaiRoleChunk(ordinal: number): string {
  return openaiChunk(ordinal, { delta: { role: "assistant", content: "" } });
}

function openaiVisibleChunk(ordinal: number, text: string): string {
  return openaiChunk(ordinal, { delta: { content: text } });
}

function openaiToolCallFrames(ordinal: number, turn: CannedTurn): string {
  const json = JSON.stringify(turn.toolInput);
  const half = Math.ceil(json.length / 2);
  return [
    openaiChunk(ordinal, {
      delta: {
        tool_calls: [
          {
            index: 0,
            id: turn.toolCallId,
            type: "function",
            function: { name: turn.toolName, arguments: json.slice(0, half) },
          },
        ],
      },
    }),
    openaiChunk(ordinal, {
      delta: { tool_calls: [{ index: 0, function: { arguments: json.slice(half) } }] },
    }),
    openaiChunk(ordinal, { delta: {}, finish_reason: "tool_calls" }),
    openaiChunk(ordinal, undefined, {
      usage: { prompt_tokens: USAGE_IN, completion_tokens: USAGE_OUT, total_tokens: USAGE_IN + USAGE_OUT },
    }),
    "data: [DONE]\n\n",
  ].join("");
}

function openaiNonStreamBody(ordinal: number, turn: CannedTurn): unknown {
  return {
    id: `chatcmpl-${ordinal}`,
    object: "chat.completion",
    created: 1,
    model: MODEL_NAME,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: turn.toolCallId,
              type: "function",
              function: { name: turn.toolName, arguments: JSON.stringify(turn.toolInput) },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: USAGE_IN, completion_tokens: USAGE_OUT, total_tokens: USAGE_IN + USAGE_OUT },
  };
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export function firstFrame(route: WireFormat, ordinal: number): string {
  return route === "anthropic-messages" ? anthropicMessageStart(ordinal) : openaiRoleChunk(ordinal);
}

export function visibleFrame(route: WireFormat, ordinal: number, text: string): string {
  return route === "anthropic-messages" ? anthropicVisibleText(0, text) : openaiVisibleChunk(ordinal, text);
}

export function successStream(route: WireFormat, ordinal: number, turn: CannedTurn): string {
  return route === "anthropic-messages"
    ? anthropicMessageStart(ordinal) + anthropicToolUseFrames(0, turn)
    : openaiRoleChunk(ordinal) + openaiToolCallFrames(ordinal, turn);
}

export function successBody(route: WireFormat, ordinal: number, turn: CannedTurn): string {
  return JSON.stringify(
    route === "anthropic-messages" ? anthropicNonStreamBody(ordinal, turn) : openaiNonStreamBody(ordinal, turn),
  );
}

export function streamErrorFrame(route: WireFormat, code: string, message: string): string {
  if (route === "anthropic-messages") {
    return sseFrame("error", {
      type: "error",
      error: { type: "rate_limit_error", code, message },
    });
  }
  return sseFrame(undefined, { error: { code, message } });
}

export function businessErrorBody(verdict: {
  status: number;
  code?: string;
  message?: string;
  bodyShape?: "error-object" | "top-level";
}): string {
  const message = verdict.message ?? `fake provider status ${verdict.status}`;
  if (verdict.bodyShape === "top-level") {
    return JSON.stringify({
      ...(verdict.code === undefined ? {} : { code: Number(verdict.code) }),
      msg: message,
    });
  }
  return JSON.stringify({
    error: {
      ...(verdict.code === undefined ? {} : { code: verdict.code }),
      message,
      type: "error",
    },
  });
}
