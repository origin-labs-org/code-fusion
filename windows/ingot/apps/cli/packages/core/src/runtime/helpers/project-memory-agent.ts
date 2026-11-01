import type { Model, ModelToolContract, TraceContext } from "../deps.js";
import type { AgentTelemetryCausation, ModelApiOperation } from "@origin-ai/cf-contracts";
import {
  PermissionService,
  createDenyPermissionBroker,
  createToolExecutor,
  defaultPermissionConfig,
  traceContextToLogContext,
} from "../deps.js";
import type { RuntimeMessageEntry } from "../../agent/message-history.js";
import type { ReadFileStateMap } from "../../tool/types.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { getSessionShellSelectionFromConfig } from "../methods/session-shell-environment.js";
import { prepareRuntimeProviderRequest } from "./runtime-provider-request-messages.js";
import { createRefreshRuntimeHeadersBeforeModelAttempt } from "../methods/model-runtime-headers.js";
import { createRuntimeModel, withModelInvocationContext } from "../methods/runtime-model.js";

export interface ProjectMemoryAgentContext {
  causation?: AgentTelemetryCausation;
  memoryRoot: string;
  providerEntries: readonly RuntimeMessageEntry[];
  midConversationSystem: AgentRuntimeInternal["config"]["midConversationSystem"];
  model: Model;
  operation: ModelApiOperation;
  readFileState: ReadFileStateMap;
  tools: readonly ModelToolContract[];
  traceContext: TraceContext;
  workingDirectory: string;
  workspaceRoot: string;
}

export function captureProjectMemoryAgentContext(
  runtime: AgentRuntimeInternal,
  input: {
    memoryRoot: string;
    
    model?: Model;
    operation: ModelApiOperation;
    traceContext: TraceContext;
  },
): ProjectMemoryAgentContext {
  const baseModel =
    input.model ??
    createRuntimeModel(runtime, {
      selection: runtime.getSessionModelSelection(),
    });
  const model = withModelInvocationContext(baseModel, (request) => ({
    metadata: {
      ...traceContextToLogContext(input.traceContext),
      querySource: input.operation,
      skipTranscript: true,
    },
    modelCall: { operation: input.operation },
    refreshRuntimeHeadersBeforeAttempt: createRefreshRuntimeHeadersBeforeModelAttempt(runtime, {
      abortSignal: request.abortSignal,
      model,
      traceContext: input.traceContext,
    }),
    traceContext: input.traceContext,
  }));
  return {
    causation: runtime.agentTelemetry.captureCausation(),
    memoryRoot: input.memoryRoot,
    providerEntries: [...runtime.messageHistory.borrowReadOnlyRuntimeEntries()],
    midConversationSystem: runtime.config.midConversationSystem,
    model,
    operation: input.operation,
    readFileState: new Map(runtime.readFileState),
    tools: runtime
      .getTools(model)
      .filter((tool) => tool.name !== "ToolSearch")
      .map((tool) => ({ ...tool })),
    traceContext: input.traceContext,
    workingDirectory: runtime.workingDirectory,
    workspaceRoot: runtime.workspaceRoot,
  };
}

export function prepareProjectMemoryAgentRequest(
  context: ProjectMemoryAgentContext,
  prompt: string,
) {
  return prepareRuntimeProviderRequest(
    {
      config: { midConversationSystem: context.midConversationSystem },
    },
    {
      applyCacheControl: true,
      entries: context.providerEntries,
      model: context.model,
      prompt,
      tools: context.tools,
    },
  ).request;
}

export function createProjectMemoryAgentToolExecutor(
  runtime: AgentRuntimeInternal,
  context: ProjectMemoryAgentContext,
) {
  return createToolExecutor({
    artifactStore: runtime.artifactStore,
    emitEvent: async () => {},
    executionPort: runtime.executionPort,
    fileSystemPort: runtime.fileSystemPort,
    getBashShellSelection: () => getSessionShellSelectionFromConfig(runtime.config),
    getMode: () => "yolo",
    getMemoryRoot: () => context.memoryRoot,
    getWorkingDirectory: () => context.workingDirectory,
    getWorkspaceRoot: () => context.workspaceRoot,
    imageProcessorPort: runtime.imageProcessorPort,
    pdfDocumentPort: runtime.pdfDocumentPort,
    maxConcurrency: runtime.config.toolConcurrency?.maxConcurrency,
    model: context.model,
    permissionBroker: createDenyPermissionBroker(),
    permissionService: new PermissionService(defaultPermissionConfig),
    readFileState: new Map(context.readFileState),
    registry: runtime.registry,
    runtimeScope: "main",
    sessionId: runtime.sessionId,
    sessionStore: runtime.sessionStore,
    skillPort: runtime.skillPort,
    traceContext: context.traceContext,
  });
}
