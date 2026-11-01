//
import { useEffect, useMemo, useState } from "react";
import type { ConversationRow, ToolCallRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { TaskChatMessage } from "@/lib/taskChatMessageTypes.js";
import { useServices } from "@/hooks/useServices.js";
import { createAgentConversationTransport } from "@/v4/agentConversationTransport.js";
import { SessionDataLayer, type SessionLease } from "@/v4/sessionDataLayer.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { toolCallRowToLegacyNode } from "@/v4/toolCallRowAdapter.js";

const ASSISTANT_TURN_ROW_KINDS = new Set<ConversationRow["kind"]>([
  "assistantText",
  "reasoning",
  "toolCall",
  "subagent",
]);

export function buildTreemappingMessageFromRows(
  rows: readonly ConversationRow[],
): TaskChatMessage | null {
  let lastAssistantTurnId: string | null = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (ASSISTANT_TURN_ROW_KINDS.has(row.kind)) {
      lastAssistantTurnId = row.turnId;
      break;
    }
  }
  if (lastAssistantTurnId === null) {
    return null;
  }

  const turnRows = rows.filter((row) => row.turnId === lastAssistantTurnId);
  const toolCallRows = turnRows.filter(
    (row): row is ToolCallRow => row.kind === "toolCall",
  );
  const streaming = turnRows.some(
    (row) =>
      ((row.kind === "assistantText" || row.kind === "reasoning") &&
        row.state === "streaming") ||
      (row.kind === "toolCall" &&
        (row.status === "inputStreaming" || row.status === "running")),
  );

  return {
    id: `v4-turn-${lastAssistantTurnId}`,
    role: "assistant",
    content: "",
    timestamp: 0,
    streaming: streaming || undefined,
    toolCalls: toolCallRows.map((row) => toolCallRowToLegacyNode(row).toolCall),
  };
}

export function useTreemappingConversationMessage(params: {
  sessionId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
}): TaskChatMessage | null {
  const { sessionId, workspacePath, workspaceIdentity } = params;
  const { cfAgentService } = useServices();
  const layer = useMemo(
    () =>
      new SessionDataLayer({
        transport: createAgentConversationTransport(cfAgentService, {
          workspacePath,
          workspaceIdentity,
        }),
      }),
    [cfAgentService, workspacePath, workspaceIdentity],
  );
  useEffect(() => {
    return () => layer.dispose();
  }, [layer]);

  const [lease, setLease] = useState<SessionLease | null>(null);
  useEffect(() => {
    if (!sessionId) {
      setLease(null);
      return;
    }
    const nextLease = layer.acquire(sessionId);
    setLease(nextLease);
    return () => {
      nextLease.release();
    };
  }, [layer, sessionId]);

  const state = useConversationProjection(lease);
  const rows = state.snapshot?.rows.window;
  return useMemo(
    () => (rows ? buildTreemappingMessageFromRows(rows) : null),
    [rows],
  );
}
