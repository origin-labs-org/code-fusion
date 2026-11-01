import { buildCfStreamingToolInputPreview } from "@origin-ai/cf-shared";
import type { ToolCallRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { TaskChatToolCallTreeNode } from "@/lib/toolCallTree.js";
import { normalizeWrappedErrorText } from "@/lib/toolError.js";

// pending/in_progress/completed/failed/stopped）。
const STATUS_MAP: Record<ToolCallRow["status"], string> = {
  inputStreaming: "pending",
  pendingApproval: "pending",
  running: "in_progress",
  success: "completed",
  error: "failed",
  cancelled: "stopped",
};

interface ResolvedToolInputPreview {
  input: unknown;
  inputPreviewComplete?: boolean;
  streamingRawInputLength?: number;
}

function isEmptyPlainRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function resolveToolInputPreview(row: ToolCallRow): ResolvedToolInputPreview {
  if (row.input !== undefined) {
    return {
      input: row.input,
      inputPreviewComplete: true,
      ...(row.inputText.length > 0 ? { streamingRawInputLength: row.inputText.length } : {}),
    };
  }
  if (!row.inputText) {
    return { input: undefined };
  }
  const preview = buildCfStreamingToolInputPreview(row.inputText);
  return {
    input: isEmptyPlainRecord(preview.input) ? undefined : preview.input,
    inputPreviewComplete: preview.complete,
    streamingRawInputLength: row.inputText.length,
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveV4ToolErrorText(row: ToolCallRow): string | undefined {
  if (row.status !== "error") {
    return undefined;
  }

  const directMessage = readNonEmptyString(row.error?.message);
  if (directMessage) {
    return directMessage;
  }

  const outputText = readNonEmptyString(row.output?.text);
  if (outputText) {
    return normalizeWrappedErrorText(outputText);
  }

  return readNonEmptyString(row.error?.code);
}

export function toolCallRowToLegacyNode(row: ToolCallRow): TaskChatToolCallTreeNode {
  const legacyStatus = STATUS_MAP[row.status];
  const errorText = resolveV4ToolErrorText(row);
  const inputPreview = resolveToolInputPreview(row);
  const display = row.output?.display ?? row.display;
  const legacyDisplay =
    display?.kind === "cua" ? (({ input: _legacyInput, ...rest }) => rest)(display) : display;
  return {
    toolCall: {
      toolId: row.toolCallId,
      toolName: row.toolName,
      kind: row.toolName,
      input: inputPreview.input,
      status: legacyStatus,
      output: row.output?.text,
      ...((row.toolName === "Agent" || row.toolName === "Task") && row.output?.text
        ? { content: row.output.text }
        : {}),
      error: errorText,
      raw: {
        error: row.error,
        rawOutput: row.output?.text,
        outputPreview: row.outputPreview,
        outputTruncated: row.output?.truncated,
        status: legacyStatus,
        toolCallId: row.toolCallId,
        toolName: row.toolName,
        v4Status: row.status,
        ...(row.cuaApp ? { cuaApp: row.cuaApp } : {}),
        ...(legacyDisplay ? { display: legacyDisplay } : {}),
        ...(row.progress ? { progress: row.progress } : {}),
        inputPreviewComplete: inputPreview.inputPreviewComplete,
        streamingRawInputLength: inputPreview.streamingRawInputLength,
      },
      startedAt: typeof row.startedAt === "number" ? row.startedAt : undefined,
    },
    childToolCalls: [],
  };
}
