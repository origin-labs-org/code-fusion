import {
  TID_CHAT_ASSISTANT_HISTORY_CONTENT,
  TID_CHAT_ASSISTANT_HISTORY_TRIGGER,
  TID_CHAT_ASSISTANT_MESSAGE,
} from "@origin-ai/cf-shared/test-ids";
import {
  getLatestUpstreamToolResultByToolCallId,
  type UpstreamToolResultSnapshot,
} from "./conversation-session-network.js";
import {
  expandAssistantHistoriesWithContent,
  expandVisibleToolCallGroups,
  getToolCallDiagnostics,
  type ToolCallBlockSnapshot,
  type ToolCallDiagnostics,
  type ToolCallMatcher,
} from "./conversation-session-tool-diagnostics.js";

export { expandAssistantHistoriesWithContent } from "./conversation-session-tool-diagnostics.js";

interface AssistantHistoryOpenSnapshot {
  assistantText: string;
  contentExists: boolean;
  contentOpen: string | null;
  expanded: boolean;
  reason: string | null;
  triggerTestId: string | null;
}

export async function waitForToolCallBlockContaining(
  text: string,
  timeout = 20000,
): Promise<ToolCallBlockSnapshot> {
  return waitForToolCallBlock({ type: "text", value: text }, timeout);
}

export async function waitForToolCallBlockByToolName(
  toolName: string,
  timeout = 20000,
): Promise<ToolCallBlockSnapshot> {
  return waitForToolCallBlock({ type: "toolName", value: toolName }, timeout);
}

export async function waitForToolCallBlockByToolCallId(
  toolCallId: string,
  timeout = 20000,
): Promise<ToolCallBlockSnapshot> {
  return waitForToolCallBlock({ type: "toolCallId", value: toolCallId }, timeout);
}

export async function listToolCallBlocks(): Promise<ToolCallBlockSnapshot[]> {
  const diagnostics = await getToolCallDiagnostics(null);
  return diagnostics.blocks;
}

export interface SuccessfulToolCallSnapshot {
  output: string;
  status: "completed";
  toolCallId: string;
  toolName: string | null;
}

export async function assertToolCallNotFailedByToolCallId(
  toolCallId: string,
): Promise<void> {
  const diagnostics = await getToolCallDiagnostics({
    type: "toolCallId",
    value: toolCallId,
  });
  const toolCall = findRendererStoreToolCall(diagnostics, toolCallId);
  if (
    toolCall?.status === "failed" ||
    diagnostics.matchedBlock?.status === "failed"
  ) {
    throw createToolCallFailure(
      toolCallId,
      toolCall,
      diagnostics.matchedBlock,
    );
  }
  const providerResult =
    await getLatestUpstreamToolResultByToolCallId(toolCallId);
  if (providerResult?.isError) {
    throw createProviderToolResultFailure(providerResult);
  }
}

export async function waitForSuccessfulToolCallByToolCallId(
  toolCallId: string,
  expectedOutputIncludes: readonly string[] = [],
  timeout = 20000,
): Promise<SuccessfulToolCallSnapshot> {
  const deadline = Date.now() + timeout;
  let latest: ReturnType<typeof findRendererStoreToolCall> = null;
  while (Date.now() <= deadline) {
    const diagnostics = await getToolCallDiagnostics({
      type: "toolCallId",
      value: toolCallId,
    });
    latest = findRendererStoreToolCall(diagnostics, toolCallId);
    const block = diagnostics.matchedBlock;
    if (latest?.status === "failed" || block?.status === "failed") {
      throw createToolCallFailure(toolCallId, latest, block);
    }
    const providerResult =
      await getLatestUpstreamToolResultByToolCallId(toolCallId);
    if (providerResult?.isError) {
      throw createProviderToolResultFailure(providerResult);
    }
    if (latest?.status === "completed") {
      const output = latest.output ?? "";
      assertToolResultContains(toolCallId, output, expectedOutputIncludes);
      return {
        output,
        status: "completed",
        toolCallId: latest.toolId ?? toolCallId,
        toolName: latest.toolName,
      };
    }
    if (providerResult) {
      assertToolResultContains(
        toolCallId,
        providerResult.content,
        expectedOutputIncludes,
      );
      return {
        output: providerResult.content,
        status: "completed",
        toolCallId,
        toolName: block?.toolName ?? latest?.toolName ?? null,
      };
    }
    if (
      block?.status === "completed" &&
      expectedOutputIncludes.length === 0
    ) {
      return {
        output: block.text,
        status: "completed",
        toolCallId: block.toolCallId ?? toolCallId,
        toolName: block.toolName,
      };
    }
    await new Promise<void>((resolveDelay) =>
      setTimeout(resolveDelay, 100),
    );
  }
  throw new Error(
    `toolCallId=${toolCallId} 没有在 ${timeout}ms inner成功Completed; latest=${JSON.stringify(
      latest,
    )}`,
  );
}

export async function openAssistantHistoryForAssistantContaining(
  text: string,
  timeout = 15000,
): Promise<AssistantHistoryOpenSnapshot> {
  let latest: AssistantHistoryOpenSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await clickAssistantHistoryForAssistantContaining(text);
        return latest.expanded;
      },
      {
        timeout,
        timeoutMsg: `没有展开包含Point to定inner容的 assistant history: ${text}`,
      },
    );
  } catch {
    latest = await safeClickAssistantHistoryForAssistantContaining(text, latest);
    throw new Error(
      `没有展开包含Point to定inner容的 assistant history: ${text}; latest=${JSON.stringify(
        latest,
      )}`,
    );
  }
  const result = await clickAssistantHistoryForAssistantContaining(text);
  if (!result.expanded) {
    throw new Error(
      `assistant history Waiting后仍未展开: ${text}; latest=${JSON.stringify(result)}`,
    );
  }
  return result;
}

export function getToolCallBlockContaining(
  text: string,
): Promise<ToolCallBlockSnapshot | null> {
  return getMatchingToolCallBlock({ type: "text", value: text });
}

export function getToolCallBlockByToolName(
  toolName: string,
): Promise<ToolCallBlockSnapshot | null> {
  return getMatchingToolCallBlock({ type: "toolName", value: toolName });
}

export function getToolCallBlockByToolCallId(
  toolCallId: string,
): Promise<ToolCallBlockSnapshot | null> {
  return getMatchingToolCallBlock({ type: "toolCallId", value: toolCallId });
}

async function waitForToolCallBlock(
  matcher: ToolCallMatcher,
  timeout: number,
): Promise<ToolCallBlockSnapshot> {
  let latest: ToolCallDiagnostics | null = null;
  let matchedBlock: ToolCallBlockSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getToolCallDiagnostics(matcher);
        if (latest.matchedBlock?.exists === true) {
          matchedBlock = latest.matchedBlock;
          return true;
        }
        await expandAssistantHistoriesWithContent();
        await expandVisibleToolCallGroups();
        return false;
      },
      {
        timeout,
        timeoutMsg: `没有出现匹配的 tool call block: ${JSON.stringify(matcher)}`,
      },
    );
  } catch {
    latest = await safeGetToolCallDiagnostics(matcher, latest);
    throw new Error(
      `没有出现匹配的 tool call block: ${JSON.stringify(
        matcher,
      )}; diagnostics=${JSON.stringify(latest)}`,
    );
  }
  if (!matchedBlock) {
    latest = await safeGetToolCallDiagnostics(matcher, latest);
    throw new Error(
      `tool call block Waiting后仍不存在: ${JSON.stringify(
        matcher,
      )}; diagnostics=${JSON.stringify(latest)}`,
    );
  }
  return matchedBlock;
}

async function getMatchingToolCallBlock(
  matcher: ToolCallMatcher,
): Promise<ToolCallBlockSnapshot | null> {
  const diagnostics = await getToolCallDiagnostics(matcher);
  return diagnostics.matchedBlock;
}

function findRendererStoreToolCall(
  diagnostics: ToolCallDiagnostics,
  toolCallId: string,
) {
  for (const message of diagnostics.rendererStore.messages) {
    const match = message.toolCalls.find(
      (toolCall) =>
        toolCall.toolId === toolCallId ||
        toolCall.toolId?.startsWith(`${toolCallId}:`) === true,
    );
    if (match) return match;
  }
  return null;
}

function createToolCallFailure(
  toolCallId: string,
  toolCall: ReturnType<typeof findRendererStoreToolCall>,
  block: ToolCallBlockSnapshot | null,
): Error {
  return new Error(
    `toolCallId=${toolCallId} Execution failed; error=${JSON.stringify(
      toolCall?.error,
    )}; ` +
      `rawError=${JSON.stringify(
        toolCall?.rawErrorMessage ?? toolCall?.rawErrorDetail,
      )}; ` +
      `output=${JSON.stringify(toolCall?.output)}; block=${JSON.stringify(
        block,
      )}`,
  );
}

function createProviderToolResultFailure(
  result: UpstreamToolResultSnapshot,
): Error {
  return new Error(
    `toolCallId=${result.toolCallId} Execution failed; providerToolResult=${JSON.stringify(
      result.content,
    )}; isError=true`,
  );
}

function assertToolResultContains(
  toolCallId: string,
  output: string,
  expectedOutputIncludes: readonly string[],
): void {
  const missing = expectedOutputIncludes.filter(
    (value) => !output.includes(value),
  );
  if (missing.length > 0) {
    throw new Error(
      `toolCallId=${toolCallId} 已Back tool_result，但ResultMissing ${JSON.stringify(
        missing,
      )}; output=${output}`,
    );
  }
}

async function safeGetToolCallDiagnostics(
  matcher: ToolCallMatcher,
  fallback: ToolCallDiagnostics | null,
): Promise<ToolCallDiagnostics | null> {
  try {
    return await getToolCallDiagnostics(matcher);
  } catch {
    return fallback;
  }
}

function clickAssistantHistoryForAssistantContaining(
  text: string,
): Promise<AssistantHistoryOpenSnapshot> {
  return browser.execute(
    (
      assistantMessagePrefix,
      historyTriggerPrefix,
      historyContentPrefix,
      expectedText,
    ) => {
      const normalizeText = (value: string) =>
        value.replace(/\u00a0/g, " ").trim();
      const assistantMessages = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-testid^="${assistantMessagePrefix}-"]`,
        ),
      );
      const assistantMessage = assistantMessages.find((message) =>
        normalizeText(message.innerText).includes(expectedText),
      );
      if (!assistantMessage) {
        return {
          assistantText: assistantMessages
            .map((message) => normalizeText(message.innerText))
            .join("\n---\n"),
          contentExists: false,
          contentOpen: null,
          expanded: false,
          reason: "assistant-not-found",
          triggerTestId: null,
        };
      }

      const trigger = assistantMessage.querySelector<HTMLElement>(
        `[data-testid^="${historyTriggerPrefix}-"]`,
      );
      if (!trigger) {
        return {
          assistantText: normalizeText(assistantMessage.innerText),
          contentExists: false,
          contentOpen: null,
          expanded: false,
          reason: "history-trigger-not-found",
          triggerTestId: null,
        };
      }

      const stateKey = trigger.getAttribute("data-history-state-key");
      const content =
        stateKey !== null
          ? document.querySelector<HTMLElement>(
              `[data-testid^="${historyContentPrefix}-"][data-history-state-key="${stateKey}"]`,
            )
          : null;
      const expanded =
        trigger.getAttribute("aria-expanded") === "true" ||
        trigger.getAttribute("data-history-open") === "true";
      if (!expanded) {
        trigger.click();
      }

      return {
        assistantText: normalizeText(assistantMessage.innerText),
        contentExists: Boolean(content),
        contentOpen: content?.getAttribute("data-history-open") ?? null,
        expanded,
        reason: expanded ? null : "clicked-history-trigger",
        triggerTestId: trigger.getAttribute("data-testid"),
      };
    },
    TID_CHAT_ASSISTANT_MESSAGE,
    TID_CHAT_ASSISTANT_HISTORY_TRIGGER,
    TID_CHAT_ASSISTANT_HISTORY_CONTENT,
    text,
  );
}

async function safeClickAssistantHistoryForAssistantContaining(
  text: string,
  fallback: AssistantHistoryOpenSnapshot | null,
): Promise<AssistantHistoryOpenSnapshot | null> {
  try {
    return await clickAssistantHistoryForAssistantContaining(text);
  } catch {
    return fallback;
  }
}
