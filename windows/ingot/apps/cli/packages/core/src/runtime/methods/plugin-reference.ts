import { toMcpToolName } from "../../mcp/index.js";
import {
  buildPluginReferenceReminderBody,
  extractPluginReferences,
  type LivePluginMcpServer,
  type LivePluginSkill,
  type LivePluginSubagent,
} from "../../plugin-reference/index.js";
import { createMessageId, traceContextToLogContext } from "../deps.js";
import type { TraceContext } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";

async function collectLiveMcpServers(
  runtime: AgentRuntimeInternal,
  traceContext: TraceContext,
  toolDisallowlist: readonly string[] | undefined,
): Promise<LivePluginMcpServer[]> {
  if (!runtime.mcpPort) return [];
  await runtime.initializeMcp(traceContext);
  const statuses = await runtime.mcpPort.status();
  const snapshot = runtime.mcpStartupPromise ? await runtime.mcpStartupPromise : undefined;
  const registeredToolNames = new Set(runtime.getTools().map((tool) => tool.name));
  const turnDisallowedToolNames = new Set(toolDisallowlist ?? []);
  const providerVisibleToolCounts = new Map<string, number>();
  for (const descriptor of snapshot?.tools ?? []) {
    const toolName = toMcpToolName(descriptor);
    if (!registeredToolNames.has(toolName)) continue;
    if (turnDisallowedToolNames.has(toolName)) continue;
    providerVisibleToolCounts.set(
      descriptor.serverName,
      (providerVisibleToolCounts.get(descriptor.serverName) ?? 0) + 1,
    );
  }
  return Object.entries(statuses).map(([serverName, status]) => ({
    serverName,
    connected: status.status === "connected",
    providerVisibleToolCount: providerVisibleToolCounts.get(serverName) ?? 0,
  }));
}

function collectLivePluginSkills(runtime: AgentRuntimeInternal): LivePluginSkill[] {
  const skills: LivePluginSkill[] = [];
  for (const skill of runtime.skillLoadOutcome?.skills ?? []) {
    if (skill.source !== "plugin") continue;
    if (!skill.pluginName || !skill.qualifiedName) continue;
    skills.push({
      qualifiedName: skill.qualifiedName,
      pluginName: skill.pluginName,
      rootPath: skill.rootPath,
      source: skill.source,
    });
  }
  return skills;
}

function collectLivePluginSubagents(runtime: AgentRuntimeInternal): LivePluginSubagent[] {
  const subagents: LivePluginSubagent[] = [];
  for (const profile of runtime.getAgentDefinitions().activeAgents) {
    const name = profile.name.trim();
    const path = profile.path?.trim();
    if (!name || !path) continue;
    subagents.push({ name, path });
  }
  return subagents;
}

export async function injectPluginReferenceReminderFromTurn(
  this: AgentRuntimeInternal,
  userInput: string,
  traceContext: TraceContext,
  toolDisallowlist?: readonly string[],
): Promise<void> {
  const extraction = extractPluginReferences(userInput);
  if (extraction.references.length === 0) {
    if (extraction.invalidCount > 0) {
      this.logger?.debug("Plugin reference parse rejected invalid destinations", {
        ...traceContextToLogContext(traceContext),
        event: "plugin_reference.parse.invalid",
        invalidCount: extraction.invalidCount,
        module: "core.runtime",
      });
    }
    return;
  }

  const startedAt = Date.now();
  try {
    const liveMcpServers = await collectLiveMcpServers(this, traceContext, toolDisallowlist);
    const liveSkills = collectLivePluginSkills(this);
    const liveSubagents = collectLivePluginSubagents(this);
    const result = buildPluginReferenceReminderBody({
      references: extraction.references,
      catalog: this.config.pluginReferenceCatalog,
      liveSkills,
      liveMcpServers,
      liveSubagents,
    });
    this.logger?.debug("Plugin reference reminder resolved", {
      ...traceContextToLogContext(traceContext),
      durationMs: Date.now() - startedAt,
      event: "plugin_reference.reminder.resolved",
      invalidCount: extraction.invalidCount,
      mcpServerCount: result.diagnostics.mcpServerCount,
      module: "core.runtime",
      referenceCount: extraction.references.length,
      resolvedPluginIds: result.diagnostics.resolvedPluginIds,
      skillCount: result.diagnostics.skillCount,
      subagentCount: result.diagnostics.subagentCount,
      skipped: result.diagnostics.skipped,
      truncated: result.diagnostics.truncated || extraction.truncatedCount > 0,
    });
    if (!result.body) return;
    this.messageHistory.addAttachment("plugin_reference", result.body);
    await this.persistSyntheticUserNoticeForSession({
      messageID: createMessageId(),
      sessionId: this.sessionId,
      source: "plugin_reference",
      text: result.body,
      traceContext,
    });
  } catch (error) {
    this.logger?.debug("Plugin reference reminder generation failed", {
      ...traceContextToLogContext(traceContext),
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      event: "plugin_reference.reminder.failed",
      module: "core.runtime",
      referenceCount: extraction.references.length,
    });
  }
}
