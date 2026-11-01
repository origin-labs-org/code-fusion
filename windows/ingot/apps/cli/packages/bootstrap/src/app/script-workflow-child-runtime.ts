import { join } from "node:path";
import { tmpdir } from "node:os";
import { createNodeContextSourceAdapter } from "@origin-ai/cf-adapters/context";
import { createNodeExecutionAdapter } from "@origin-ai/cf-adapters/exec";
import { createNodeFileSystemAdapter } from "@origin-ai/cf-adapters/fs";
import { createNodeWebFetchHttpClientAdapter } from "@origin-ai/cf-adapters/http";
import { createNodeSkillAdapter } from "@origin-ai/cf-adapters/skills";
import type { ConfigResult } from "@origin-ai/cf-adapters/config";
import {
  AgentRuntime,
  type AgentRuntimeConfig,
  type AgentRuntimeDeps,
  type ChildClientPortsContext,
  type PermissionService,
} from "@origin-ai/cf-core";
import {
  type AgentExecutionTelemetryPort,
  type BrowserControlPort,
  type ContextSourcePort,
  type FileSystemPort,
  type HttpClientPort,
  type ImageProcessorPort,
  type JsonSchema,
  type PdfDocumentPort,
  type Logger,
  type McpPort,
  type ModelRequestAdmission,
  type SessionId,
  type SessionStorePort,
  type SkillPort,
  type SkillRoot,
  type ToolArtifactStorePort,
  type TraceContext,
  type WorkflowAgentCallInput,
  type WorkflowEscalatePort,
  type WorkflowSubmitPort,
} from "@origin-ai/cf-contracts";
import { collectDisabledPaths } from "../skill-command-overrides.js";
import { parseProviderQualifiedModelSelection } from "./provider-registry-selection.js";
import type { CfAppOptions } from "./types.js";

export interface ScriptWorkflowAgentRuntimeDeps {
  agentTelemetry: AgentExecutionTelemetryPort;
  appOptions: CfAppOptions;
  appVersion: string;
  artifactStore?: ToolArtifactStorePort;
  configResult: ConfigResult;
  contextSourcePort?: ContextSourcePort;
  fileSystemPort: FileSystemPort;
  httpClientPort?: HttpClientPort;
  imageProcessorPort: ImageProcessorPort;
  pdfDocumentPort?: PdfDocumentPort;
  logger: Logger;
  mcpPort?: McpPort;
  
  modelFactory: NonNullable<AgentRuntimeDeps["modelFactory"]>;
  permissionService: PermissionService;
  
  pluginSkillRoots: readonly SkillRoot[];
  runtime: AgentRuntime;
  runtimeConfig: AgentRuntimeConfig;
  sessionId: SessionId;
  sessionStore: SessionStorePort;
  storageRoot: string;
  workingDirectory: string;
}

export function createScriptWorkflowAgentRuntime(input: {
  childSessionId: SessionId;
  deps: ScriptWorkflowAgentRuntimeDeps;
  request: WorkflowAgentCallInput;
  traceContext: TraceContext;
  
  configOverrides?: Partial<AgentRuntimeConfig>;
  
  workflowSubmitPort?: WorkflowSubmitPort;
  
  workflowSubmitSchema?: JsonSchema;
  
  workflowEscalatePort?: WorkflowEscalatePort;
  
  modelRequestAdmission?: ModelRequestAdmission;
  
  interactionDescription?: string;
  
  browserControlPort?: BrowserControlPort;
}): AgentRuntime {
  const { systemPrompt: inheritedSystemPrompt, ...inheritedConfig } = input.deps.runtimeConfig;
  const systemPrompt =
    input.configOverrides?.workflowActor === undefined
      ? (input.request.opts?.systemPrompt ?? inheritedSystemPrompt)
      : undefined;
  const parentSelection = input.deps.runtime.getSessionModelSelection();
  const requestedSelection = input.request.opts?.model
    ? parseProviderQualifiedModelSelection(input.request.opts.model)
    : undefined;
  if (input.request.opts?.model && !requestedSelection) {
    throw new Error(`Workflow child model must be provider-qualified: ${input.request.opts.model}`);
  }
  const modelSelection = requestedSelection ?? parentSelection;
  return new AgentRuntime(
    input.childSessionId,
    {
      ...inheritedConfig,
      ...(systemPrompt === undefined ? {} : { systemPrompt }),
      agentName: input.request.opts?.agentType ?? "cf-workflow",
      maxTurns: input.request.opts?.maxTurns ?? input.deps.runtimeConfig.maxTurns,
      // 「Permissions inside a run」）。
      mode: "yolo",
      modelSelection,
      bashShellSelection: input.deps.runtime.getSessionShellSelection(),
      parentSessionId: input.deps.sessionId,
      subagents: { enabled: false },
      taskType: "workflow_child",
      dynamicWorkflowToolsOnDemand: false,
      toolAllowlist: input.request.opts?.tools,
      workingDirectory: input.deps.workingDirectory,
      ...input.configOverrides,
    },
    {
      ...createRuntimeDeps(input.deps, input.traceContext, input.childSessionId, {
        agentId: input.childSessionId,
        agentType: input.request.opts?.agentType ?? "cf-workflow",
        childSessionId: input.childSessionId,
        description:
          input.interactionDescription ??
          input.request.opts?.label ??
          input.request.opts?.agentType ??
          "workflow agent",
        ...(input.traceContext.turnId === undefined
          ? {}
          : { parentTurnId: input.traceContext.turnId }),
      }),
      ...(input.browserControlPort === undefined
        ? {}
        : {
            browserControlPort:
              input.browserControlPort.forChildSession?.({
                childSessionId: input.childSessionId,
                parentSessionId: input.deps.sessionId,
              }) ?? input.browserControlPort,
          }),
      ...(input.workflowSubmitPort ? { workflowSubmitPort: input.workflowSubmitPort } : {}),
      ...(input.workflowSubmitPort && input.workflowSubmitSchema
        ? { workflowSubmitSchema: input.workflowSubmitSchema }
        : {}),
      ...(input.workflowEscalatePort ? { workflowEscalatePort: input.workflowEscalatePort } : {}),
      ...(input.modelRequestAdmission
        ? { modelRequestAdmission: input.modelRequestAdmission }
        : {}),
    },
  );
}

function createRuntimeDeps(
  deps: ScriptWorkflowAgentRuntimeDeps,
  traceContext: TraceContext,
  childSessionId: SessionId,
  clientPortsContext: ChildClientPortsContext,
): ConstructorParameters<typeof AgentRuntime>[2] {
  return {
    agentTelemetry: deps.agentTelemetry,
    agentTelemetryCausation: deps.agentTelemetry.captureCausation(),
    agentTelemetryCausationMode: "linked_root",
    appVersion: deps.appVersion,
    artifactStore: deps.artifactStore,
    contextSourcePort:
      deps.contextSourcePort ??
      deps.appOptions.contextSourcePort ??
      createNodeContextSourceAdapter({ env: deps.appOptions.env }),
    //
    eventSink: {
      onSessionEvent: async (event) => {
        await deps.runtime.notifyExternalChildSessionEvent({
          childSessionId,
          event,
          traceContext,
          interactionOrigin: clientPortsContext,
        });
      },
    },
    eventStore: deps.runtime.getSessionEventStore(),
    executionPort:
      deps.appOptions.executionPort ??
      createNodeExecutionAdapter({
        onToolExecResource: deps.appOptions.onToolExecResource,
        network: {
          httpProxy: deps.configResult.config.network.httpProxy,
          noProxy: deps.configResult.config.network.noProxy,
          caCertFile: deps.configResult.config.network.caCertFile,
        },
        outputRootDir: join(deps.storageRoot, "cli", "exec"),
        bashOutputTempDir: tmpdir(),
        processEnv: deps.appOptions.env ?? process.env,
      }),
    fileSystemPort: deps.appOptions.fileSystemPort ?? createNodeFileSystemAdapter(),
    httpClientPort:
      deps.httpClientPort ??
      deps.appOptions.httpClientPort ??
      createNodeWebFetchHttpClientAdapter({
        env: deps.appOptions.env ?? process.env,
        proxyUrl: deps.configResult.config.network.httpProxy,
        noProxy: deps.configResult.config.network.noProxy,
        caCertFile: deps.configResult.config.network.caCertFile,
        timeoutMs: deps.configResult.config.network.timeout,
      }),
    imageProcessorPort: deps.imageProcessorPort,
    pdfDocumentPort: deps.pdfDocumentPort,
    logger: deps.logger,
    mcpPort: deps.mcpPort,
    modelFactory: deps.modelFactory,
    resolveEffectiveModelSelection: deps.appOptions.resolveEffectiveModelSelection,
    ...deps.runtime.createChildClientPorts(clientPortsContext),
    permissionService: deps.permissionService,
    sessionStore: deps.sessionStore,
    skillPort: createWorkflowChildSkillPort(deps),
    traceContext,
  };
}

export function createWorkflowChildSkillPort(
  deps: Pick<ScriptWorkflowAgentRuntimeDeps, "appOptions" | "configResult" | "pluginSkillRoots">,
): SkillPort | undefined {
  if (!deps.configResult.config.features.skill || !deps.configResult.config.skills.enabled) {
    return undefined;
  }
  return (
    deps.appOptions.skillPort ??
    createNodeSkillAdapter({
      extraRoots: deps.configResult.config.skills.roots,
      extraResolvedRoots: [...deps.pluginSkillRoots],
      disabledPaths: collectDisabledPaths(deps.configResult.config.skillOverrides),
    })
  );
}
