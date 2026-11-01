import { subagentProfilesFromSnapshot } from "../runtime-subagents/index.js";
import { CliDefaultSelection } from "./cli-default-selection.js";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createInMemorySessionEventStore,
  createNodeToolArtifactStore,
} from "@origin-ai/cf-adapters/storage";
import { createNodeLoggerFactory } from "@origin-ai/cf-adapters/logging";
import { createConfig, resolvePath } from "@origin-ai/cf-adapters/config";
import {
  createNodeExecutionAdapter,
  resolveEffectiveBashShellSelection,
} from "@origin-ai/cf-adapters/exec";
import { createNodeFileSystemAdapter } from "@origin-ai/cf-adapters/fs";
import { createNodeWebFetchHttpClientAdapter } from "@origin-ai/cf-adapters/http";
import { createJimpImageProcessorAdapter } from "@origin-ai/cf-adapters/image";
import { createPopplerPdfDocumentAdapter } from "@origin-ai/cf-adapters/pdf";
import { createNodeSessionMailboxAdapter } from "@origin-ai/cf-adapters/mailbox";
import { createNodeContextSourceAdapter } from "@origin-ai/cf-adapters/context";
import { createNodeSkillAdapter } from "@origin-ai/cf-adapters/skills";
import { createMcpAdapter } from "@origin-ai/cf-adapters/mcp";
import {
  AgentRuntime,
  normalizeAgentProfiles,
  PermissionService,
  buildPluginReferenceCatalog,
  writeWorkflowDraft,
  type AmendWorkflowRunSettingsInput,
  type ResumeSessionResult,
} from "@origin-ai/cf-core";
import { createModelTelemetry } from "@origin-ai/cf-telemetry";
import {
  createRootTraceContext,
  traceContextToLogContext,
  type TraceContext,
  createSessionId,
  createSessionEvent,
  type ExecutionShellSelection,
  type MessageId,
} from "@origin-ai/cf-contracts";
import { isRemoteWorkspaceIdentity, resolveCfRuntimeEnv } from "@origin-ai/cf-shared";
import {
  CF_ATTACHMENT_FAULT_CODES,
  CfAttachmentFaultError,
} from "@origin-ai/cf-shared/cf-protocol-v4";

import { createModelAdapter } from "../model-factory.js";
import { StartupTimer, startupNow } from "../startup-logging.js";
import { scheduleStartupLogRetentionCleanup } from "../log-retention.js";
import type {
  PrepareUserExecutionBoundary,
  ResumeOptions,
  CfApp,
  CfAppOptions,
} from "./types.js";
import {
  createConfigCliOverrides,
  isMessageEnabled,
  resolveEffectiveLocale,
  resolveEffectiveConfigResult,
} from "./app-config-options.js";
import { getCliStorageRoot, getModelIoDir, projectIdFromDirectory } from "./paths.js";
import {
  asInputHistoryStore,
  asLocalSettingStore,
  openStartupSessionStore,
  readProjectPermissionMode,
  readSessionModelSelection,
} from "./session-store.js";
import { createWorkflowFacade } from "./workflow-facade.js";
import { createInputFacade } from "./input-facade.js";
import { createPluginFacadeForApp } from "./plugin-facade.js";
import { resolvePluginRuntimeFeatures } from "./plugin-runtime-features.js";
import { createSessionFacade } from "./session-facade.js";
import { resolveAppRuntimeConfig, runtimeConfigLogContext } from "./runtime-config.js";
import { resolveBundledSkillRoots } from "./bundled-skills.js";
import { collectDynamicWorkflowDisabledSkillPaths } from "./dynamic-workflow-gate.js";
import { createWorkspaceHookRuntimeSecurity } from "./workspace-hook-trust.js";
import { createScriptWorkflowBridge } from "./script-workflow-methods.js";
import {
  createDynamicWorkflowRunService,
  isDynamicWorkflowTaskLinkStore,
  resolveDynamicWorkflowJournalStore,
} from "./dynamic-workflow-run-service.js";
import { getWorkflowConcurrencyGovernor } from "./workflow-concurrency-governor.js";
import { createDynamicWorkflowSnippetService } from "./dynamic-workflow-snippet-service.js";
import { createModelCatalogPort } from "./model-catalog-port.js";
import { createDynamicWorkflowRunProgressSink } from "./dynamic-workflow-run-progress-sink.js";
import { createScriptWorkflowAgentRuntime } from "./script-workflow-child-runtime.js";
import { workflowActorModelPolicy } from "./workflow-actor-model.js";
import {
  workflowActorInteractionDescription,
  workflowActorPermissionPolicy,
} from "./workflow-actor-permission.js";
import { workflowActorToolPolicy } from "./workflow-actor-tools.js";
import {
  createNodeReplBrowserBroker,
  injectNodeReplBrowserBroker,
  type NodeReplBrowserBroker,
} from "./node-repl-browser-broker.js";
import { resolveBuiltInNodeReplMcpServers } from "./built-in-node-repl.js";
import { resolveCfCustomCommandPrompt } from "../custom-command-prompt.js";
import { resolveCfBuiltinPromptCommandInvocation } from "../builtin-prompt-command.js";
import { BUILTIN_WORKFLOW_COMMAND_NAME } from "../builtin-workflow-command.js";
import { collectDisabledPaths } from "../skill-command-overrides.js";
import {
  loadPluginAgentTemplates,
  resolvePluginAgentProfiles,
  loadCfAgentProfiles,
} from "../subagents.js";
import { createRuntimeAiSdkModelExecutionConfig } from "../model-config.js";
import { ApiProviderModelRuntime } from "./provider-registry-model-runtime.js";
import {
  completeAppStartup,
  debugRuntimeConfigResolved,
  markConfigurationLoaded,
  markMcpAdapterInitialized,
  markRuntimeConstructed,
  markStorageAdaptersInitialized,
  resolveStartupPlugins,
  startAppStartup,
} from "./startup-marks.js";

function decodePromptAttachmentDataUrl(
  content: string,
  fallbackMime: string,
  maxBytes: number,
): { bytes: Uint8Array; mediaType: string } {
  const commaIndex = content.indexOf(",");
  const headerParts =
    content.slice(0, "data:".length).toLowerCase() === "data:" && commaIndex >= 0
      ? content.slice("data:".length, commaIndex).split(";")
      : [];
  const mediaType = (headerParts.shift()?.trim() || fallbackMime).split(";", 1)[0]!.toLowerCase();
  const payload = commaIndex >= 0 ? content.slice(commaIndex + 1) : "";
  if (
    headerParts.at(-1)?.trim().toLowerCase() !== "base64" ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(payload) ||
    payload.length % 4 !== 0
  ) {
    throw new Error("fault.attachment.previewArtifactInvalid");
  }
  if (
    !mediaType.startsWith("image/") &&
    !mediaType.startsWith("video/") &&
    mediaType !== "application/pdf" &&
    !(
      mediaType === "text/plain" &&
      fallbackMime.split(";", 1)[0]?.trim().toLowerCase() === "text/plain"
    )
  ) {
    throw new Error("fault.attachment.previewNotMedia");
  }
  const bytes = Buffer.from(payload, "base64");
  if (bytes.byteLength > maxBytes) {
    throw new Error("fault.attachment.previewTooLarge");
  }
  return { bytes, mediaType };
}

export async function createCfApp(options: CfAppOptions): Promise<CfApp> {
  if (!options?.providerRegistry) {
    throw new Error("createCfApp requires a Provider Registry");
  }
  const startupStartedAt = startupNow();
  const appVersion = options.version ?? "0.0.0";
  const sessionId = options.sessionId ?? createSessionId();
  const traceContext = options.traceContext ?? createRootTraceContext({ sessionId });
  const workingDirectory = resolve(options.runtimeConfig?.workingDirectory ?? process.cwd());
  const configResult = resolveEffectiveConfigResult(
    createConfig({
      env: options.env,
      projectConfigPath: options.projectConfigPath,
      workingDirectory,
      workspaceIdentity: options.runtimeConfig?.memory?.workspaceIdentity,
      skipUserConfig: options.skipUserConfig,
      userConfigPath: options.userConfigPath,
      cliOverrides: createConfigCliOverrides(options),
    }),
    options,
  );
  const loggerFactory = options.loggerFactory ?? createNodeLoggerFactory({ env: options.env });
  const logger = loggerFactory.createLogger("cf").child({
    ...traceContextToLogContext(traceContext),
    module: "bootstrap",
  });
  const startupTimer = new StartupTimer(
    logger,
    {
      ...traceContextToLogContext(traceContext),
      module: "bootstrap",
      startupKind: "cf_app",
    },
    startupStartedAt,
  );
  startAppStartup({
    hasInjectedModelAdapter: options.modelAdapter !== undefined,
    resume: options.resume === true,
    startupTimer,
  });
  markConfigurationLoaded({
    configResult,
    startupTimer,
  });
  const modelLogger = loggerFactory.createLogger("cf").child({
    ...traceContextToLogContext(traceContext),
    module: "adapters.model",
  });
  const modelTelemetry = createModelTelemetry({
    owner: options.telemetryOwner,
    sessionId,
  });
  let nodeReplBrowserBroker: NodeReplBrowserBroker | undefined;
  let ownedNodeReplBrowserBroker: NodeReplBrowserBroker | undefined;
  let providerModelRuntime: ApiProviderModelRuntime | undefined;
  try {
    const storageRoot = resolvePath(configResult.config.storage.dir);
    const cliStorageRoot = getCliStorageRoot(storageRoot);
    const modelIoDir = getModelIoDir(
      cliStorageRoot,
      resolveCfRuntimeEnv(options.env ?? process.env) === "development",
    );
    const hostSubagentSnapshot = await options.readSubagentRuntimeConfig?.({
      signal: new AbortController().signal,
      traceContext,
    });
    const cfSubagentProfileOutcome = hostSubagentSnapshot
      ? subagentProfilesFromSnapshot(hostSubagentSnapshot)
      : await loadCfAgentProfiles({
          logger,
          storageRoot,
          workingDirectory,
          additionalDirectories: options.additionalDirectories,
        });
    const cfSubagentProfiles = cfSubagentProfileOutcome.profiles;
    const pluginOutcome = resolveStartupPlugins({
      cliStorageRoot,
      configResult,
      env: options.env,
      logger,
      options,
      startupTimer,
      workingDirectory,
    });
    const bundledSkillRoots = resolveBundledSkillRoots({ cliStorageRoot, logger });
    const pluginTemplates = loadPluginAgentTemplates({ logger, plugins: pluginOutcome.plugins });
    const pluginSubagentProfiles =
      hostSubagentSnapshot?.kind === "built-in-fallback"
        ? []
        : resolvePluginAgentProfiles(
            {
              logger,
              plugins: pluginOutcome.plugins,
              reservedProfileNames: cfSubagentProfiles.map((profile) => profile.name),
              modelSelectionOverrides:
                cfSubagentProfileOutcome.pluginAgentModelSelectionOverrides,
            },
            pluginTemplates,
          ).profiles;
    const pluginRuntimeFeatures = resolvePluginRuntimeFeatures(pluginOutcome);
    const builtInMcpServers = resolveBuiltInNodeReplMcpServers({
      pluginOutcome,
      workingDirectory,
    });
    const subagentProfiles = [...cfSubagentProfiles, ...pluginSubagentProfiles];
    const ownsSessionStore = options.sessionStore === undefined;
    const sessionStore =
      options.sessionStore ?? (await openStartupSessionStore(configResult, startupTimer));
    const localSettingStore = asLocalSettingStore(sessionStore);
    const projectID = projectIdFromDirectory(workingDirectory);
    const persistedMode = options.runtimeConfig?.mode
      ? undefined
      : readProjectPermissionMode(localSettingStore, projectID);
    let { configuredMcpServers, runtimeConfig, untrustedProjectMcpServers } =
      resolveAppRuntimeConfig({
        cliStorageRoot,
        configResult,
        options,
        persistedMode,
        pluginHooks: pluginOutcome.hooks,
        pluginMcpServers: pluginOutcome.mcpServers,
        builtInMcpServers,
        pluginRuntimeFeatures,
        builtInSubagentModelSelectionOverrides:
          cfSubagentProfileOutcome.builtInModelSelectionOverrides,
        subagentOutputRootDir: join(cliStorageRoot, "agents"),
        subagentProfiles,
        storageRoot,
        workingDirectory,
        workspaceIdentity: options.runtimeConfig?.memory?.workspaceIdentity,
      });
    const browserControlPort = options.browserControlPort;
    if (
      browserControlPort &&
      pluginRuntimeFeatures.browserUse === true &&
      runtimeConfig.mcp?.servers?.node_repl?.type === "stdio"
    ) {
      nodeReplBrowserBroker =
        options.nodeReplBrowserBroker ??
        (ownedNodeReplBrowserBroker = createNodeReplBrowserBroker({
          browserControlPort,
          logger,
          platform: options.platform,
        }));
      configuredMcpServers = injectNodeReplBrowserBroker(
        configuredMcpServers,
        nodeReplBrowserBroker,
      );
      runtimeConfig.mcp = {
        ...runtimeConfig.mcp,
        servers: injectNodeReplBrowserBroker(
          runtimeConfig.mcp.servers ?? {},
          nodeReplBrowserBroker,
        ),
      };
    }
    startupTimer.mark("CodeFusion runtime configuration resolved", {
      context: runtimeConfigLogContext(runtimeConfig, workingDirectory),
      event: "bootstrap.app.startup.runtime_config.completed",
      stage: "resolve_runtime_config",
    });
    const pluginReferenceCatalog = buildPluginReferenceCatalog(pluginOutcome.plugins);
    runtimeConfig.pluginReferenceCatalog = pluginReferenceCatalog;
    let runtime: AgentRuntime | undefined;
    const cliDefaultSelection =
      options.modelSelectionMode === "cli-default"
        ? new CliDefaultSelection(runtimeConfig.modelSelection)
        : undefined;
    const workspaceHookRuntimeSecurity = createWorkspaceHookRuntimeSecurity({
      appVersion,
      logger,
      projectConfigPath: options.projectConfigPath,
      policy: options.workspaceHookPolicy,
      policyProvider: options.workspaceHookPolicyProvider,
      reviewHost: options.workspaceHookReviewHost,
      workspaceHookTrustEnabled: options.workspaceHookTrustEnabled,
      runtimeRoot: configResult.sources.project.workspaceHookRuntimeRoot ?? {
        enabled: runtimeConfig.hooks?.enabled === true,
        timeoutMs: runtimeConfig.hooks?.timeoutMs ?? 60_000,
        maxOutputBytes: runtimeConfig.hooks?.maxOutputBytes ?? 32_768,
      },
      sessionId,
      snapshot: configResult.sources.project.workspaceHookSnapshot,
      userConfigPath: configResult.sources.user.path,
      workingDirectory,
      ...(options.workspaceHookReviewHost
        ? {
            emitReviewEvent: async (event) => {
              if (!runtime) throw new Error("CodeFusion runtime is not initialized yet.");
              await runtime.appendEvent(
                createSessionEvent(event.type, sessionId, event.payload, {
                  traceId: traceContext.traceId,
                }),
                traceContext,
              );
            },
            emitAdmissionEvent: async (event) => {
              if (!runtime) throw new Error("CodeFusion runtime is not initialized yet.");
              await runtime.appendEvent(
                createSessionEvent(event.type, sessionId, event.payload, {
                  traceId: traceContext.traceId,
                }),
                traceContext,
              );
            },
          }
        : {}),
    });
    const permissionService = new PermissionService({
      allowedTools: new Set(configResult.config.permission.allowedTools),
      autoApproveHighRisk: configResult.config.permission.autoApproveHighRisk,
      disallowedTools: new Set(configResult.config.permission.disallowedTools),
      allowMediumRiskInAutoMode: configResult.config.permission.allowMediumRiskInAuto,
    });
    const inputHistoryStore = options.inputHistoryStore ?? asInputHistoryStore(sessionStore);
    const artifactStore =
      options.artifactStore ??
      createNodeToolArtifactStore({
        imageCacheRootDir: join(storageRoot, "cli", "image-cache"),
        pdfCacheRootDir: join(storageRoot, "cli", "pdf-cache"),
        rootDir: join(storageRoot, "cli", "artifacts"),
        videoCacheRootDir: join(storageRoot, "cli", "video-cache"),
      });
    const imageProcessorPort = options.imageProcessorPort ?? createJimpImageProcessorAdapter();
    const messageEnabled = isMessageEnabled(options.env ?? process.env);
    const sessionMailboxPort =
      options.sessionMailboxPort ??
      (messageEnabled
        ? createNodeSessionMailboxAdapter({
            rootDir: resolvePath(
              (options.env ?? process.env).CF_MAILBOX_ROOT ?? "~/.cf/mailbox",
            ),
          })
        : undefined);
    markStorageAdaptersInitialized({
      cliStorageRoot,
      hasInjectedArtifactStore: options.artifactStore !== undefined,
      hasInjectedSessionStore: options.sessionStore !== undefined,
      startupTimer,
      storageRoot,
    });
    const mcpPort =
      options.mcpPort ??
      (runtimeConfig.mcp?.enabled === false
        ? undefined
        : (options.mcpPortFactory?.({ workingDirectory }) ??
          createMcpAdapter({
            clientVersion: appVersion,
            env: options.env,
            logger,
            network: {
              httpProxy: configResult.config.network.httpProxy,
              noProxy: configResult.config.network.noProxy,
              caCertFile: configResult.config.network.caCertFile,
            },
            workingDirectory,
          })));
    const ownsMcpPort = options.mcpPort === undefined && mcpPort !== undefined;
    const executionPort =
      options.executionPort ??
      createNodeExecutionAdapter({
        onToolExecResource: options.onToolExecResource,
        network: {
          httpProxy: configResult.config.network.httpProxy,
          noProxy: configResult.config.network.noProxy,
          caCertFile: configResult.config.network.caCertFile,
        },
        outputRootDir: join(storageRoot, "cli", "exec"),
        bashOutputTempDir: tmpdir(),
        processEnv: options.env ?? process.env,
      });
    const ownsExecutionPort = options.executionPort === undefined;
    const pdfDocumentPort =
      options.pdfDocumentPort ?? createPopplerPdfDocumentAdapter({ executionPort });
    const fileSystemPort = options.fileSystemPort ?? createNodeFileSystemAdapter();
    const httpClientPort =
      options.httpClientPort ??
      createNodeWebFetchHttpClientAdapter({
        env: options.env ?? process.env,
        timeoutMs: configResult.config.network.timeout,
        proxyUrl: configResult.config.network.httpProxy,
        noProxy: configResult.config.network.noProxy,
        caCertFile: configResult.config.network.caCertFile,
      });
    const providerEndpointRoutingPort = options.providerEndpointRoutingPort;
    markMcpAdapterInitialized({
      configuredMcpServers,
      hasInjectedMcpPort: options.mcpPort !== undefined,
      mcpEnabled: runtimeConfig.mcp?.enabled !== false,
      startupTimer,
      trustedMcpServerCount: Object.keys(runtimeConfig.mcp?.servers ?? {}).length,
    });
    debugRuntimeConfigResolved({
      configResult,
      logger,
      runtimeConfig,
    });
    const getRuntime = (): AgentRuntime => {
      if (!runtime) throw new Error("CodeFusion runtime is not initialized yet.");
      return runtime;
    };
    let resumePrepared = false;
    const resolveDefaultShellSelection = (): ExecutionShellSelection =>
      resolveEffectiveBashShellSelection({
        env: options.env ?? process.env,
        platform: options.platform ?? process.platform,
      }).selection;
    let initialShellSelectionPromise: Promise<ExecutionShellSelection> | undefined;
    const resolveInitialShellSelection = (): Promise<ExecutionShellSelection> => {
      initialShellSelectionPromise ??= (async () =>
        (await options.resolveInitialBashShellSelection?.()) ?? resolveDefaultShellSelection())();
      return initialShellSelectionPromise;
    };
    const initializeSessionShellEnvironment = async (): Promise<void> => {
      getRuntime().initializeSessionShellEnvironmentIfNeeded(await resolveInitialShellSelection());
    };

    const restorePersistedModelSelection = async (): Promise<
      ResumeSessionResult["modelSelection"]
    > => {
      const registry = options.providerRegistry;
      let selection: ResumeSessionResult["modelSelection"];
      try {
        selection = await readSessionModelSelection(sessionStore, sessionId);
      } catch (error) {
        logger.warn("Session model selection restore failed", {
          error: error instanceof Error ? error.message : String(error),
          event: "session.model_selection.restore_failed",
          sessionId,
        });
      }
      const validation = selection && registry.validateSelection(selection);
      if (selection && validation && !validation.ok) {
        logger.warn("Session model selection restored but not bound to the runtime", {
          event: "session.model_selection.restore_unbound",
          modelId: selection.modelId,
          providerId: selection.providerId,
          sessionId,
          validationCode: validation.code,
        });
      }
      getRuntime().setSessionModelSelection(validation?.ok ? selection : undefined);
      cliDefaultSelection?.set(validation?.ok ? selection : undefined);
      return selection;
    };

    const resumeFromStore = async (resumeOptions?: ResumeOptions): Promise<ResumeSessionResult> => {
      const runtime = getRuntime();
      const unsubscribe = resumeOptions?.onEvent
        ? runtime.subscribeEvents({ onSessionEvent: resumeOptions.onEvent })
        : undefined;

      try {
        const resumeTraceContext = resumeOptions?.traceContext ?? traceContext;
        const modelSelection = await restorePersistedModelSelection();
        await initializeSessionShellEnvironment();
        const result = await runtime.resumeFromStore({
          ...(resumeOptions?.abortSignal ? { abortSignal: resumeOptions.abortSignal } : {}),
          modeOverride: options.runtimeConfig?.mode,
          persistedMessages: resumeOptions?.persistedMessages,
          traceContext: resumeTraceContext,
        });
        await runtime.activatePausedTargetAfterResume(resumeTraceContext);
        resumePrepared = true;
        return { ...result, modelSelection };
      } finally {
        unsubscribe?.();
      }
    };

    const prepareResume = async (
      submitTraceContext?: TraceContext,
      abortSignal?: AbortSignal,
    ): Promise<void> => {
      if (!options.resume || resumePrepared) return;
      await resumeFromStore({
        ...(abortSignal ? { abortSignal } : {}),
        traceContext: submitTraceContext ?? traceContext,
      });
      resumePrepared = true;
    };

    const prepareUserExecutionBoundary: PrepareUserExecutionBoundary = async (boundaryOptions) => {
      await initializeSessionShellEnvironment();
      await prepareResume(boundaryOptions?.traceContext, boundaryOptions?.abortSignal);
    };

    const modelExecutionConfig = createRuntimeAiSdkModelExecutionConfig(options.env, {
      appVersion,
      endpointRoutingPort: providerEndpointRoutingPort,
      network: configResult.config.network,
      sourceTitle: options.sourceTitle,
    });
    const modelAdapter =
      options.modelAdapter ??
      createModelAdapter({
        env: options.env,
        logger: modelLogger,
        modelIoDir,
        modelIoFullRetentionEnabled: options.modelIoFullRetentionEnabled,
        executionConfig: modelExecutionConfig,
        statusSink: modelTelemetry.statusSink,
        streamIdleTimeoutMs: configResult.config.modelStream.idleTimeoutMs,
      });
    if (options.modelAdapter && modelTelemetry.statusSink) {
      modelAdapter.addStatusSink(modelTelemetry.statusSink);
    }
    const workflowConcurrencyGovernor = getWorkflowConcurrencyGovernor();
    modelAdapter.setModelIoFullRetentionEnabled(options.modelIoFullRetentionEnabled ?? false);
    providerModelRuntime = new ApiProviderModelRuntime({
      registry: options.providerRegistry,
      modelAdapter,
    });
    providerModelRuntime.start();
    const modelFactory = providerModelRuntime.modelFactory;
    const scriptWorkflowFacade = createScriptWorkflowBridge({
      agentTelemetry: modelTelemetry.agentExecution,
      appOptions: options,
      appVersion,
      artifactStore,
      configResult,
      fileSystemPort,
      httpClientPort,
      imageProcessorPort,
      pdfDocumentPort,
      logger,
      mcpPort,
      modelFactory,
      permissionService,
      pluginSkillRoots: pluginOutcome.skillRoots,
      prepareUserExecutionBoundary,
      getRuntime,
      runtimeConfig,
      sessionId,
      sessionStore,
      storageRoot,
      traceContext,
      workingDirectory,
    });

    const dynamicWorkflowJournal = resolveDynamicWorkflowJournalStore(sessionStore, logger);
    const dynamicWorkflowRunPort =
      dynamicWorkflowJournal === undefined
        ? undefined
        : createDynamicWorkflowRunService({
            concurrency: workflowConcurrencyGovernor,
            createActorRuntime: ({
              actor,
              persona,
              pinnedModel,
              runSubagentModel,
              actorModel,
              subagentPermissionMode,
              sessionId: actorSessionId,
              submitPort,
              submitProfile,
              escalatePort,
              modelRequestAdmission,
            }) =>
              createScriptWorkflowAgentRuntime({
                childSessionId: actorSessionId,
                configOverrides: {
                  workflowActor: {
                    ...(persona.name === undefined ? {} : { name: persona.name }),
                    ...(persona.system === undefined ? {} : { persona: persona.system }),
                  },
                  ...workflowActorToolPolicy(),
                  // （docs/dynamic-workflow/launch.md「Permissions inside a run」）。
                  ...workflowActorPermissionPolicy(subagentPermissionMode),
                  ...workflowActorModelPolicy(
                    {
                      parentSelection: getRuntime().getSessionModelSelection(),
                      ...(runSubagentModel === undefined ? {} : { runSelection: runSubagentModel }),
                      ...(actorModel === undefined ? {} : { actorSelection: actorModel }),
                    },
                    pinnedModel,
                  ).configOverrides,
                },
                deps: {
                  agentTelemetry: modelTelemetry.agentExecution,
                  appOptions: options,
                  appVersion,
                  artifactStore,
                  configResult,
                  fileSystemPort,
                  httpClientPort,
                  imageProcessorPort,
                  logger,
                  mcpPort,
                  modelFactory,
                  permissionService,
                  pluginSkillRoots: pluginOutcome.skillRoots,
                  runtime: getRuntime(),
                  runtimeConfig,
                  sessionId,
                  sessionStore,
                  storageRoot,
                  workingDirectory,
                },
                request: { opts: {} } as never,
                interactionDescription: workflowActorInteractionDescription({ actor, persona }),
                ...(browserControlPort === undefined ? {} : { browserControlPort }),
                traceContext,
                ...(submitProfile.kind === "untyped" ? {} : { workflowSubmitPort: submitPort }),
                ...(submitProfile.kind === "mono"
                  ? { workflowSubmitSchema: { ...submitProfile.schema } }
                  : {}),
                workflowEscalatePort: escalatePort,
                ...(modelRequestAdmission === undefined ? {} : { modelRequestAdmission }),
              }),
            actorTranscriptStore: sessionStore,
            artifactStore,
            executionPort,
            fileSystemPort,
            journal: dynamicWorkflowJournal,
            logger,
            //
            onRunEvent: createDynamicWorkflowRunProgressSink({
              getRuntime,
              logger,
              sessionId,
            }),
            parentSessionId: sessionId,
            writeWorkflowDraft,
            permissionMode: () => getRuntime().getMode(),
            registerResidencyBlockingWork: (work) => {
              void getRuntime().trackResidencyBlockingWork(work);
            },
            resolveLaunchInputId: (trace) => {
              const active = getRuntime().getActiveTurnInfo();
              return active !== undefined && active.turnId === trace.turnId
                ? active.inputId
                : undefined;
            },
            ...(isDynamicWorkflowTaskLinkStore(sessionStore)
              ? { taskLinkStore: sessionStore }
              : {}),
          });
    const dynamicWorkflowSnippetPort = createDynamicWorkflowSnippetService({
      executionPort,
      fileSystemPort,
      logger,
    });
    const modelCatalogPort = createModelCatalogPort({
      registry: options.providerRegistry,
      currentSelection: () => getRuntime().getSessionModelSelection(),
    });
    runtime = new AgentRuntime(sessionId, runtimeConfig, {
      ...(options.readSubagentRuntimeConfig
        ? {
            loadAgentDefinitions: async (input) => {
              const snapshot = await options.readSubagentRuntimeConfig!(input);
              const parsed = subagentProfilesFromSnapshot(snapshot);
              const pluginProfiles =
                snapshot.kind === "built-in-fallback"
                  ? []
                  : resolvePluginAgentProfiles(
                      {
                        logger,
                        plugins: pluginOutcome.plugins,
                        reservedProfileNames: parsed.profiles.map((profile) => profile.name),
                        modelSelectionOverrides: parsed.pluginAgentModelSelectionOverrides,
                      },
                      pluginTemplates,
                    ).profiles;
              return {
                activeAgents: normalizeAgentProfiles(
                  [
                    ...(options.runtimeConfig?.subagents?.profiles ?? []),
                    ...parsed.profiles,
                    ...pluginProfiles,
                  ],
                  {
                    builtInModelSelectionOverrides: {
                      ...parsed.builtInModelSelectionOverrides,
                      ...options.runtimeConfig?.subagents?.builtInModelSelectionOverrides,
                    },
                  },
                ),
              };
            },
          }
        : {}),
      agentTelemetry: modelTelemetry.agentExecution,
      modelRequestAdmission: workflowConcurrencyGovernor.observer(),
      eventStore: options.eventStore ?? createInMemorySessionEventStore(),
      sessionStore,
      sessionMailboxPort,
      logger,
      executionPort,
      workspaceHookAdmission: workspaceHookRuntimeSecurity?.admission,
      workspaceHookSnapshot: workspaceHookRuntimeSecurity?.snapshot,
      browserControlPort,
      fileSystemPort,
      httpClientPort,
      imageProcessorPort,
      pdfDocumentPort,
      artifactStore,
      contextSourcePort:
        options.contextSourcePort ?? createNodeContextSourceAdapter({ env: options.env }),
      skillPort:
        configResult.config.features.skill && configResult.config.skills.enabled
          ? (options.skillPort ??
            createNodeSkillAdapter({
              additionalDirectories: options.additionalDirectories,
              extraRoots: configResult.config.skills.roots,
              extraResolvedRoots: [...pluginOutcome.skillRoots, ...bundledSkillRoots],
              disabledPaths: [
                ...collectDisabledPaths(configResult.config.skillOverrides),
                ...(runtimeConfig.dynamicWorkflowEnabled === false
                  ? collectDynamicWorkflowDisabledSkillPaths(bundledSkillRoots)
                  : []),
              ],
            }))
          : undefined,
      mcpPort,
      eventSink: options.eventSink,
      onOffPeakLifecycleEvent: options.onOffPeakLifecycleEvent
        ? (event) => options.onOffPeakLifecycleEvent!({ ...event, sessionId })
        : undefined,
      modelFactory,
      modelIoDir,
      providerRuntimeHeadersPort: options.providerRuntimeHeadersPort,
      resolveEffectiveModelSelection: options.resolveEffectiveModelSelection,
      isRemoteWorkspace: () =>
        isRemoteWorkspaceIdentity(runtimeConfig.memory?.workspaceIdentity ?? ""),
      permissionBroker: options.permissionBroker,
      permissionService,
      workflowPort: scriptWorkflowFacade.workflowPort,
      dynamicWorkflowRunPort,
      dynamicWorkflowSnippetPort,
      modelCatalogPort,
      automationPort: options.automationPort,
      offPeakPort: options.offPeakPort,
      topicResourcePort: options.topicResourcePort,
      appVersion,
      traceContext,
    });
    markRuntimeConstructed({
      hasInjectedModelAdapter: options.modelAdapter !== undefined,
      sessionId,
      startupTimer,
    });
    completeAppStartup({
      sessionId,
      startupTimer,
      workingDirectory,
    });
    scheduleStartupLogRetentionCleanup(loggerFactory, logger);
    const inputFacade = createInputFacade({
      cliDefaultSelection,
      artifactStore,
      customCommandPromptResolver: async (text, resolverOptions) => {
        const builtin = resolveCfBuiltinPromptCommandInvocation(text, {
          dynamicWorkflowEnabled: runtimeConfig.dynamicWorkflowEnabled,
          workingDirectory,
        });
        if (builtin !== undefined) {
          if (builtin.name === BUILTIN_WORKFLOW_COMMAND_NAME) {
            await runtime?.activateDynamicWorkflowTools({
              source: "command",
              traceContext: resolverOptions?.traceContext ?? traceContext,
            });
          }
          return builtin.prompt;
        }
        return await resolveCfCustomCommandPrompt(text, {
          additionalDirectories: options.additionalDirectories,
          env: options.env,
          executionPort,
          logger,
          projectConfigPath: options.projectConfigPath,
          sessionId,
          signal: resolverOptions?.abortSignal,
          skipUserConfig: options.skipUserConfig,
          traceContext: resolverOptions?.traceContext ?? traceContext,
          userConfigPath: options.userConfigPath,
          workingDirectory,
        });
      },
      inputHistoryStore,
      logger,
      prepareUserExecutionBoundary,
      runtime,
      sessionId,
      traceContext,
    });
    const workflowFacade = createWorkflowFacade({
      agentTelemetry: modelTelemetry.agentExecution,
      appOptions: options,
      appVersion,
      artifactStore,
      cliStorageRoot,
      configResult,
      eventSink: options.eventSink,
      imageProcessorPort,
      pdfDocumentPort,
      logger,
      mcpPort,
      modelFactory,
      permissionService,
      prepareUserExecutionBoundary,
      runtime,
      runtimeConfig,
      sessionId,
      sessionStore,
      storageRoot,
      traceContext,
      workingDirectory,
    });
    const sessionFacade = createSessionFacade({
      cliDefaultSelection,
      ...(dynamicWorkflowRunPort === undefined
        ? {}
        : { closeDynamicWorkflowRuns: () => dynamicWorkflowRunPort.close() }),
      configResult,
      configuredMcpServers,
      ...(options.configuredDefaultModelSelection
        ? {
            configuredDefaultModelSelection: options.configuredDefaultModelSelection,
          }
        : {}),
      executionPort,
      localSettingStore,
      logger,
      loggerFactory,
      mcpPort,
      ownsExecutionPort,
      ownsMcpPort,
      closeNodeReplBrowserBroker: async () => {
        await ownedNodeReplBrowserBroker?.close();
      },
      ownsSessionStore,
      prepareUserExecutionBoundary,
      prepareResume,
      projectID,
      providerRegistry: options.providerRegistry,
      resolveUiLocale: (locale) => resolveEffectiveLocale(locale, options),
      runtime,
      sessionId,
      sessionStore,
      traceContext,
      untrustedProjectMcpServers,
      workingDirectory,
    });

    const closeSession = sessionFacade.close;
    const resolvePromptAttachment = async (input: {
      ref: string;
      mime: string;
      messageId?: string;
      attachmentIndex?: number;
    }): Promise<{ ref: string; mediaType: string; artifactUri?: string }> => {
      let ref = input.ref;
      let mediaType = input.mime;
      let artifactUri: string | undefined;
      if (input.messageId && input.attachmentIndex !== undefined) {
        const persistedMessage = await sessionStore.messageWithParts({
          sessionID: sessionId,
          messageID: input.messageId as MessageId,
        });
        const persistedAttachment = persistedMessage?.parts.filter((part) => part.type === "file")[
          input.attachmentIndex
        ];
        if (persistedAttachment?.type === "file") {
          mediaType = persistedAttachment.mime;
          artifactUri =
            persistedAttachment.metadata?.artifactUri ??
            (persistedAttachment.url.startsWith("cf-artifact://")
              ? persistedAttachment.url
              : undefined);
          ref =
            artifactUri ??
            (!persistedAttachment.url.startsWith("data:") ? persistedAttachment.url : input.ref);
        }
      }
      return { ref, mediaType, ...(artifactUri ? { artifactUri } : {}) };
    };
    return {
      sessionId,
      traceId: traceContext.traceId,
      runtime,
      respondWorkspaceHookReview: (input) =>
        workspaceHookRuntimeSecurity?.respond(
          {
            sessionId: input.sessionId,
            taskId: input.taskId,
            runId: input.runId,
            ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
            workspaceIdentity: input.workspaceIdentity,
            bundleDigest: input.bundleDigest,
            reviewFlowId: input.reviewFlowId,
            generation: input.generation,
            interactionId: input.interactionId,
          },
          input.decision,
        ) ??
        Promise.resolve({
          accepted: false as const,
          reasonCode: "workspace_hooks_require_trust_capable_host" as const,
        }),
      toggleWorkspaceHookReviewItem: (input) =>
        workspaceHookRuntimeSecurity?.toggle(
          {
            sessionId: input.sessionId,
            taskId: input.taskId,
            runId: input.runId,
            ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
            workspaceIdentity: input.workspaceIdentity,
            bundleDigest: input.bundleDigest,
            reviewFlowId: input.reviewFlowId,
            generation: input.generation,
            interactionId: input.interactionId,
          },
          input.reviewItemId,
          input.enabled,
        ) ??
        Promise.resolve({
          accepted: false as const,
          reasonCode: "workspace_hooks_require_trust_capable_host" as const,
        }),
      revokeWorkspaceHookTrust: (input) =>
        ("hookDeclarationDigests" in input
          ? workspaceHookRuntimeSecurity?.revokeCurrent(input)
          : workspaceHookRuntimeSecurity?.revoke(
              {
                sessionId: input.sessionId,
                taskId: input.taskId,
                runId: input.runId,
                ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
                workspaceIdentity: input.workspaceIdentity,
                bundleDigest: input.bundleDigest,
                reviewFlowId: input.reviewFlowId,
                generation: input.generation,
                interactionId: input.interactionId,
              },
              input.reviewItemIds,
            )) ??
        Promise.resolve({
          accepted: false as const,
          reasonCode: "workspace_hooks_require_trust_capable_host" as const,
        }),
      requestWorkspaceHookReview: (input) =>
        workspaceHookRuntimeSecurity?.requestReview({
          workspaceIdentity: input.workspaceIdentity,
          bundleDigest: input.bundleDigest,
        }) ??
        Promise.resolve({
          accepted: false as const,
          reasonCode: "workspace_hooks_require_trust_capable_host" as const,
        }),
      reloadWorkspaceHookTrust: () =>
        workspaceHookRuntimeSecurity?.reloadTrust() ?? Promise.resolve(),
      setModelIoFullRetentionEnabled: (enabled) =>
        modelAdapter.setModelIoFullRetentionEnabled(enabled),
      readToolResultArtifact: (uri) =>
        artifactStore.readToolResultArtifact({ uri, trace: traceContext }),
      writePromptAttachment: async (input) => {
        const artifact = await artifactStore.writeToolResultArtifact({
          content: `data:${input.mime};base64,${Buffer.from(input.bytes).toString("base64")}`,
          contentType: "text/plain",
          retention: "session",
          sessionId,
          toolCallId: `prompt-attachment-upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
          toolName: "prompt-attachment:upload",
          trace: traceContext,
        });
        if (
          input.mime.startsWith("image/") ||
          input.mime.startsWith("video/") ||
          input.mime.split(";", 1)[0]?.trim().toLowerCase() === "application/pdf"
        ) {
          void artifactStore
            .primeMediaAttachmentPath?.({
              bytes: input.bytes,
              mediaType: input.mime,
              uri: artifact.uri,
            })
            .catch(() => undefined);
        }
        return { ref: artifact.uri };
      },
      readPromptAttachment: async (input) => {
        const { ref, mediaType } = await resolvePromptAttachment(input);
        if (ref.startsWith("cf-artifact://")) {
          const artifact = await artifactStore.readToolResultArtifact({
            uri: ref,
            trace: traceContext,
          });
          return decodePromptAttachmentDataUrl(artifact.content, mediaType, input.maxBytes);
        }
        const read = await fileSystemPort.readBinaryFile({
          path: ref,
          maxBytes: input.maxBytes,
          trace: traceContext,
        });
        return { bytes: read.content, mediaType };
      },
      statPromptAttachment: async (input) => {
        const { ref, mediaType, artifactUri } = await resolvePromptAttachment(input);
        if (artifactUri) {
          if (!artifactStore.statToolResultArtifact) {
            throw new CfAttachmentFaultError(CF_ATTACHMENT_FAULT_CODES.statUnsupported);
          }
          const result = await artifactStore.statToolResultArtifact({
            uri: artifactUri,
            trace: traceContext,
          });
          return {
            totalBytes: result.bytes,
            mediaType: result.contentType || mediaType,
            ...(result.mtimeMs === undefined ? {} : { mtimeMs: result.mtimeMs }),
          };
        }
        const result = await fileSystemPort.stat({ path: ref, trace: traceContext });
        if (result.kind !== "file") {
          throw new CfAttachmentFaultError(CF_ATTACHMENT_FAULT_CODES.statNotFile);
        }
        return {
          totalBytes: result.sizeBytes,
          mediaType,
          ...(result.mtimeMs === undefined ? {} : { mtimeMs: result.mtimeMs }),
        };
      },
      resolvePromptAttachmentPreviewSource: async (input) => {
        const resolved = await resolvePromptAttachment(input);
        if (!resolved.mediaType.startsWith("video/")) return { kind: "chunked" };
        if (resolved.artifactUri) {
          if (!artifactStore.ensureMediaAttachmentPath) return { kind: "chunked" };
          try {
            const materialized = await artifactStore.ensureMediaAttachmentPath({
              uri: resolved.artifactUri,
              mediaType: resolved.mediaType,
            });
            if (materialized.status === "ready" && materialized.path.trim()) {
              return {
                kind: "local_path",
                path: materialized.path,
                mediaType: resolved.mediaType,
              };
            }
          } catch {
          }
          return { kind: "chunked" };
        }
        if (isAbsolute(resolved.ref)) {
          return {
            kind: "local_path",
            path: resolved.ref,
            mediaType: resolved.mediaType,
          };
        }
        return { kind: "chunked" };
      },
      ...sessionFacade,
      close: async () => {
        try {
          await closeSession?.();
        } finally {
          try {
            providerModelRuntime?.dispose();
          } finally {
            await modelTelemetry.shutdown();
          }
        }
      },
      ...workflowFacade,
      ...scriptWorkflowFacade,
      ...(dynamicWorkflowRunPort === undefined
        ? {}
        : {
            listDynamicWorkflowRunEvents: async (input: {
              runId: string;
              afterSequence?: number;
              limit?: number;
              maxBytes?: number;
            }) =>
              dynamicWorkflowRunPort.listEvents(input.runId, {
                ...(input.afterSequence === undefined
                  ? {}
                  : { afterSequence: input.afterSequence }),
                ...(input.limit === undefined ? {} : { limit: input.limit }),
                ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
              }),
          }),
      ...(dynamicWorkflowRunPort === undefined ||
      typeof dynamicWorkflowRunPort.listArtifacts !== "function" ||
      typeof dynamicWorkflowRunPort.listArtifactItems !== "function" ||
      typeof dynamicWorkflowRunPort.readArtifact !== "function"
        ? {}
        : {
            listDynamicWorkflowRunArtifacts: async (input: { runId: string }) =>
              dynamicWorkflowRunPort.listArtifacts!(input.runId),
            listDynamicWorkflowRunArtifactItems: async (input: {
              runId: string;
              artifactId: string;
              afterSequence?: number;
              limit: number;
              maxBytes: number;
              fields?: readonly string[];
            }) =>
              dynamicWorkflowRunPort.listArtifactItems!(input.runId, input.artifactId, {
                ...(input.afterSequence === undefined
                  ? {}
                  : { afterSequence: input.afterSequence }),
                limit: input.limit,
                maxBytes: input.maxBytes,
                ...(input.fields === undefined ? {} : { fields: input.fields }),
              }),
            readDynamicWorkflowRunArtifact: async (input: {
              runId: string;
              artifactId: string;
              version: number;
            }) =>
              dynamicWorkflowRunPort.readArtifact!(input.runId, input.artifactId, input.version),
          }),
      ...(dynamicWorkflowRunPort === undefined ||
      typeof dynamicWorkflowRunPort.listWorkspaceNodes !== "function" ||
      typeof dynamicWorkflowRunPort.readWorkspaceNodeResult !== "function"
        ? {}
        : {
            listDynamicWorkflowRunWorkspaceNodes: async (input: { runId: string }) =>
              dynamicWorkflowRunPort.listWorkspaceNodes!(input.runId),
            readDynamicWorkflowRunNodeResult: async (input: {
              runId: string;
              siteId: string;
              ordinal: number;
              maxBytes: number;
            }) =>
              dynamicWorkflowRunPort.readWorkspaceNodeResult!(
                input.runId,
                input.siteId,
                input.ordinal,
                { maxBytes: input.maxBytes },
              ),
          }),
      ...(dynamicWorkflowRunPort === undefined ? {} : {}),
      ...(dynamicWorkflowRunPort === undefined ||
      typeof dynamicWorkflowRunPort.listRunsForSession !== "function"
        ? {}
        : {
            listDynamicWorkflowRuns: async (input: { limit?: number }) =>
              dynamicWorkflowRunPort.listRunsForSession!(input.limit),
          }),
      ...(dynamicWorkflowRunPort === undefined ||
      typeof dynamicWorkflowRunPort.replayProgressForSession !== "function"
        ? {}
        : {
            replayDynamicWorkflowRuns: async (input: { excludeRunIds: ReadonlySet<string> }) =>
              dynamicWorkflowRunPort.replayProgressForSession!(input),
          }),
      ...(dynamicWorkflowRunPort === undefined ||
      typeof dynamicWorkflowRunPort.resume !== "function"
        ? {}
        : {
            resumeWorkflowRun: async (input: { workId: string; name?: string }) => {
              const result = await dynamicWorkflowRunPort.resume!(input.workId);
              if (result.ok) {
                await getRuntime().trackResumedDynamicWorkflowRun({
                  runId: result.runId,
                  ...(result.toolCallId === undefined ? {} : { toolCallId: result.toolCallId }),
                  ...(input.name === undefined ? {} : { name: input.name }),
                  traceContext,
                });
              }
              return result;
            },
          }),
      ...(dynamicWorkflowRunPort === undefined
        ? {}
        : {
            startSavedWorkflow: async (input: {
              name: string;
              scope?: "project" | "global";
              args?: Record<string, unknown>;
            }) => {
              await prepareUserExecutionBoundary({ traceContext });
              return await getRuntime().startSavedWorkflowRun({ ...input, traceContext });
            },
          }),
      ...(dynamicWorkflowRunPort === undefined ||
      typeof dynamicWorkflowRunPort.amend !== "function" ||
      typeof dynamicWorkflowRunPort.getScript !== "function"
        ? {}
        : {
            amendWorkflowRunSettings: async (
              input: Omit<AmendWorkflowRunSettingsInput, "traceContext">,
            ) => {
              await prepareUserExecutionBoundary({ traceContext });
              return await getRuntime().amendWorkflowRunSettings({ ...input, traceContext });
            },
          }),
      ...createPluginFacadeForApp({ configResult, options, workingDirectory }),
      getPluginReferenceCatalog: () => pluginReferenceCatalog,
      getSkillCatalog: async () => {
        await prepareUserExecutionBoundary({ traceContext });
        return await getRuntime().getSkillCatalog(traceContext);
      },
      resume: resumeFromStore,
      ...inputFacade,
    };
  } catch (error) {
    providerModelRuntime?.dispose();
    void modelTelemetry.shutdown().catch(() => undefined);
    void ownedNodeReplBrowserBroker?.close();
    startupTimer.fail("CodeFusion app startup failed", error, {
      context: { sessionId, workingDirectory },
      event: "bootstrap.app.startup.failed",
      stage: "total",
    });
    throw error;
  }
}
