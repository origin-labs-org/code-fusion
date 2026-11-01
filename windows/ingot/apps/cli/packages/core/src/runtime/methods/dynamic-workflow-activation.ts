// ============================================================
// ============================================================
//

import {
  SESSION_ENTRY_DYNAMIC_WORKFLOW_ACTIVATION,
  type MessageWithParts,
  type SessionEntryInfo,
  type SessionId,
  type TraceContext,
} from "@origin-ai/cf-contracts";
import { traceContextToLogContext } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { AgentRuntimeConfig } from "../types.js";
import { isDynamicWorkflowToolName } from "../../tool/index.js";
import { refreshBranchAwareBuiltInTools } from "./embedded-search-branch.js";

export type DynamicWorkflowActivationSource =
  | "command"
  | "run_control"
  | "resume_entry"
  | "resume_history";

export interface DynamicWorkflowActivationEntryData {
  activated: true;
  source: DynamicWorkflowActivationSource;
}

const WORKFLOW_COMMAND_TEXT_PATTERN = /^\/workflow(?:\s|$)/i;

export function resolveInitialDynamicWorkflowToolsActivated(config: AgentRuntimeConfig): boolean {
  return config.dynamicWorkflowToolsOnDemand !== true;
}

export async function activateDynamicWorkflowTools(
  this: AgentRuntimeInternal,
  input: { source: DynamicWorkflowActivationSource; traceContext?: TraceContext },
): Promise<boolean> {
  if (this.dynamicWorkflowToolsActivated) return false;
  markDynamicWorkflowToolsActivated(this, input.source);
  try {
    await persistDynamicWorkflowActivation(this);
  } catch (error) {
    this.logger?.warn("Dynamic workflow activation entry write failed", {
      ...traceContextToLogContext(input.traceContext ?? this.rootTraceContext),
      error: error instanceof Error ? error.message : String(error),
      event: "dynamic_workflow.activation_entry_write_failed",
      module: "core.runtime",
      sessionId: this.sessionId,
    });
  }
  this.logger?.info("Dynamic workflow tools activated", {
    ...traceContextToLogContext(input.traceContext ?? this.rootTraceContext),
    event: "dynamic_workflow.tools_activated",
    module: "core.runtime",
    sessionId: this.sessionId,
    source: input.source,
  });
  return true;
}

export async function restoreDynamicWorkflowActivationOnResume(
  this: AgentRuntimeInternal,
  messages: readonly MessageWithParts[],
): Promise<void> {
  if (this.dynamicWorkflowToolsActivated) return;
  const entries = await this.sessionStore?.sessionEntries?.({
    sessionID: this.sessionId,
    type: SESSION_ENTRY_DYNAMIC_WORKFLOW_ACTIVATION,
  });
  const source: DynamicWorkflowActivationSource | undefined =
    entries !== undefined && entries.length > 0
      ? "resume_entry"
      : persistedMessagesShowDynamicWorkflow(messages)
        ? "resume_history"
        : undefined;
  if (source === undefined) return;
  markDynamicWorkflowToolsActivated(this, source);
  if (source === "resume_history") await writeDynamicWorkflowActivationEntryIfActivated(this);
}

export function persistedMessagesShowDynamicWorkflow(
  messages: readonly MessageWithParts[],
): boolean {
  for (const message of messages) {
    const role = message.info.role;
    for (const part of message.parts) {
      if (
        role === "user" &&
        part.type === "text" &&
        WORKFLOW_COMMAND_TEXT_PATTERN.test(part.text.trim())
      )
        return true;
      if (role === "assistant" && part.type === "tool" && isDynamicWorkflowToolName(part.tool))
        return true;
    }
  }
  return false;
}

export async function writeDynamicWorkflowActivationEntryIfActivated(
  runtime: AgentRuntimeInternal,
): Promise<void> {
  if (runtime.config.dynamicWorkflowToolsOnDemand !== true) return;
  if (
    !runtime.dynamicWorkflowToolsActivated ||
    runtime.dynamicWorkflowActivationSource === undefined
  )
    return;
  await runtime.sessionStore?.saveSessionEntry?.(
    buildDynamicWorkflowActivationEntry(runtime.sessionId, runtime.dynamicWorkflowActivationSource),
  );
}

export function buildDynamicWorkflowActivationEntry(
  sessionId: SessionId,
  source: DynamicWorkflowActivationSource,
): SessionEntryInfo {
  const timestamp = Date.now();
  const data: DynamicWorkflowActivationEntryData = { activated: true, source };
  return {
    id: `${sessionId}:runtime-dynamic-workflow-activation`,
    sessionID: sessionId,
    type: SESSION_ENTRY_DYNAMIC_WORKFLOW_ACTIVATION,
    touchSession: false,
    time: { created: timestamp, updated: timestamp },
    data,
  };
}

function markDynamicWorkflowToolsActivated(
  runtime: AgentRuntimeInternal,
  source: DynamicWorkflowActivationSource,
): void {
  runtime.dynamicWorkflowToolsActivated = true;
  runtime.dynamicWorkflowActivationSource = source;
  refreshBranchAwareBuiltInTools(runtime);
}

async function persistDynamicWorkflowActivation(runtime: AgentRuntimeInternal): Promise<void> {
  if (!runtime.sessionPersisted) return;
  await writeDynamicWorkflowActivationEntryIfActivated(runtime);
}
