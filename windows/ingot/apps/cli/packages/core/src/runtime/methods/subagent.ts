
import {
  RESPOND_TO_COORDINATOR_TOOL_NAME,
  SESSION_ENTRY_MODEL_SELECTION,
  parseModelSelectionValue,
} from "@origin-ai/cf-contracts";
import type { SubagentRunOptions } from "@origin-ai/cf-contracts";
import { inheritPermissionMode } from "@origin-ai/cf-contracts";
import {
  defaultScheduler,
  PermissionService,
  defaultPermissionConfig,
  buildExploreAllowedTools,
  buildExploreAgentPrompt,
  createExploreSubagentPort,
  createCoreError,
  CoreErrorType,
} from "../deps.js";
import type {
  ExploreSubagentRuntimeRequest,
  McpConnectionSnapshot,
  McpPort,
  Model,
  ModelSelection,
  SkillContent,
  SkillLoadOutcome,
  SkillOperationOptions,
  SkillPort,
  SubagentPort,
} from "../deps.js";
import { AgentRuntime } from "../agent-runtime.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { cloneModelSelection } from "../model-selection.js";
import { resolveSubagentSelection } from "../helpers/subagent-selection.js";
import type { AgentRuntimeDeps } from "../types.js";
import { toMcpToolName } from "../../mcp/index.js";
import { createBorrowedSubagentMcpAccess } from "../../subagent/borrowed-mcp-port.js";
import { createSubagentMessageSink } from "../../subagent/message-steering.js";
import {
  extractRequiredMcpServerNames,
  matchesRequiredMcpServer,
} from "../../subagent/mcp-config.js";
import { mirrorSubagentToolEvent } from "../../subagent/tool-event-mirror.js";
import { isBuiltInExploreAgentProfile } from "../../subagent/profile.js";
import {
  buildSubagentChildDisallowRules,
  filterSubagentChildToolNames,
} from "../../subagent/tool-policy.js";
import { isSubagentDispatchToolName } from "../../tool/compat.js";
import { resolveEmbeddedSearchBranchCapability } from "../../embedded-search/capability.js";
import { getSessionShellEnvironment } from "./session-shell-environment.js";
import { deriveChildClientPorts } from "../helpers/child-client-ports.js";
import { createCoordinatorResponsePort } from "../../subagent/coordinator-response.js";
import { isStaleBranchRuntimeTaskEvent } from "./runtime-command-generation.js";
import { loadPersistentAgentMemory } from "../../subagent/persistent-memory.js";
import {
  createOfficialCuaPolicy,
  SUBAGENT_COMPUTER_USE_UNAVAILABLE_CODE,
  SUBAGENT_COMPUTER_USE_UNAVAILABLE_MESSAGE,
  type OfficialCuaPolicy,
} from "../../subagent/computer-use-policy.js";
import { computeOfficialCuaServerNames } from "./mcp.js";
import { persistRuntimeModelSelection, sameModelSelection } from "./turn-model.js";
import { getOffPeakExecution, markTemporaryRuntimeSelection } from "../off-peak/runtime.js";
import { getOffPeakModelBinding } from "../off-peak/model-binding.js";

export function createDefaultSubagentPort(
  this: AgentRuntimeInternal,
  deps: AgentRuntimeDeps,
): SubagentPort | undefined {
  if (this.config.subagents?.enabled === false) {
    return undefined;
  }

  return createExploreSubagentPort({
    logger: this.logger,
    inactivityTimeoutMs: this.config.subagents?.inactivityTimeoutMs,
    autoBackgroundMs: this.config.subagents?.autoBackgroundMs,
    outputRootDir: this.config.subagents?.outputRootDir,
    getAgentDefinitions: this.getAgentDefinitions,
    builtInModelSelectionOverrides: this.config.subagents?.builtInModelSelectionOverrides,
    runtimeTaskRegistry: this.runtimeTaskRegistry,
    emitParentEvent: async (event, traceContext) => {
      if (isStaleBranchRuntimeTaskEvent(this, event)) return;
      await this.appendEvent(event, traceContext);
    },
    enqueueParentTaskNotification: (notification) => {
      this.enqueueBackgroundTaskNotification({
        originMeta: notification.originMeta,
        taskId: notification.taskId,
        text: notification.text,
        traceContext: notification.traceContext,
      });
      return undefined;
    },
    getAllowedTools: () => {
      return buildExploreAllowedTools({
        embeddedSearchEnabled: resolveSubagentEmbeddedSearchEnabled(),
      });
    },
    runExploreAgent: async (request, options) => {
      const offPeak = getOffPeakExecution(this);
      const childBinding = offPeak?.createChildBinding();
      if (offPeak && !offPeak.lifecycle.terminal) {
        const selection = offPeak.lifecycle.ownedByUser
          ? this.getSessionModelSelection()
          : offPeak.selection;
        if (selection)
          options = {
            ...options,
            modelOverride: {
              selection,
              requestDependencies: childBinding?.requestDependencies,
              background: "allow",
            },
          };
      }
      try {
        request.reportActivity?.();
        const builtInExplore = isBuiltInExploreAgentProfile(request.profile);
        const agentsMdInstructions =
          request.profile.injectAgentsMd !== false
            ? this.contextSourceSnapshot?.userInstructions
            : undefined;
        const { selection: profileChildSelection, hasConcreteModel } = resolveSubagentSelection({
          profileSelection: request.profile.modelSelection,
          parentSelection: this.getSessionModelSelection(),
          overrideSelection: options?.modelOverride?.selection,
          resolveSelection: deps.resolveEffectiveModelSelection,
        });
        const modelOverride = options?.modelOverride;
        const inheritedModel = !modelOverride && !hasConcreteModel ? options?.model : undefined;
        const childSelection = inheritedModel
          ? modelSelectionFromActiveModel(inheritedModel)
          : profileChildSelection;
        const embeddedSearchEnabled = resolveSubagentEmbeddedSearchEnabled();
        const baseChildEnvInfo = this.contextSourceSnapshot?.envInfo ??
          this.config.envInfo ?? {
            cwd: request.workingDirectory,
            platform: "unknown",
            shell: "unknown",
            osVersion: "unknown",
            nodeVersion: "unknown",
          };
        const shellEnvironment = getSessionShellEnvironment(this);
        const bashShellSelection = shellEnvironment?.selection;
        const childEnvInfo = {
          ...baseChildEnvInfo,
          ...(shellEnvironment ? { shell: shellEnvironment.promptShell } : {}),
        };
        const baseAgentPrompt =
          builtInExplore && request.systemPrompt?.trim() === ""
            ? buildExploreAgentPrompt({ embeddedSearchEnabled })
            : request.systemPrompt?.trim();
        const persistentMemory = await loadPersistentAgentMemory({
          fileSystemPort: deps.fileSystemPort,
          logger: this.logger,
          memory: this.config.memory,
          profile: request.profile,
          traceContext: request.traceContext,
          workspaceRoot: request.workspaceRoot,
        });
        const agentPrompt = [baseAgentPrompt, persistentMemory?.prompt]
          .filter((part): part is string => typeof part === "string" && part.length > 0)
          .join("\n\n");
        const childRuntimeEnvInfo = {
          ...childEnvInfo,

          cwd: request.workingDirectory,
        };
        const officialCuaServerNames = computeOfficialCuaServerNames(
          this.config.mcp?.servers ?? {},
          new Set(this.config.mcp?.trustedOfficialCuaServerNames ?? []),
        );
        const preflightCuaPolicy = createOfficialCuaPolicy(
          officialCuaServerNames,
          [],
          this.config.pluginReferenceCatalog,
        );
        await validateSubagentComputerUseConfiguration(request, preflightCuaPolicy, this.skillPort);
        const childMcpAccess = await resolveSubagentMcpAccess.call(
          this,
          request,
          officialCuaServerNames,
        );
        const childToolAllowlist = resolveSubagentToolAllowlist.call(
          this,
          request,
          childMcpAccess.snapshot?.tools.map((descriptor) => toMcpToolName(descriptor)) ?? [],
        );
        validateSubagentMcpRequirements(request, childToolAllowlist, childMcpAccess);
        const childMode = resolveSubagentPermissionMode(
          this.getPlanEnabled() ? "plan" : this.config.mode,
          request.permissionMode,
          builtInExplore,
        );
        const childCuaPolicy = createOfficialCuaPolicy(
          officialCuaServerNames,
          childMcpAccess.parentSnapshot?.tools ?? childMcpAccess.snapshot?.tools ?? [],
          this.config.pluginReferenceCatalog,
        );
        await validateSubagentComputerUseConfiguration(request, childCuaPolicy, this.skillPort);
        const childSkillPort = resolveSubagentSkillPort(
          this.skillPort,
          request.profile.skills,
          childCuaPolicy,
        );
        const baseChildModelFactory = modelOverride
          ? createSubagentOverrideModelFactory(modelOverride, this.modelFactory)
          : inheritedModel
            ? createInheritedSubagentModelFactory(childSelection, inheritedModel, this.modelFactory)
            : this.modelFactory;
        if (!baseChildModelFactory) {
          throw createCoreError(
            CoreErrorType.ConfigurationError,
            `Subagent model factory cannot resolve ${childSelection.providerId}/${childSelection.modelId}`,
            { recoverable: true },
          );
        }
        const childModel = baseChildModelFactory({ selection: childSelection });
        const childModelFactory: NonNullable<AgentRuntimeDeps["modelFactory"]> = (target) =>
          target.selection.providerId === childSelection.providerId &&
          target.selection.modelId === childSelection.modelId &&
          target.selection.options?.reasoningLevel === childSelection.options?.reasoningLevel
            ? childModel
            : baseChildModelFactory(target);
        const parentToolCallId = traceStringAttribute(request.traceContext, "parentToolCallId");
        const childClientPorts = deriveChildClientPorts(
          {
            permissionBroker: this.permissionBroker,
            ...(this.providerRuntimeHeadersPort === undefined
              ? {}
              : { providerRuntimeHeadersPort: this.providerRuntimeHeadersPort }),
          },
          {
            agentId: request.agentId,
            agentType: request.agentType,
            childSessionId: request.sessionId,
            description: request.description,
            parentSessionId: this.sessionId,
            parentToolCallId,
            ...(request.traceContext.turnId === undefined
              ? {}
              : { parentTurnId: request.traceContext.turnId }),
          },
        );
        const childBrowserControlPort =
          this.browserControlPort?.forChildSession?.({
            childSessionId: request.sessionId,
            parentSessionId: this.sessionId,
            tabOwner: "parent",
          }) ?? this.browserControlPort;
        const mirroredToolNameByChildToolCallId = new Map<string, string>();
        let sessionReadyNotified = false;
        const notifySessionReady = async () => {
          if (sessionReadyNotified) return;
          await request.onSessionReady?.();
          sessionReadyNotified = true;
        };
        this.logger?.debug("Starting subagent child runtime", {
          parentSessionId: this.sessionId,
          childSessionId: request.sessionId,
          agentType: request.agentType,
        });
        const childRuntime = new AgentRuntime(
          request.sessionId,
          {
            mode: childMode === "plan" ? this.config.mode : childMode,
            planEnabled: childMode === "plan",
            modelSelection: cloneModelSelection(childSelection),
            modelContextBudgetStrategy: this.config.modelContextBudgetStrategy,
            workingDirectory: request.workingDirectory,
            envInfo: childRuntimeEnvInfo,
            modelStreaming: this.config.modelStreaming,
            bashTimeoutPolicy: this.config.bashTimeoutPolicy,
            midConversationSystem: this.config.midConversationSystem,
            toolSearch: this.config.toolSearch,
            bashShellSelection,
            currentDate: this.contextSourceSnapshot?.currentDate ?? this.config.currentDate,
            subagentContext: {
              agentPrompt: agentPrompt ?? "",
              ...(agentsMdInstructions ? { userInstructions: agentsMdInstructions } : {}),
            },
            agentName: `cf-${request.agentType}`,
            maxTurns: request.maxTurns ?? this.config.subagents?.maxTurns ?? 4,
            parentSessionId: this.sessionId,
            taskType: "subagent_child",
            dynamicWorkflowEnabled: this.config.dynamicWorkflowEnabled,
            dynamicWorkflowToolsOnDemand:
              this.config.dynamicWorkflowToolsOnDemand === true &&
              !this.dynamicWorkflowToolsActivated,
            toolset: builtInExplore ? "explore" : "main",
            toolAllowlist: childToolAllowlist,
            toolDisallowlist: this.config.toolDisallowlist,
            embeddedSearchBackend: this.config.embeddedSearchBackend,
            nativeSearchEnhancementsEnabled: this.config.nativeSearchEnhancementsEnabled,
            subagents: {
              backgroundBashMaxMs: this.config.subagents?.backgroundBashMaxMs,
              enabled: false,
            },
            mcp: childMcpAccess.config,
          },
          {
            agentTelemetry: this.agentTelemetry.port,
            agentTelemetryCausation: this.agentTelemetry.captureCausation(),
            agentTelemetryCausationMode: request.background ? "linked_root" : "child",
            eventStore: this.eventStore,
            sessionStore: deps.sessionStore,
            modelRequestAdmission: this.modelRequestAdmission,
            modelFactory: childModelFactory,
            resolveEffectiveModelSelection: deps.resolveEffectiveModelSelection,
            ...childClientPorts,
            ...(childBrowserControlPort === undefined
              ? {}
              : { browserControlPort: childBrowserControlPort }),
            coordinatorResponsePort: createCoordinatorResponsePort({
              agentId: request.agentId,
              agentType: request.agentType,
              childSessionId: request.sessionId,
              parentToolCallId,
              enqueue: (input) => this.enqueueSubagentMessage(input),
            }),
            permissionService: builtInExplore
              ? new PermissionService(defaultPermissionConfig)
              : this.permissionService,
            toolScheduler: deps.toolScheduler ?? defaultScheduler,
            executionPort: deps.executionPort,
            fileSystemPort: deps.fileSystemPort,
            httpClientPort: deps.httpClientPort,
            imageProcessorPort: deps.imageProcessorPort,
            pdfDocumentPort: deps.pdfDocumentPort,
            memoryRoot: persistentMemory?.rootDir,
            mcpPort: childMcpAccess.port,
            skillPort: childSkillPort,
            artifactStore: deps.artifactStore,
            appVersion: this.appVersion,
            eventSink: {
              onSessionEvent: async (event) => {
                request.reportActivity?.();
                await this.notifyEventSinks(event, {
                  ...request.traceContext,
                  sessionId: request.sessionId,
                });
                const mirroredEvent = mirrorSubagentToolEvent(event, {
                  agentId: request.agentId,
                  agentType: request.agentType,
                  background: request.background,
                  childSessionId: request.sessionId,
                  description: request.description,
                  parentSessionId: this.sessionId,
                  parentToolCallId,
                  parentTurnId: request.traceContext.turnId,
                  toolNameByChildToolCallId: mirroredToolNameByChildToolCallId,
                });
                if (!mirroredEvent) return;

                await this.notifyEventSinks(mirroredEvent, {
                  ...request.traceContext,
                  sessionId: this.sessionId,
                });
              },
            },
            logger: this.logger,
            traceContext: request.traceContext,
          },
        );

        const resumesExistingChild = request.resumeFromStore === true;
        if (childBinding)
          markTemporaryRuntimeSelection(
            childRuntime as unknown as AgentRuntimeInternal,
            offPeak?.ordinarySelection,
          );
        let previousSelection: ModelSelection | undefined;
        if (resumesExistingChild) {
          const persistedMessages = await this.sessionStore?.messages({
            sessionID: request.sessionId,
          });
          if (!persistedMessages?.length) {
            throw createCoreError(
              CoreErrorType.SessionNotFound,
              `No transcript found for agent ${request.agentId}`,
              { recoverable: true },
            );
          }
          const entries = await this.sessionStore?.sessionEntries?.({
            sessionID: request.sessionId,
            type: SESSION_ENTRY_MODEL_SELECTION,
          });
          previousSelection = parseModelSelectionValue(entries?.at(-1)?.data);
          await childRuntime.resumeFromStore({
            persistedMessages,
            traceContext: request.traceContext,
          });
          await persistRuntimeModelSelection(
            childRuntime as unknown as AgentRuntimeInternal,
            childSelection,
          );
        } else {
          await childRuntime.ensureSessionPersistedForExternalActivity(request.prompt, {
            traceContext: request.traceContext,
          });
        }
        await notifySessionReady();
        if (
          !resumesExistingChild ||
          (previousSelection && !sameModelSelection(previousSelection, childSelection))
        ) {
          childRuntime.recordPendingModelChange({
            ...(previousSelection
              ? {
                  fromModel: previousSelection,
                  fromModelLabel: `${previousSelection.providerId}/${previousSelection.modelId}`,
                }
              : {}),
            toModel: childSelection,
            toModelLabel: `${childSelection.providerId}/${childSelection.modelId}`,
          });
          await childRuntime.emitModelSelected({
            modelSelection: childSelection,
            effectiveReasoningLevel: childModel.options.reasoningLevel,
            previousModelSelection: previousSelection ?? null,
            traceContext: request.traceContext,
          });
        }
        request.registerMessageSink?.(createSubagentMessageSink(childRuntime, request));
        try {
          return await childRuntime.executeTurn(request.prompt, undefined, {
            ...(childBinding
              ? {
                  offPeakTaskId: offPeak!.offPeakTaskId,
                  modelExecution: {
                    selectionScope: "execution" as const,
                    memoryExtraction: "skip" as const,
                  },
                }
              : { offPeakTaskId: undefined }),
            abortSignal: options?.signal,
            inputSource: "subagent",
            inputPresentation: "coordinator_input",
            traceContext: request.traceContext,
          });
        } finally {
          const cancelled = options?.signal?.aborted === true;
          childRuntime.sealBackgroundTaskNotifications({
            reason: cancelled ? "subagent_cancelled" : "subagent_terminal",
            traceContext: request.traceContext,
          });
          if (cancelled) {
            await childRuntime.cancelRunningRuntimeBackgroundTasks({
              reason: "subagent_cancelled",
              traceContext: request.traceContext,
            });
          }
          await childBrowserControlPort
            ?.closeSession?.({ sessionId: request.sessionId, traceContext: request.traceContext })
            .catch((error: unknown) => {
              this.logger?.warn("Subagent browser session cleanup failed", {
                error: error instanceof Error ? error.message : String(error),
                event: "browser.session_cleanup.failed",
              });
            });
        }
      } finally {
        childBinding?.release();
      }
    },
  });
}

function resolveSubagentEmbeddedSearchEnabled(): boolean {
  const embeddedSearchDecision = resolveEmbeddedSearchBranchCapability({
    bashAvailable: true,
  });

  return embeddedSearchDecision.useEmbeddedSearchBranch;
}

export function createInheritedSubagentModelFactory(
  inheritedSelection: ModelSelection,
  inheritedModel: Model,
  fallbackFactory: AgentRuntimeDeps["modelFactory"],
): NonNullable<AgentRuntimeDeps["modelFactory"]> {
  return (target) => {
    if (
      target.selection.providerId === inheritedSelection.providerId &&
      target.selection.modelId === inheritedSelection.modelId &&
      target.selection.options?.reasoningLevel === inheritedSelection.options?.reasoningLevel
    ) {
      return inheritedModel;
    }
    return fallbackFactory(target);
  };
}

export function modelSelectionFromActiveModel(model: Model): ModelSelection {
  const reasoningLevel = model.options.reasoningLevel;
  return {
    providerId: model.providerId,
    modelId: model.modelId,
    ...(reasoningLevel ? { options: { reasoningLevel } } : {}),
  };
}

function createSubagentOverrideModelFactory(
  override: NonNullable<SubagentRunOptions["modelOverride"]>,
  fallbackFactory: AgentRuntimeDeps["modelFactory"],
): AgentRuntimeDeps["modelFactory"] {
  return (target) => {
    const model = fallbackFactory({
      ...target,
      selection: override.selection,
      requestDependencies: override.requestDependencies,
    });
    return getOffPeakModelBinding(override.requestDependencies)?.wrap(model) ?? model;
  };
}

function resolveSubagentPermissionMode(
  parentMode: AgentRuntimeInternal["config"]["mode"],
  permissionMode: ExploreSubagentRuntimeRequest["permissionMode"],
  builtInExplore: boolean,
): AgentRuntimeInternal["config"]["mode"] {
  switch (permissionMode) {
    case "bypassPermissions":
    case "dontAsk":
      return inheritPermissionMode(parentMode, "yolo");
    case "acceptEdits":
      return "edit";
    case "auto":
      return "auto";
    case "plan":
      return "plan";
    case "default":
    case undefined:
      return inheritPermissionMode(parentMode, builtInExplore ? "yolo" : parentMode);
    default:
      return parentMode;
  }
}

function resolveSubagentToolAllowlist(
  this: AgentRuntimeInternal,
  request: ExploreSubagentRuntimeRequest,
  visibleMcpToolNames: readonly string[],
): readonly string[] {
  const disallowedRules = buildSubagentChildDisallowRules([
    ...(this.config.toolDisallowlist ?? []),
    ...(request.disallowedTools ?? []),
  ]);
  const inheritsAvailableTools =
    request.allowedTools.length === 0 || request.allowedTools.includes("*");
  if (inheritsAvailableTools) {
    const parentAllowedMcpToolNames = filterMcpToolNamesByParentAllowlist(
      visibleMcpToolNames,
      this.config.toolAllowlist,
    );
    const availableToolNames = [
      ...this.getTools()
        .filter((tool) => tool.permission?.permission !== "mcp")
        .map((tool) => tool.name),
      ...parentAllowedMcpToolNames,
    ];
    return appendCoordinatorResponseTool(
      [...new Set(availableToolNames)]
        .filter((toolName) => !isSubagentDispatchToolName(toolName))
        .filter((toolName) => filterSubagentChildToolNames([toolName], disallowedRules).length > 0),
    );
  }
  if (request.allowedTools.length > 0) {
    return appendCoordinatorResponseTool(
      filterSubagentChildToolNames(request.allowedTools, disallowedRules),
    );
  }
  return appendCoordinatorResponseTool([]);
}

function filterMcpToolNamesByParentAllowlist(
  toolNames: readonly string[],
  parentAllowlist: readonly string[] | undefined,
): readonly string[] {
  if (parentAllowlist === undefined) return toolNames;
  const allowed = new Set(parentAllowlist);
  return toolNames.filter((toolName) => allowed.has(toolName));
}

function isModelVisibleMcpToolName(toolName: string): boolean {
  return toolName.startsWith("mcp__");
}

function appendCoordinatorResponseTool(toolNames: readonly string[]): readonly string[] {
  if (toolNames.includes(RESPOND_TO_COORDINATOR_TOOL_NAME)) {
    return toolNames;
  }

  return [...toolNames, RESPOND_TO_COORDINATOR_TOOL_NAME];
}

interface ResolvedSubagentMcpAccess {
  config: { enabled?: boolean } | undefined;
  port: McpPort | undefined;
  parentSnapshot: McpConnectionSnapshot | undefined;
  snapshot: McpConnectionSnapshot | undefined;
}

async function resolveSubagentMcpAccess(
  this: AgentRuntimeInternal,
  request: ExploreSubagentRuntimeRequest,
  officialCuaServerNames: ReadonlySet<string>,
): Promise<ResolvedSubagentMcpAccess> {
  if (!shouldBorrowParentMcp(request)) {
    return { config: undefined, parentSnapshot: undefined, port: undefined, snapshot: undefined };
  }

  const scopedServerNames = request.profile.mcpServers?.length
    ? request.profile.mcpServers
    : undefined;
  if (!this.mcpPort || this.config.mcp?.enabled === false) {
    if (scopedServerNames) {
      throw createSubagentMcpUnavailableError(request);
    }
    return {
      config: this.config.mcp?.enabled === false ? { enabled: false } : undefined,
      parentSnapshot: undefined,
      port: undefined,
      snapshot: undefined,
    };
  }

  const parentStartupSnapshot = await this.mcpStartupPromise;
  if (!parentStartupSnapshot) {
    if (scopedServerNames) {
      throw createSubagentMcpUnavailableError(request);
    }
    return { config: undefined, parentSnapshot: undefined, port: undefined, snapshot: undefined };
  }

  const unavailableScopedServerNames = (scopedServerNames ?? []).filter(
    (serverName) => parentStartupSnapshot.statuses[serverName]?.status !== "connected",
  );
  if (unavailableScopedServerNames.length > 0) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      `Required MCP server is not connected: ${unavailableScopedServerNames.join(", ")}`,
      {
        context: {
          agentType: request.agentType,
          missingMcpServers: unavailableScopedServerNames,
        },
        recoverable: true,
      },
    );
  }

  const borrowed = createBorrowedSubagentMcpAccess(
    this.mcpPort,
    parentStartupSnapshot,
    scopedServerNames,
    officialCuaServerNames,
  );
  return {
    config: { enabled: true },
    parentSnapshot: parentStartupSnapshot,
    port: borrowed.port,
    snapshot: borrowed.snapshot,
  };
}

function shouldBorrowParentMcp(request: ExploreSubagentRuntimeRequest): boolean {
  if ((request.profile.mcpServers?.length ?? 0) > 0) return true;
  if (request.allowedTools.length === 0 || request.allowedTools.includes("*")) return true;
  return request.allowedTools.some((toolName) => {
    const normalized = toolName.trim();
    return isConcreteMcpToolName(normalized) || isMcpServerSelector(normalized);
  });
}

function validateSubagentMcpRequirements(
  request: ExploreSubagentRuntimeRequest,
  effectiveAllowedTools: readonly string[],
  access: ResolvedSubagentMcpAccess,
): void {
  const inheritsAvailableTools =
    request.allowedTools.length === 0 || request.allowedTools.includes("*");
  if (inheritsAvailableTools) return;

  const normalizedAllowedTools = effectiveAllowedTools.map((toolName) => toolName.trim());
  const requiredToolNames = normalizedAllowedTools.filter(isConcreteMcpToolName);
  const requiredServerNames = extractRequiredMcpServerNames(
    normalizedAllowedTools.filter(isMcpServerSelector),
  );
  if (requiredToolNames.length === 0 && requiredServerNames.length === 0) return;
  if (!access.port || !access.snapshot) {
    throw createSubagentMcpUnavailableError(request, requiredToolNames);
  }
  const snapshot = access.snapshot;

  const unavailableServerNames = requiredServerNames.filter(
    (serverName) => !matchesRequiredMcpServer(serverName, snapshot.statuses),
  );
  if (unavailableServerNames.length > 0) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      `Required MCP server is not connected: ${unavailableServerNames.join(", ")}`,
      {
        context: {
          agentType: request.agentType,
          missingMcpServers: unavailableServerNames,
        },
        recoverable: true,
      },
    );
  }

  const visibleToolNames = new Set(snapshot.tools.map((descriptor) => toMcpToolName(descriptor)));
  const missingToolNames = requiredToolNames.filter((toolName) => !visibleToolNames.has(toolName));
  if (missingToolNames.length === 0) return;

  throw createCoreError(
    CoreErrorType.ConfigurationError,
    `Required MCP tool is not available in the parent startup snapshot: ${missingToolNames.join(", ")}`,
    {
      context: {
        agentType: request.agentType,
        missingMcpTools: missingToolNames,
      },
      recoverable: true,
    },
  );
}

function isConcreteMcpToolName(toolName: string): boolean {
  return isModelVisibleMcpToolName(toolName) && !isMcpServerSelector(toolName);
}

function isMcpServerSelector(toolName: string): boolean {
  return toolName === "mcp" || (toolName.startsWith("mcp__") && toolName.endsWith("__*"));
}

function createSubagentMcpUnavailableError(
  request: ExploreSubagentRuntimeRequest,
  requiredToolNames: readonly string[] = [],
) {
  return createCoreError(
    CoreErrorType.ConfigurationError,
    "Subagent MCP is unavailable because the parent startup snapshot is unavailable",
    {
      context: {
        agentType: request.agentType,
        requiredMcpTools: requiredToolNames,
      },
      recoverable: true,
    },
  );
}

function resolveSubagentSkillPort(
  parentSkillPort: SkillPort | undefined,
  skillNames: readonly string[] | undefined,
  cuaPolicy: OfficialCuaPolicy,
): SkillPort | undefined {
  if (!parentSkillPort) {
    return parentSkillPort;
  }
  return new FilteredSkillPort(
    parentSkillPort,
    skillNames && skillNames.length > 0 ? new Set(skillNames) : undefined,
    cuaPolicy,
  );
}

class FilteredSkillPort implements SkillPort {
  constructor(
    private readonly parent: SkillPort,
    private readonly allowedSkills: ReadonlySet<string> | undefined,
    private readonly cuaPolicy: OfficialCuaPolicy,
  ) {}

  async discoverSkills(
    request: Parameters<SkillPort["discoverSkills"]>[0],
    options?: SkillOperationOptions,
  ): Promise<SkillLoadOutcome> {
    const outcome = await this.parent.discoverSkills(request, options);
    const skills = outcome.skills.filter((skill) => this.isAllowedSkill(skill));
    return {
      ...outcome,
      skills,
      totalDiscovered: skills.length,
    };
  }

  async loadSkill(
    request: Parameters<SkillPort["loadSkill"]>[0],
    options?: SkillOperationOptions,
  ): Promise<SkillContent> {
    if (
      this.cuaPolicy.isOfficialSkillRequest(request.name) ||
      (await this.hasUniqueOfficialSkillMatch(request, options))
    ) {
      throw createSubagentComputerUseUnavailableError(request.name);
    }
    const resolvedName = await this.resolveAllowedSkillRequestName(request, options);
    if (!resolvedName) {
      throw createCoreError(
        CoreErrorType.ToolExecutionFailed,
        "Skill is not allowed for subagent",
        {
          context: {
            allowedSkills: this.allowedSkills ? [...this.allowedSkills] : [],
            skill: request.name,
            toolName: "Skill",
          },
          recoverable: true,
        },
      );
    }
    return this.parent.loadSkill({ ...request, name: resolvedName }, options);
  }

  private async hasUniqueOfficialSkillMatch(
    request: Parameters<SkillPort["loadSkill"]>[0],
    options?: SkillOperationOptions,
  ): Promise<boolean> {
    if (request.name.includes(":")) return false;
    const outcome = await this.parent.discoverSkills(
      {
        workingDirectory: request.workingDirectory,
        roots: request.roots,
        trace: request.trace,
      },
      options,
    );
    return isUniqueOfficialSkillRequest(outcome.skills, request.name, this.cuaPolicy);
  }

  private isAllowedSkill(skill: SkillContent["metadata"]): boolean {
    if (this.cuaPolicy.isOfficialSkill(skill)) return false;
    return (
      this.allowedSkills === undefined ||
      this.allowedSkills.has(skill.name) ||
      (skill.qualifiedName !== undefined && this.allowedSkills.has(skill.qualifiedName))
    );
  }

  private async resolveAllowedSkillRequestName(
    request: Parameters<SkillPort["loadSkill"]>[0],
    options?: SkillOperationOptions,
  ): Promise<string | undefined> {
    const outcome = await this.discoverSkills(
      {
        workingDirectory: request.workingDirectory,
        roots: request.roots,
        trace: request.trace,
      },
      options,
    );
    const matches = outcome.skills.filter((skill) => matchesSkillRequestName(skill, request.name));
    if (matches.length === 0) {
      return undefined;
    }
    if (matches.length > 1) {
      throw createCoreError(
        CoreErrorType.ToolExecutionFailed,
        "Skill name is ambiguous for subagent; use the fully qualified skill name",
        {
          context: {
            allowedSkills: this.allowedSkills ? [...this.allowedSkills] : [],
            matchingSkills: matches.map((skill) => skill.qualifiedName ?? skill.name),
            skill: request.name,
            toolName: "Skill",
          },
          recoverable: true,
        },
      );
    }
    return matches[0]?.qualifiedName ?? matches[0]?.name;
  }
}

async function validateSubagentComputerUseConfiguration(
  request: ExploreSubagentRuntimeRequest,
  cuaPolicy: OfficialCuaPolicy,
  parentSkillPort: SkillPort | undefined,
): Promise<void> {
  const explicitServer = request.profile.mcpServers?.find((serverName) =>
    cuaPolicy.serverNames.has(serverName.trim()),
  );
  const explicitTool = request.allowedTools.find(
    (toolName) =>
      cuaPolicy.isOfficialToolRequest(toolName) || cuaPolicy.isOfficialServerSelector(toolName),
  );
  let explicitSkill = request.profile.skills?.find((skillName) =>
    cuaPolicy.isOfficialSkillRequest(skillName),
  );
  if (!explicitSkill && parentSkillPort && request.profile.skills?.length) {
    try {
      const outcome = await parentSkillPort.discoverSkills({
        workingDirectory: request.workingDirectory,
        trace: request.traceContext,
      });
      explicitSkill = request.profile.skills.find((skillName) =>
        isUniqueOfficialSkillRequest(outcome.skills, skillName, cuaPolicy),
      );
    } catch {
      // Skill discovery remains lazy; a later Skill load will surface its own error.
    }
  }
  if (!explicitServer && !explicitTool && !explicitSkill) return;

  throw createCoreError(
    CoreErrorType.ConfigurationError,
    SUBAGENT_COMPUTER_USE_UNAVAILABLE_MESSAGE,
    {
      context: {
        agentType: request.agentType,
        code: SUBAGENT_COMPUTER_USE_UNAVAILABLE_CODE,
        ...(explicitServer ? { mcpServer: explicitServer } : {}),
        ...(explicitTool ? { mcpTool: explicitTool } : {}),
        ...(explicitSkill ? { skill: explicitSkill } : {}),
      },
      recoverable: true,
    },
  );
}

export function isUniqueOfficialSkillRequest(
  skills: readonly SkillContent["metadata"][],
  requestName: string,
  cuaPolicy: Pick<OfficialCuaPolicy, "isOfficialSkill">,
): boolean {
  if (requestName.includes(":")) return false;
  const matches = skills.filter((skill) => matchesSkillRequestName(skill, requestName));
  return matches.length === 1 && matches[0] !== undefined && cuaPolicy.isOfficialSkill(matches[0]);
}

function createSubagentComputerUseUnavailableError(skillName: string) {
  return createCoreError(
    CoreErrorType.ToolExecutionFailed,
    SUBAGENT_COMPUTER_USE_UNAVAILABLE_MESSAGE,
    {
      context: {
        code: SUBAGENT_COMPUTER_USE_UNAVAILABLE_CODE,
        skill: skillName,
        toolName: "Skill",
      },
      recoverable: true,
    },
  );
}

function matchesSkillRequestName(skill: SkillContent["metadata"], requestName: string): boolean {
  return skill.name === requestName || skill.qualifiedName === requestName;
}

function traceStringAttribute(
  traceContext: { attributes?: Record<string, string | number | boolean> },
  key: string,
): string | undefined {
  const value = traceContext.attributes?.[key];
  return typeof value === "string" ? value : undefined;
}
