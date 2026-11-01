import { createConversationShareMockRoute } from "./test/e2e/helpers/conversation-share-mock-route.js";
import {
  loadToolSearchResponses,
  toolSearchResponseStage,
  type ToolSearchRequest,
} from "./test/e2e/helpers/toolsearch-provider.js";
import {
  requestSecurityCaptureMocks,
  recordRequestSecurityCaptureMode,
  requestSecurityWorkerEnv,
  restoreRequestSecurityEndpointEnv,
  requestSecurityClientConfig,
  requestSecurityAgentConfig,
  requestSecuritySpecTimeout,
  startRequestSecurityFixture,
  stopRequestSecurityFixture,
} from "./test/e2e/helpers/request-security-edition/index.js";
import {
  presentationResponse,
  type EntitlementPresentation,
} from "./test/e2e/fixtures/entitlement-presentation.js";

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  captureWorkspaceSources,
  withE2ESourceEvidence,
} from "./test/e2e/reporting/e2e-source-evidence.js";
import { config as loadDotenv } from "dotenv";
import {
  PROVIDER_RESPONSIVE_TEAM_NAME,
  buildProviderResponsiveStartBalance,
} from "./test/e2e/fixtures/provider-family-responsive.js";
import {
  startUpstreamReplayServer,
  type UpstreamReplayServer,
} from "./test/e2e/helpers/upstream-replay-server.js";
import {
  hasUpstreamCaseLocalReplayFixtureForWorker,
  resolveUpstreamE2EHttpMode,
  resolveUpstreamE2EHttpModeForWorker,
  resolveUpstreamReplayFixturePaths as resolveUpstreamReplayFixturePathsFromContract,
  type UpstreamReplayFixtureMode,
} from "./test/e2e/helpers/upstream-replay-fixture-resolution.js";
import {
  buildE2ERunIdArg,
  buildWindowsTaskkillArgs,
  createWindowsE2EHomeMarkerArg,
  listE2EProcessTreePids,
} from "./test/e2e/helpers/e2e-process-cleanup.js";
import {
  collectE2EWebDriverPageHandleCandidates,
  type E2EBrowserTargetInfo,
} from "./test/e2e/helpers/e2e-window-target.js";
import { runE2EBeforeSessionSetup } from "./test/e2e/helpers/e2e-before-session.js";
import {
  PROJECT_UPGRADE_ORDER_SPEC,
  seedProjectUpgradeOrderFixture,
} from "./test/e2e/helpers/project-upgrade-order-fixture.js";
import { resolveAskUserQuestionClockScaleForWorker } from "./test/e2e/helpers/e2e-worker-environment.js";
import {
  CODING_PLAN_TEAM_MOCK_BASE_URL_ENV,
  CODING_PLAN_UPGRADE_MOCK_BASE_URL_ENV,
  applyCodingPlanTeamMockEnv,
  applyCodingPlanUpgradeMockEnv,
  clearCodingPlanTeamMockEnv,
  clearCodingPlanUpgradeMockEnv,
  shouldPrepareCodingPlanTeamMock,
  shouldReuseDesktopE2EBuild,
} from "./test/e2e/helpers/coding-plan-mock-env.js";
import {
  HIGHSPEED_MOCK_SCENARIO_ENV,
  resolveHighspeedE2EMockScenario,
} from "./test/e2e/helpers/highspeed-mock-env.js";
import { createE2ERendererBridgeRootHooks } from "./test/e2e/helpers/e2e-renderer-bridge-root-hook.js";
import { installHookTrustFixture } from "./test/e2e/helpers/hook-trust-fixture.js";
import { resolveUpstreamModels } from "./test/e2e/helpers/upstream-recorded-models.js";
import { runMeasuredE2ELifecyclePhase } from "./test/e2e/helpers/e2e-lifecycle-measurement.js";
import { createE2ERunnerFinalizationGuard } from "./test/e2e/helpers/e2e-runner-finalization-guard.js";
import { installHooksLifecycleFixture } from "./test/e2e/helpers/hooks-lifecycle-fixture.js";
import { installStopToolResultsFixture } from "./test/e2e/helpers/stop-tool-results-fixture.js";
import { installBashPrefixPermissionPnpmShim } from "./test/e2e/helpers/bash-prefix-permission-shim.js";
import {
  applyE2EWorkerModelRetryEnv,
  applyE2EWorkerReplayProxyEnv,
  replaceChromeUserDataDirArg,
  resolveE2EWorkerModelStreamIdleTimeoutMs,
  resolveE2EWebDriverRequestLimits,
  resolveE2EWorkerChromiumProfileDir,
  workerSpecsContain,
} from "./test/e2e/helpers/e2e-worker-isolation.js";
import { createE2EStartupCredentialSeed } from "./test/e2e/helpers/e2e-startup-credentials.js";
import { seedRemoteOnboardingFixture } from "./test/e2e/helpers/remote-startup-profile.js";
import { getE2EProviderEndpointEnv } from "#e2e/helpers/e2e-provider-endpoint";
import { prepareOAuthCompletionRaceFixture } from "./test/e2e/helpers/oauth-completion-race-fixture.js";
import { prepareWebRemoteControlAuthGateFixture } from "./test/e2e/helpers/web-remote-control-auth-gate-fixture.js";
import { prepareAccessToken401Fixture } from "./test/e2e/helpers/access-token-401-fixture.js";
import { createE2EReplayFixtureVariables } from "./test/e2e/helpers/e2e-runtime-paths.js";
import { stageE2EAppOutput } from "./test/e2e/helpers/e2e-app-output-stage.js";
import { withE2EDesktopBuildLock } from "./scripts/ensure-e2e-desktop-build.mjs";
import { ensureSshRemoteReleaseAssets } from "./test/e2e/helpers/e2e-ssh-remote-release-assets.js";
import {
  ASK_USER_QUESTION_E2E_CLOCK_SCALE_ENV,
  BIGMODEL_PROVIDER_ID,
  ZAI_PROVIDER_ID,
} from "@origin-ai/cf-shared";
import {
  seedPersonalProviderConfig,
  seedPersonalDefaultModelSelection,
  type PersonalProviderConfigSeed,
} from "./test/e2e/helpers/model-provider-restart-config.js";
import {
  DEFAULT_E2E_NETWORK_CAPTURE_NO_PROXY,
  startE2ENetworkCaptureProxy,
  type E2ENetworkCaptureProxy,
} from "./test/e2e/helpers/network-capture-proxy.js";
import {
  resetCodingPlanUpgradeMockServer,
  resolveCodingPlanUpgradeMockScenario,
  shouldPrepareCodingPlanUpgradeMockForBuild,
  startCodingPlanUpgradeMockServer,
  type CodingPlanUpgradeMockServer,
} from "./test/e2e/helpers/coding-plan-upgrade-mock-server.js";
import {
  MANUAL_REVIEW_SPEC_GLOB,
  hasRequiredSshE2EEnvironment,
  resolveEnvironmentGatedFormalSpecExcludes,
} from "./scripts/e2e-formal-spec-selection.mjs";
import {
  applyDynamicWorkflowConfigMockEnv,
  clearDynamicWorkflowConfigMockEnv,
  resolveDynamicWorkflowConfigMockScenario,
  startDynamicWorkflowConfigMockServer,
  type DynamicWorkflowConfigMockServer,
} from "./test/e2e/helpers/dynamic-workflow-config-mock-server.js";
import {
  resolveModelContextBudgetConfigMockScenario,
  startModelContextBudgetConfigMockServer,
  type ModelContextBudgetConfigMockServer,
} from "./test/e2e/helpers/model-context-budget-config-mock-server.js";
import {
  MODEL_PROVIDER_CATALOG_PAYLOAD,
  resolveSubagentLoginCatalogConfigVersion,
  resolveSubagentLoginCatalogPayload,
} from "./test/e2e/helpers/model-provider-catalog-mock-server.js";
import {
  applyClientScenesMockEnv,
  clearClientScenesMockEnv,
  shouldUseClientScenesMock,
  startClientScenesMockServer,
  type ClientScenesMockServer,
} from "./test/e2e/helpers/client-scenes-mock-server.js";
import {
  resolvePluginCdnZipMarketplaceLastUpdated,
  seedPluginCdnZipMarketplaceFixture,
  shouldUsePluginCdnZipMarketplaceFixture,
  startPluginCdnZipFixtureServer,
  stopPluginCdnZipFixtureServer,
  type PluginCdnZipFixtureServer,
} from "./test/e2e/helpers/plugin-cdn-zip-marketplace.js";
import { E2EFailureArtifactCollector } from "./test/e2e/reporting/e2e-failure-artifacts.js";
import { classifyError, createE2EReporter } from "./test/e2e/reporting/e2e-reporting.js";
import type { E2ELifecyclePhase } from "./test/e2e/reporting/e2e-reporting-types.js";
import {
  DEFAULT_E2E_ELECTRON_INSTALL_TIMEOUT_MS,
  resolveE2EElectronBinary,
} from "./test/e2e/helpers/e2e-electron-binary.js";
import {
  CONTEXT_WINDOW_COLD_RESUME_MAX_TOKENS,
  CONTEXT_WINDOW_COLD_RESUME_MAX_OUTPUT_TOKENS,
  CONTEXT_WINDOW_COLD_RESUME_MODEL_ID,
  CONTEXT_WINDOW_COLD_RESUME_PROVIDER_ID,
  CONTEXT_WINDOW_COLD_RESUME_PROVIDER_NAME,
  seedProviderReadinessHistoryFixture,
} from "./test/e2e/helpers/provider-readiness-history-fixture.js";
import {
  PASSIVE_AGENT_STARTUP_SCENARIO,
  SMALL_AGENT_WARMUP_SCENARIO,
  seedPassiveAgentStartupWorkspaces,
} from "./test/e2e/helpers/passive-agent-startup-fixture.js";
import { seedSessionHistoryFirstFixture } from "./test/e2e/helpers/session-history-first-fixture.js";
import { seedTaskIndexRowAuthorityFixture } from "./test/e2e/helpers/task-list-row-authority-fixture.js";
import { seedDeleteAllArchivedTasksFixture } from "./test/e2e/helpers/delete-all-archived-tasks-fixture.js";
import { seedTaskTitleMarqueeFixture } from "./test/e2e/helpers/task-title-marquee-fixture.js";
import { seedAppUsageE2EFixture } from "./test/e2e/helpers/usage-stats-app-usage-fixture.js";

const DESKTOP_DIR = import.meta.dirname;
const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(DESKTOP_DIR, "../..");
const E2E_ELECTRON_SERVICE_MODULE_PATH = resolve(
  DESKTOP_DIR,
  "test/e2e/helpers/e2e-electron-service.ts",
);
const E2E_LOCAL_ENV_FILES = [
  resolve(DESKTOP_DIR, ".env.e2e.local"),
  resolve(REPO_ROOT, ".env.e2e.local"),
];
loadE2ELocalEnv();
const BUILD_DESKTOP_AGENT_SCRIPT = resolve(REPO_ROOT, "scripts/build-desktop-agent-cli.mjs");
const CF_CLI_ENTRYPOINT = resolve(REPO_ROOT, "apps/cli/packages/cli/dist/cf.cjs");
const E2E_HOME_DIR = resolve(
  process.env.CF_E2E_HOME_DIR?.trim() ||
    resolve(DESKTOP_DIR, ".e2e-home"),
);
const E2E_PACKAGED_APP_BINARY_PATH = process.env.CF_E2E_PACKAGED_APP_PATH?.trim()
  ? resolve(process.env.CF_E2E_PACKAGED_APP_PATH)
  : null;
const E2E_STORAGE_ROOT = resolve(E2E_HOME_DIR, ".cf");
const E2E_APP_CONFIG_DIR = resolve(E2E_STORAGE_ROOT, "v2");
const E2E_APP_SETTINGS_FILE = resolve(E2E_APP_CONFIG_DIR, "setting.json");
const E2E_APP_CREDENTIALS_FILE = resolve(E2E_APP_CONFIG_DIR, "credentials.json");
const E2E_APP_PROVIDER_CONFIG_FILE = resolve(E2E_APP_CONFIG_DIR, "provider_config.json");
const E2E_DEFAULT_CF_BUILTIN_PROVIDER_CONFIG_FILE = resolve(
  REPO_ROOT,
  "config/provider/cf-builtin.json",
);
const INITIAL_CF_BUILTIN_PROVIDER_CONFIG_FILE =
  process.env.CF_BUILTIN_PROVIDER_CONFIG_FILE?.trim();
const E2E_OFFPEAK_CF_BUILTIN_PROVIDER_CONFIG_FILE = resolve(
  REPO_ROOT,
  ".cache/desktop-e2e-provider-config/official-offpeak-mock.json",
);
const E2E_AGENTS_STATE_FILE = resolve(E2E_APP_CONFIG_DIR, "agents-state.json");
const E2E_CLI_CONFIG_DIR = resolve(E2E_STORAGE_ROOT, "cli");
const E2E_CLI_CONFIG_FILE = resolve(E2E_CLI_CONFIG_DIR, "config.json");
const E2E_CLI_AGENTS_DIR = resolve(E2E_CLI_CONFIG_DIR, "agents");
const E2E_USER_AGENTS_DIR = resolve(E2E_STORAGE_ROOT, "agents");
const E2E_NETWORK_CAPTURE_DIR = resolve(
  process.env.CF_E2E_NETWORK_CAPTURE_DIR?.trim() ||
    resolve(DESKTOP_DIR, ".e2e-network-capture"),
);
const E2E_CERT_CACHE_ROOT =
  process.env.CF_E2E_CERT_CACHE_DIR?.trim() || resolve(REPO_ROOT, ".cache");
const E2E_NETWORK_CAPTURE_CA_DIR = resolve(E2E_CERT_CACHE_ROOT, "desktop-e2e-network-capture-ca");
const E2E_CODING_PLAN_DATA_PLANE_CA_DIR = resolve(
  E2E_CERT_CACHE_ROOT,
  "desktop-e2e-coding-plan-data-plane-ca",
);
const E2E_BROWSER_DRIVER_CACHE_DIR = resolve(REPO_ROOT, ".cache/wdio-browser-drivers");
const DESKTOP_BUILD_OUTPUT_DIR = resolve(DESKTOP_DIR, "out");
const DESKTOP_BUILD_ENTRY_POINT = resolve(DESKTOP_BUILD_OUTPUT_DIR, "main/index.js");
const E2E_RENDERER_ASSETS_DIR = resolve(DESKTOP_DIR, "out/renderer/assets");
const UPSTREAM_CAPTURE_ARTIFACT_PATH = resolve(E2E_NETWORK_CAPTURE_DIR, "upstream-provider.json");
const CODING_PLAN_DATA_PLANE_ARTIFACT_PATH = resolve(
  E2E_NETWORK_CAPTURE_DIR,
  "coding-plan-data-plane.json",
);
const E2E_PROVIDER_RUNTIME_FILE = resolve(E2E_NETWORK_CAPTURE_DIR, "upstream-runtime.json");
const UPSTREAM_REPLAY_FIXTURE_ROOT = resolve(DESKTOP_DIR, "test/e2e/fixtures/upstream");
const UPSTREAM_COMMON_REPLAY_FIXTURE_PATH = resolve(UPSTREAM_REPLAY_FIXTURE_ROOT, "common.json");
const UPSTREAM_CONVERSATION_SESSION_REPLAY_FIXTURE_DIR = resolve(
  UPSTREAM_REPLAY_FIXTURE_ROOT,
  "conversation-session",
);
const UPSTREAM_CONVERSATION_SESSION_CASE_MANIFEST_DIR = resolve(
  DESKTOP_DIR,
  "test/e2e/fixtures/cases/conversation-session",
);
const LEGACY_UPSTREAM_REPLAY_FIXTURE_PATHS = [
  resolve(UPSTREAM_REPLAY_FIXTURE_ROOT, "provider-conversation-tool-cross-product.json"),
  resolve(UPSTREAM_REPLAY_FIXTURE_ROOT, "provider-basic.json"),
];
const UPSTREAM_CAPTURE_RESPONSE_PREVIEW_BYTES = 8 * 1024 * 1024;
const UPSTREAM_CAPTURE_RESPONSE_CHUNK_TIMELINE_BYTES = 16 * 1024 * 1024;
const E2E_ELECTRON_INSTALL_TIMEOUT_MS =
  readPositiveIntegerEnv("CF_E2E_ELECTRON_INSTALL_TIMEOUT_MS") ??
  DEFAULT_E2E_ELECTRON_INSTALL_TIMEOUT_MS;
const ELECTRON_APP_BINARY_PATH =
  E2E_PACKAGED_APP_BINARY_PATH ??
  resolveE2EElectronBinary({
    desktopDir: DESKTOP_DIR,
    environment: process.env,
    installTimeoutMs: E2E_ELECTRON_INSTALL_TIMEOUT_MS,
    repoRoot: REPO_ROOT,
  });
const UPSTREAM_PROVIDER_SPEC = "./test/e2e/upstream-provider.test.ts";
const TURN_STEER_PROBE_SPEC =
  "./test/e2e/conversation-session/manual-review/pending/conversation-session-turn-steer-probe.test.ts";
const PLUGIN_NO_GIT_GITHUB_ARCHIVE_SPEC = "plugin-no-git-github-archive.test.ts";
const GIT_COMMIT_DIALOG_UI_FLOW_SPEC = "git-commit-dialog-ui-flow.test.ts";
const OAUTH_CREDENTIAL_RECOVERY_SPEC = "oauth-credential-recovery.test.ts";
const JWT_EXPIRY_REAUTHENTICATION_SPEC = "jwt-expiry-reauthentication.test.ts";
const SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_SPEC =
  "subagent-coding-plan-login-catalog-stale.test.ts";
const SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE = "subagent-login-catalog-stale";
const SUBAGENT_CODING_PLAN_OAUTH_FLOW_ID = "e2e-subagent-bigmodel-flow";
const SUBAGENT_CODING_PLAN_OAUTH_STATE = "e2e-subagent-bigmodel-state";
const PROVIDER_READINESS_AGENT_STARTUP_SPEC = "provider-readiness-agent-startup.test.ts";
const CONTEXT_WINDOW_COLD_RESUME_SPEC = "conversation-session-context-window-cold-resume.test.ts";
const PASSIVE_AGENT_STARTUP_SPEC = "workspace-passive-agent-startup.test.ts";
const AGENT_WARMUP_LIFECYCLE_SPEC = "workspace-agent-warmup-lifecycle.test.ts";
const AGENT_WARMUP_SMALL_SET_SPEC = "workspace-agent-warmup-small-set.test.ts";
const PROVIDER_SAVE_DORMANT_AGENT_SPEC = "workspace-provider-save-dormant-agent.test.ts";
const MODEL_PROVIDER_REGRESSION_GAPS_SPEC =
  "conversation-session-model-provider-regression-gaps.test.ts";
const BROWSER_CROSS_WORKSPACE_CLOSE_SPEC = "browser-tab-close-cross-workspace.test.ts";
const WORKSPACE_REMOVAL_RUNTIME_RELEASE_SPEC = "workspace-removal-runtime-release.test.ts";
const AGENT_WARMUP_FIXTURE_SPECS = [
  PASSIVE_AGENT_STARTUP_SPEC,
  AGENT_WARMUP_LIFECYCLE_SPEC,
  AGENT_WARMUP_SMALL_SET_SPEC,
  PROVIDER_SAVE_DORMANT_AGENT_SPEC,
  BROWSER_CROSS_WORKSPACE_CLOSE_SPEC,
  WORKSPACE_REMOVAL_RUNTIME_RELEASE_SPEC,
  MODEL_PROVIDER_REGRESSION_GAPS_SPEC,
] as const;

const SMALL_AGENT_WARMUP_SPECS = [
  AGENT_WARMUP_SMALL_SET_SPEC,
  BROWSER_CROSS_WORKSPACE_CLOSE_SPEC,
  WORKSPACE_REMOVAL_RUNTIME_RELEASE_SPEC,
  MODEL_PROVIDER_REGRESSION_GAPS_SPEC,
] as const;
const TASK_INDEX_ROW_AUTHORITY_SPEC = "conversation-session-task-index-row-authority.test.ts";
const TASK_TITLE_MARQUEE_SPEC = "conversation-session-task-title-marquee.test.ts";
const GIT_REVIEW_ENTRY_SPEC = "conversation-session-git-review-entry.test.ts";
const WINDOWS_AGENT_METRIC_PROBE_ABSENCE_SPEC = "windows-agent-metric-probe-absence.test.ts";
const HOOKS_LIFECYCLE_SPEC = "conversation-session-hooks-lifecycle.test.ts";
const HOOK_TRUST_SPEC = "conversation-session-hook-trust.test.ts";
const E2E_PROVIDER_ID = "e2e-upstream";
const E2E_PROVIDER_ALTERNATE_PROVIDER_ID = "e2e-upstream-alt";
const E2E_PROVIDER_ALTERNATE_PROVIDER_NAME = "Upstream E2E Alt";
const { model: E2E_PROVIDER_MODEL, secondaryModel: E2E_PROVIDER_SECONDARY_MODEL } =
  resolveUpstreamModels();
const SUBAGENT_PROVIDER_REGISTRY_COLD_START_SPEC =
  "conversation-session-subagent-provider-registry-cold-start.test.ts";
const BUILT_IN_SUBAGENT_MODEL_OVERRIDES_SPEC =
  "conversation-session-built-in-subagent-model-overrides.test.ts";
const SETTINGS_SUBAGENT_CREATE_EDIT_PERSISTENCE_SPEC =
  "settings-subagent-create-edit-persistence.test.ts";
const SUBAGENT_REASONING_AGENT_NAME = "e2e-reasoning-reviewer";
const SUBAGENT_RUNTIME_CATALOG_REASONING_SPEC =
  "conversation-session-subagent-runtime-catalog-reasoning.test.ts";
const SUBAGENT_RUNTIME_CATALOG_PROVIDER_ID = "e2e-claude-runtime-catalog";
const SUBAGENT_RUNTIME_CATALOG_PROVIDER_NAME = "Claude Runtime Catalog E2E";
const SUBAGENT_RUNTIME_CATALOG_MODEL = "claude-opus-4-8";
const SUBAGENT_RUNTIME_CATALOG_AGENT_NAME = "e2e-claude-catalog-reviewer";
const OFFPEAK_SUBAGENT_MODEL_INHERITANCE_SPEC =
  "conversation-session-offpeak-subagent-model-inheritance.test.ts";
const OFFPEAK_INVALID_TICKET_SPEC = "conversation-session-off-peak-invalid-ticket.test.ts";
const MODEL_PROVIDER_PLAN_SURFACE_SPEC = "conversation-session-model-provider-plan-surface.test.ts";
const SUBAGENT_TEAM_SCOPE_SPEC = "conversation-session-subagent-team-scope.test.ts";
const TOOL_ERROR_SURFACE_SPEC = "conversation-session-tool-error-surface.test.ts";
const MODEL_OUTPUT_TOKEN_BUDGET_SPEC = "conversation-session-model-output-token-budget.test.ts";
const MODEL_OUTPUT_TOKEN_PREFLIGHT_SPEC = "conversation-session-model-output-token-preflight";
const OUTPUT_LIMIT_CONTINUE_MARKDOWN_PROTOCOLS_SPEC =
  "conversation-session-output-limit-continue-markdown-protocols.test.ts";
const SUBAGENT_PROVIDER_REGISTRY_AGENT_NAME = "e2e-provider-registry-reviewer";
const TOOL_ERROR_SURFACE_STALE_AGENT_NAME = "e2e-stale-error-reviewer";
const TOOL_ERROR_SURFACE_HEALTHY_AGENT_NAME = "e2e-healthy-error-reviewer";
const E2E_PROVIDER_UPSTREAM_BASE_URL = process.env.E2E_PROVIDER_BASE_URL?.trim() ?? "";
const E2E_PROVIDER_REPLAY_API_KEY = "e2e-fixture-key";
const CODING_PLAN_MODEL_SSE_BODY =
  'event: message_start\ndata: {"type":"message_start","message":{"id":"coding-plan-e2e","type":"message","role":"assistant","content":[],"model":"glm-e2e","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":128,"output_tokens":0}}}\n\n' +
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"coding-plan-e2e-ok"}}\n\n' +
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":12}}\n\n' +
  'event: message_stop\ndata: {"type":"message_stop"}\n\n';
const E2E_AUTH_PROVIDER_ID = "zai";
const E2E_AUTH_TOKEN = "e2e-oauth-token";
const E2E_USER_PROFILE = {
  displayName: "CodeFusion E2E",
  id: "cf-e2e-user",
  username: "cf-e2e-user",
};
const GLM_HIGHSPEED_E2E_PROVIDER_ID = "e2e-glmhighspeed";
const GLM_HIGHSPEED_E2E_MODEL = "glm-5.1-highspeed";
const GLM_HIGHSPEED_E2E_BASE_URL = "https://open.bigmodel.cn/api";
const BIGMODEL_GLM53_E2E_PROVIDER_ID = "e2e-bigmodel-glm53";
const BIGMODEL_GLM53_E2E_MODEL = "GLM-5.3";
const BIGMODEL_GLM53_E2E_BASE_URL = "https://open.bigmodel.cn/api";
const STAGING_MODEL_E2E_PROVIDER_ID = "e2e-staging-model";
const STAGING_MODEL_E2E_MODEL = "glm-5.2";
const STAGING_MODEL_E2E_BASE_URL = "https://open.bigmodel.cn/api";
const E2E_PROVIDER_PRESETS = {
  env: {
    apiKeyEnvNames: ["E2E_PROVIDER_API_KEY"],
    baseUrl: E2E_PROVIDER_UPSTREAM_BASE_URL,
    expectedHost: readUpstreamBaseUrlPart("host"),
    expectedProtocol: readUpstreamBaseUrlPart("protocol"),
    model: E2E_PROVIDER_MODEL,
    providerId: E2E_PROVIDER_ID,
    providerName: "Upstream E2E",
    thoughtLevel: "high",
  },
  glmhighspeed: {
    apiKeyEnvNames: [
      "GLM_HIGHSPEED_E2E_API_KEY",
      "BIGMODEL_API_KEY",
      "ZHIPUAI_API_KEY",
      "E2E_PROVIDER_API_KEY",
    ],
    baseUrl: GLM_HIGHSPEED_E2E_BASE_URL,
    expectedHost: "open.bigmodel.cn",
    expectedProtocol: "https",
    model: GLM_HIGHSPEED_E2E_MODEL,
    providerId: GLM_HIGHSPEED_E2E_PROVIDER_ID,
    providerName: "GLM Highspeed E2E",
    thoughtLevel: "",
  },
  bigmodel53: {
    apiKeyEnvNames: ["BIGMODEL_GLM53_E2E_API_KEY"],
    baseUrl: BIGMODEL_GLM53_E2E_BASE_URL,
    expectedHost: "open.bigmodel.cn",
    expectedProtocol: "https",
    model: BIGMODEL_GLM53_E2E_MODEL,
    providerId: BIGMODEL_GLM53_E2E_PROVIDER_ID,
    providerName: "BigModel GLM-5.3 E2E",
    thoughtLevel: "",
  },
  stagingmodel: {
    apiKeyEnvNames: ["STAGING_MODEL_E2E_API_KEY"],
    baseUrl: STAGING_MODEL_E2E_BASE_URL,
    expectedHost: "open.bigmodel.cn",
    expectedProtocol: "https",
    model: STAGING_MODEL_E2E_MODEL,
    providerId: STAGING_MODEL_E2E_PROVIDER_ID,
    providerName: "stagingModel",
    thoughtLevel: "",
  },
} as const;
type E2EProviderPresetName = keyof typeof E2E_PROVIDER_PRESETS;
const upstreamE2EContextWindowOverride = readPositiveIntegerEnv(
  "CF_E2E_UPSTREAM_CONTEXT_WINDOW",
);
const upstreamE2EMaxOutputTokensOverride = readPositiveIntegerEnv(
  "CF_E2E_UPSTREAM_MAX_OUTPUT_TOKENS",
);
const DESKTOP_PACKAGE_JSON = JSON.parse(
  readFileSync(resolve(DESKTOP_DIR, "package.json"), "utf-8"),
) as { devDependencies?: Record<string, string> };
const ELECTRON_VERSION = DESKTOP_PACKAGE_JSON.devDependencies?.electron ?? "";
const PNPM_COMMAND = "pnpm";
const E2E_ELECTRON_APP_QUIT_TIMEOUT_MS =
  readPositiveIntegerEnv("CF_E2E_ELECTRON_APP_QUIT_TIMEOUT_MS") ?? 1000;
const E2E_ELECTRON_FORCE_KILL_GRACE_MS =
  readPositiveIntegerEnv("CF_E2E_ELECTRON_FORCE_KILL_GRACE_MS") ?? 3000;
const E2E_RENDERER_BRIDGE_PREFLIGHT_TIMEOUT_MS =
  readPositiveIntegerEnv("CF_E2E_RENDERER_BRIDGE_PREFLIGHT_TIMEOUT_MS") ?? 15000;
const E2E_RUNNER_FORCE_EXIT_TIMEOUT_MS =
  readPositiveIntegerEnv("CF_E2E_RUNNER_FORCE_EXIT_TIMEOUT_MS") ?? 5000;
const E2E_RUNNER_FINALIZATION_GUARD_TIMEOUT_MS =
  readPositiveIntegerEnv("CF_E2E_RUNNER_FINALIZATION_GUARD_TIMEOUT_MS") ?? 30000;
const E2E_FAILURE_ARTIFACT_COLLECTION_TIMEOUT_MS = Math.min(
  readPositiveIntegerEnv("CF_E2E_FAILURE_ARTIFACT_COLLECTION_TIMEOUT_MS") ?? 60_000,
  5 * 60_000,
);
const E2E_WEBDRIVER_REQUEST_LIMITS = resolveE2EWebDriverRequestLimits({
  retryCount: process.env.CF_E2E_WEBDRIVER_REQUEST_RETRY_COUNT,
  timeoutMs: process.env.CF_E2E_WEBDRIVER_REQUEST_TIMEOUT_MS,
});
const E2E_HOME_REMOVE_RETRY_DELAYS_MS = [200, 500, 1000, 2000, 3000, 5000, 8000];
const HOST_HOME_DIR = process.env.HOME?.trim();
const HOST_USERPROFILE_DIR = process.env.USERPROFILE?.trim();

interface E2ERendererBridgePreflightResult {
  bridgeMethods: Record<string, boolean>;
  candidateHandles: string[];
  currentHandle: string | null;
  documentReadyState: string | null;
  handle: string | null;
  handles: string[];
  hasSessionBridge: boolean;
  missingBridgeMethods: string[];
  missingStateMethods: string[];
  ok: boolean;
  reason: string;
  stateMethods: Record<string, boolean>;
  targets: E2EBrowserTargetInfo[];
  url: string | null;
}

const E2E_RENDERER_BRIDGE_REQUIRED_BRIDGE_METHODS = ["getState", "setState", "subscribe"];
const E2E_RENDERER_BRIDGE_REQUIRED_STATE_METHODS = [
  "getWorkspaceState",
  "setSlashCommands",
  "setTaskRuntimeState",
  "upsertOptimisticTaskListItem",
];

const requestedE2ESpecs = readRequestedE2ESpecs();
const requestedE2EExcludeSpecs = readRequestedE2EExcludeSpecs();
const configuredModelRetryMaxRetries = process.env.CF_MODEL_RETRY_MAX_RETRIES;
const configuredE2EWorkerNetworkEnv = {
  httpProxy: process.env.CF_HTTP_PROXY,
  noProxy: process.env.CF_NO_PROXY,
};
const upstreamProviderSpecRequested = process.argv
  .concat(requestedE2ESpecs)
  .some((arg) => arg.includes("upstream-provider.test.ts"));
const turnSteerProbeSpecRequested = process.argv
  .concat(requestedE2ESpecs)
  .some((arg) => arg.includes("conversation-session-turn-steer-probe.test.ts"));
const manualReviewSpecRequested = process.argv
  .concat(requestedE2ESpecs)
  .some((arg) => arg.replaceAll("\\", "/").includes("/manual-review/"));
const manualReviewE2E =
  process.env.CF_E2E_MANUAL_REVIEW?.trim() === "1" || manualReviewSpecRequested;
if (manualReviewE2E) {
  process.env.CF_E2E_MANUAL_REVIEW = "1";
}
const manualReviewHoldMs = readPositiveIntegerEnv("CF_E2E_MANUAL_REVIEW_HOLD_MS") ?? 0;
const REQUESTED_UPSTREAM_HTTP_MODE_ENV = "CF_E2E_REQUESTED_UPSTREAM_HTTP_MODE";
const requestedUpstreamE2EHttpMode =
  process.env[REQUESTED_UPSTREAM_HTTP_MODE_ENV] !== undefined
    ? process.env[REQUESTED_UPSTREAM_HTTP_MODE_ENV]?.trim() || undefined
    : process.env.E2E_PROVIDER_HTTP_MODE?.trim() || undefined;
const requestedAskUserQuestionClockScale =
  process.env[ASK_USER_QUESTION_E2E_CLOCK_SCALE_ENV]?.trim() || undefined;
let upstreamE2EHttpMode = readUpstreamE2EHttpMode();
const e2eProviderPresetName = readE2EProviderPresetName();
const e2eProviderPreset = E2E_PROVIDER_PRESETS[e2eProviderPresetName];
const containerE2E = process.env.CF_E2E_CONTAINER === "1";
const configuredE2ESpecs =
  requestedE2ESpecs.length > 0
    ? requestedE2ESpecs
    : manualReviewE2E
      ? [MANUAL_REVIEW_SPEC_GLOB]
      : upstreamProviderSpecRequested
        ? [UPSTREAM_PROVIDER_SPEC]
        : ["./test/e2e/**/*.test.ts"];
const pluginNoGitGitHubArchiveE2E = configuredE2ESpecs.some((spec) =>
  spec.includes(PLUGIN_NO_GIT_GITHUB_ARCHIVE_SPEC),
);
const workspacePluginRemoteExplicitSyncE2E = configuredE2ESpecs.some((spec) =>
  spec.includes("conversation-session-plugin-remote-explicit-sync-workspace.test.ts"),
);
const e2eReporter = createE2EReporter({
  repoRoot: REPO_ROOT,
  desktopDir: DESKTOP_DIR,
  requestedSpecs: requestedE2ESpecs,
  containerE2E,
});
const e2eRunnerFinalizationGuard = createE2ERunnerFinalizationGuard({
  onTimeout: forceFinalizeE2ERunnerFromGuard,
  timeoutMs: E2E_RUNNER_FINALIZATION_GUARD_TIMEOUT_MS,
});
const E2E_RUN_ID = process.env.CF_E2E_RUN_ID?.trim();
if (!E2E_RUN_ID) {
  throw new Error("[e2e] CF_E2E_RUN_ID missing after reporter initialization");
}
const E2E_RUN_CACHE_DIR = resolve(DESKTOP_DIR, ".e2e-cache", E2E_RUN_ID);
const E2E_APP_OUTPUT_DIR = resolve(E2E_RUN_CACHE_DIR, "app");
const E2E_APP_ENTRY_POINT = resolve(E2E_APP_OUTPUT_DIR, "main/index.js");
const E2E_APP_RENDERER_ASSETS_DIR = resolve(E2E_APP_OUTPUT_DIR, "renderer/assets");
const E2E_REMOTE_ASSET_VERSION = String(
  (
    JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf-8")) as {
      version?: string;
    }
  ).version ?? "",
).trim();
const E2E_REMOTE_RELEASE_SOURCE_DIR = resolve(
  DESKTOP_DIR,
  "mock-cdn",
  "releases",
  E2E_REMOTE_ASSET_VERSION,
);
const E2E_REMOTE_RELEASE_OUTPUT_DIR = resolve(
  E2E_RUN_CACHE_DIR,
  "mock-cdn",
  "releases",
  E2E_REMOTE_ASSET_VERSION,
);
const E2E_CHROMIUM_USER_DATA_ROOT_DIR = resolve(E2E_RUN_CACHE_DIR, "chromium-profiles");
const containerChromeArgs = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--ozone-platform=x11",
  "--window-size=1440,1000",
];

process.env.HOME = E2E_HOME_DIR;
process.env.USERPROFILE = E2E_HOME_DIR;
process.env.CF_E2E_HOME_DIR = E2E_HOME_DIR;
process.env.CF_E2E_RUN_ID = E2E_RUN_ID;
process.env.CF_DATA_BASE_DIR = E2E_HOME_DIR;
process.env.CF_DESKTOP_APPLICATION_NAME = "CodeFusion E2E";
process.env.CF_DESKTOP_HOME_DIR = E2E_HOME_DIR;
process.env.CF_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA = "1";
process.env.VITE_CF_E2E_STORE_BRIDGE = "1";
process.env.CF_DISABLE_FIXED_REMOTE_DEBUGGING_PORT = "1";

let upstreamCaptureProxy: E2ENetworkCaptureProxy | null = null;
let upstreamReplayServer: UpstreamReplayServer | null = null;
let codingPlanTeamMockServer: Server | null = null;
let codingPlanTeamMockBaseUrl = "";
let codingPlanDataPlaneProxy: E2ENetworkCaptureProxy | null = null;
let codingPlanUpgradeMockServer: CodingPlanUpgradeMockServer | null = null;
let modelContextBudgetConfigMockServer: ModelContextBudgetConfigMockServer | null = null;
let dynamicWorkflowConfigMockServer: DynamicWorkflowConfigMockServer | null = null;
let clientScenesMockServer: ClientScenesMockServer | null = null;
let stopOAuthCompletionRaceFixture: (() => Promise<void>) | null = null;
let stopWebRemoteControlAuthGateFixture: (() => Promise<void>) | null = null;
let stopAccessToken401Fixture: (() => Promise<void>) | null = null;
let pluginCdnZipFixtureServer: PluginCdnZipFixtureServer | null = null;
let upstreamE2EBaseUrl: string = e2eProviderPreset.baseUrl;
let e2eRunnerExitWatchdog: ReturnType<typeof setTimeout> | null = null;
let currentE2EElectronAppPid: number | null = null;
let currentE2EWorkerSpecs: string[] = [];
let currentE2EBeforeSessionError: unknown = null;
let e2eFailureArtifacts: E2EFailureArtifactCollector | null = null;
let currentE2EWorkerSessionSpecs: string[] = [];
let currentE2EChromiumUserDataDir: string | null = null;
const e2eWorkerLifecycleStarts = new Map<string, { specs: string[]; startedAt: Date }>();

applyE2EProviderEnv();

async function measureE2ELifecyclePhase<T>(
  phase: E2ELifecyclePhase,
  context: { cid?: string; specs?: string[] },
  run: () => Promise<T> | T,
): Promise<T> {
  return await runMeasuredE2ELifecyclePhase(phase, context, e2eReporter.recordLifecycleEvent, run);
}

async function runE2EDiagnosticWithTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(), timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function loadE2ELocalEnv() {
  for (const envFile of E2E_LOCAL_ENV_FILES) {
    if (!existsSync(envFile)) {
      continue;
    }

    const parsedEnv: Record<string, string> = {};
    const result = loadDotenv({
      path: envFile,
      processEnv: parsedEnv,
      quiet: true,
    });
    if (result.error) {
      throw new Error(`Failed to load e2e env file: ${envFile}`, {
        cause: result.error,
      });
    }
    for (const [key, value] of Object.entries(parsedEnv)) {
      if (!process.env[key]?.trim()) {
        process.env[key] = value;
      }
    }
  }
}

function readRequestedE2ESpecs() {
  const specs = new Set<string>();
  appendRequestedE2ESpecs(specs, process.env.CF_E2E_SPEC);

  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (!arg) {
      continue;
    }
    if (arg === "--spec") {
      appendRequestedE2ESpecs(specs, process.argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--spec=")) {
      appendRequestedE2ESpecs(specs, arg.slice("--spec=".length));
    }
  }

  return [...specs];
}

function readRequestedE2EExcludeSpecs() {
  const specs = new Set<string>();
  appendRequestedE2ESpecs(specs, process.env.CF_E2E_EXCLUDE_SPEC);

  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (!arg) {
      continue;
    }
    if (arg === "--exclude") {
      appendRequestedE2ESpecs(specs, process.argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--exclude=")) {
      appendRequestedE2ESpecs(specs, arg.slice("--exclude=".length));
    }
  }

  return [...specs];
}

function appendRequestedE2ESpecs(specs: Set<string>, value?: string) {
  if (!value?.trim()) {
    return;
  }

  for (const spec of value.split(",")) {
    const trimmed = spec.trim();
    if (trimmed) {
      specs.add(trimmed);
    }
  }
}

function readConfiguredUpstreamReplayFixturePaths() {
  const configured = process.env.E2E_PROVIDER_REPLAY_FIXTURE_PATH?.trim();
  if (!configured) {
    return null;
  }

  return configured
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolve(REPO_ROOT, item));
}

function resolveUpstreamReplayFixturePaths(specs: string[] = []) {
  const configured = readConfiguredUpstreamReplayFixturePaths();
  return resolveUpstreamReplayFixturePathsFromContract({
    caseFixtureDir: UPSTREAM_CONVERSATION_SESSION_REPLAY_FIXTURE_DIR,
    caseManifestDir: UPSTREAM_CONVERSATION_SESSION_CASE_MANIFEST_DIR,
    commonFixturePath: UPSTREAM_COMMON_REPLAY_FIXTURE_PATH,
    configuredFixturePaths: configured,
    legacyFixturePaths: LEGACY_UPSTREAM_REPLAY_FIXTURE_PATHS,
    mode: readUpstreamReplayFixtureMode(),
    pluginFixturePaths: resolvePluginReplayFixturePaths(specs),
    specs,
  });
}

function readUpstreamReplayFixtureMode(): UpstreamReplayFixtureMode {
  const mode = process.env.E2E_PROVIDER_REPLAY_FIXTURE_MODE?.trim() || "compatible";
  if (mode === "compatible" || mode === "strict-case-local") {
    return mode;
  }
  throw new Error(
    `Unsupported E2E_PROVIDER_REPLAY_FIXTURE_MODE=${mode}. Expected compatible or strict-case-local.`,
  );
}

function resolvePluginReplayFixturePaths(specs: string[]): string[] {
  const fixtureDirs: string[] = [];
  if (workerSpecsContain(specs, "plugin-mcp-skill")) {
    fixtureDirs.push(resolve(UPSTREAM_REPLAY_FIXTURE_ROOT, "plugin-mcp-skill"));
  }
  if (workerSpecsContain(specs, "plugin-management-")) {
    fixtureDirs.push(resolve(UPSTREAM_REPLAY_FIXTURE_ROOT, "plugin-management"));
  }
  return fixtureDirs.filter(existsSync);
}

function readPositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  return Math.floor(parsed);
}

function readUpstreamBaseUrlPart(part: "host" | "protocol") {
  if (!E2E_PROVIDER_UPSTREAM_BASE_URL) return "";
  const url = new URL(E2E_PROVIDER_UPSTREAM_BASE_URL);
  return part === "host" ? url.host : url.protocol.replace(/:$/u, "");
}

function readE2EProviderPresetName(): E2EProviderPresetName {
  const configured =
    process.env.E2E_PROVIDER_PRESET?.trim() || process.env.LLM_E2E_PROVIDER_PRESET?.trim();
  if (!configured) {
    return "env";
  }
  if (
    configured === "env" ||
    configured === "glmhighspeed" ||
    configured === "bigmodel53" ||
    configured === "stagingmodel"
  ) {
    return configured;
  }
  throw new Error(
    `Unsupported E2E_PROVIDER_PRESET=${configured}. ` +
      "Expected env, glmhighspeed, bigmodel53, or stagingmodel.",
  );
}

function resolveActiveE2EProviderEnv(specs: string[] = configuredE2ESpecs) {
  return {
    providerId: e2eProviderPreset.providerId,
    providerName: e2eProviderPreset.providerName,
    model: e2eProviderPreset.model,
    thoughtLevel: readE2EThoughtLevel(),
  };
}

function applyE2EProviderEnv(specs: string[] = configuredE2ESpecs) {
  const providerEnv = resolveActiveE2EProviderEnv(specs);
  process.env.E2E_PROVIDER_PRESET = e2eProviderPresetName;
  process.env.E2E_PROVIDER_ID = providerEnv.providerId;
  process.env.E2E_PROVIDER_NAME = providerEnv.providerName;
  process.env.E2E_PROVIDER_MODEL = providerEnv.model;
  process.env.E2E_PROVIDER_ALTERNATE_PROVIDER_ID = E2E_PROVIDER_ALTERNATE_PROVIDER_ID;
  process.env.E2E_PROVIDER_ALTERNATE_PROVIDER_NAME = E2E_PROVIDER_ALTERNATE_PROVIDER_NAME;
  process.env.E2E_PROVIDER_ALTERNATE_MODEL = E2E_PROVIDER_SECONDARY_MODEL;
  process.env.E2E_PROVIDER_THOUGHT_LEVEL = providerEnv.thoughtLevel;
  Object.assign(
    process.env,
    getE2EProviderEndpointEnv(specs, e2eProviderPresetName, upstreamE2EHttpMode),
  );
}

function readE2EThoughtLevel() {
  for (const envName of ["E2E_PROVIDER_THOUGHT_LEVEL", "LLM_E2E_THOUGHT_LEVEL"]) {
    if (process.env[envName] !== undefined) {
      return process.env[envName]?.trim() ?? "";
    }
  }
  return e2eProviderPreset.thoughtLevel;
}

function readUpstreamE2EHttpMode() {
  const mode = resolveUpstreamE2EHttpMode({
    explicitReplayFixture: Boolean(process.env.E2E_PROVIDER_REPLAY_FIXTURE_PATH?.trim()),
    manualReview: manualReviewE2E,
    requestedMode: requestedUpstreamE2EHttpMode,
  });
  process.env.E2E_PROVIDER_HTTP_MODE = mode;
  return mode;
}

function applyUpstreamE2EHttpModeForWorker(specs: string[]) {
  upstreamE2EHttpMode = resolveUpstreamE2EHttpModeForWorker({
    caseLocalReplayFixtureAvailable: hasUpstreamCaseLocalReplayFixtureForWorker({
      caseFixtureDir: UPSTREAM_CONVERSATION_SESSION_REPLAY_FIXTURE_DIR,
      specs,
    }),
    explicitReplayFixture: Boolean(process.env.E2E_PROVIDER_REPLAY_FIXTURE_PATH?.trim()),
    requestedMode: requestedUpstreamE2EHttpMode,
    specs,
  });
  process.env.E2E_PROVIDER_HTTP_MODE = upstreamE2EHttpMode;
}

function applyAskUserQuestionClockScaleForWorker(specs: string[]) {
  const scale = resolveAskUserQuestionClockScaleForWorker({
    requestedScale: requestedAskUserQuestionClockScale,
    specs,
  });
  if (scale) {
    process.env[ASK_USER_QUESTION_E2E_CLOCK_SCALE_ENV] = scale;
  } else {
    delete process.env[ASK_USER_QUESTION_E2E_CLOCK_SCALE_ENV];
  }
}

function prepareDesktopAppBuild() {
  if (E2E_PACKAGED_APP_BINARY_PATH) {
    if (!existsSync(E2E_PACKAGED_APP_BINARY_PATH)) {
      throw new Error(`[e2e] packaged app binary missing: ${E2E_PACKAGED_APP_BINARY_PATH}`);
    }
    console.log(`[e2e] using packaged app: ${E2E_PACKAGED_APP_BINARY_PATH}`);
    return;
  }
  if (shouldReuseDesktopE2EBuild(process.env)) {
    console.log("[e2e] CF_E2E_SKIP_BUILD=1, skipping onPrepare build");
    assertDesktopE2EBuildReady("CF_E2E_SKIP_BUILD=1");
    return;
  }
  runPnpmWorkspaceCommand(["--filter", "@origin-ai/cf-desktop", "build:no-runtime-assets"]);
  assertDesktopE2EBuildReady("onPrepare build");
}

function runPnpmWorkspaceCommand(args: string[], options?: { timeoutMs?: number }) {
  execFileSync(PNPM_COMMAND, args, {
    cwd: REPO_ROOT,
    env: createPnpmChildEnv(),
    stdio: "inherit",
    ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    shell: process.platform === "win32",
  });
}

function assertDesktopE2EBuildReady(context: string) {
  if (!existsSync(DESKTOP_BUILD_ENTRY_POINT)) {
    throw new Error(
      `[e2e] ${context}: desktop main entrypoint missing: ${DESKTOP_BUILD_ENTRY_POINT}`,
    );
  }

  if (!isRendererE2EStoreBridgeCompiled(E2E_RENDERER_ASSETS_DIR)) {
    throw new Error(`[e2e] ${context}: renderer build is missing VITE_CF_E2E_STORE_BRIDGE=1`);
  }
}

async function stageDesktopE2EAppOutput() {
  await rm(E2E_APP_OUTPUT_DIR, { force: true, recursive: true });
  await stageE2EAppOutput(DESKTOP_BUILD_OUTPUT_DIR, E2E_APP_OUTPUT_DIR);
  if (
    hasRequiredSshE2EEnvironment(process.env) ||
    process.env.CF_E2E_SSH_HOST?.trim() ||
    process.env.CF_E2E_SSH_A_HOST?.trim() ||
    process.env.CF_E2E_SSH_B_HOST?.trim()
  ) {
    // fail-closed。
    // prepare:remote-assets（→ @origin-ai/cf-server-cli stage:remote-assets）。runPnpmWorkspaceCommand
    ensureSshRemoteReleaseAssets({
      releaseDir: E2E_REMOTE_RELEASE_SOURCE_DIR,
      prepareReleaseAssets: () =>
        runPnpmWorkspaceCommand(["prepare:remote-assets"], {
          timeoutMs: 30 * 60 * 1000,
        }),
    });
    await stageE2EAppOutput(E2E_REMOTE_RELEASE_SOURCE_DIR, E2E_REMOTE_RELEASE_OUTPUT_DIR);
  }
  if (!existsSync(E2E_APP_ENTRY_POINT)) {
    throw new Error(`[e2e] staged desktop main entrypoint missing: ${E2E_APP_ENTRY_POINT}`);
  }
  if (!isRendererE2EStoreBridgeCompiled(E2E_APP_RENDERER_ASSETS_DIR)) {
    throw new Error("[e2e] staged renderer is missing VITE_CF_E2E_STORE_BRIDGE=1");
  }
}

function isRendererE2EStoreBridgeCompiled(rendererAssetsDir: string) {
  if (!existsSync(rendererAssetsDir)) {
    return false;
  }

  return readdirSync(rendererAssetsDir, { withFileTypes: true }).some((entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      return false;
    }

    const source = readFileSync(resolve(rendererAssetsDir, entry.name), "utf-8");
    return /["'\x60]?VITE_CF_E2E_STORE_BRIDGE["'\x60]?\s*:\s*["'\x60]1["'\x60]/u.test(source);
  });
}

function createPnpmChildEnv() {
  const { NODE_OPTIONS: _nodeOptions, ...env } = process.env;
  return {
    ...env,
    ...(HOST_HOME_DIR ? { HOME: HOST_HOME_DIR } : {}),
    ...(HOST_USERPROFILE_DIR ? { USERPROFILE: HOST_USERPROFILE_DIR } : {}),
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
    VITE_CF_E2E_STORE_BRIDGE: "1",
    CF_DESKTOP_AGENT_BUILD_MODE: env.CF_DESKTOP_AGENT_BUILD_MODE ?? "pnpm",
  };
}

function prepareCfAgentServer() {
  if (E2E_PACKAGED_APP_BINARY_PATH) {
    configureCfAgentServerEnv();
    return;
  }
  if (process.env.CF_E2E_SKIP_AGENT_BUILD === "1") {
    console.log("[e2e] CF_E2E_SKIP_AGENT_BUILD=1, skipping agent build");
    if (!existsSync(CF_CLI_ENTRYPOINT)) {
      throw new Error(`CodeFusion CLI entrypoint not found: ${CF_CLI_ENTRYPOINT}`);
    }
    configureCfAgentServerEnv();
    return;
  }

  execFileSync(process.execPath, [BUILD_DESKTOP_AGENT_SCRIPT], {
    cwd: REPO_ROOT,
    env: createPnpmChildEnv(),
    stdio: "inherit",
  });

  if (!existsSync(CF_CLI_ENTRYPOINT)) {
    throw new Error(`CodeFusion CLI entrypoint not found: ${CF_CLI_ENTRYPOINT}`);
  }

  configureCfAgentServerEnv();
}

function configureCfAgentServerEnv() {
  delete process.env.CF_AGENT_SERVER_COMMAND;
  delete process.env.CF_AGENT_SERVER_ARGS_JSON;
  delete process.env.CF_AGENT_SERVER_CWD;
}

function assertUpstreamCaptureConfig() {
  if (!e2eProviderPreset.baseUrl) {
    throw new Error(
      `E2E_PROVIDER_HTTP_MODE=capture with ${e2eProviderPresetName} requires E2E_PROVIDER_BASE_URL.`,
    );
  }
  const apiKey = readE2EProviderApiKey();
  if (apiKey && apiKey !== "xxx") {
    return;
  }

  throw new Error(
    `E2E_PROVIDER_HTTP_MODE=capture with ${e2eProviderPresetName} requires one of: ${e2eProviderPreset.apiKeyEnvNames.join(", ")}.`,
  );
}

function readE2EProviderApiKey() {
  for (const envName of e2eProviderPreset.apiKeyEnvNames) {
    const value = process.env[envName]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function ensureUpstreamReplayConfig() {
  process.env.E2E_PROVIDER_API_KEY = E2E_PROVIDER_REPLAY_API_KEY;
}

async function startUpstreamE2EHttp(specs: string[] = []) {
  await stopUpstreamE2EHttp();
  if (
    upstreamE2EHttpMode === "capture" ||
    specs.some((spec) => spec.includes("conversation-session-toolsearch"))
  ) {
    applyE2EWorkerReplayProxyEnv(process.env, [], "", configuredE2EWorkerNetworkEnv);
    await startUpstreamCaptureProxy(specs);
    return;
  }

  ensureUpstreamReplayConfig();
  upstreamReplayServer = await startUpstreamReplayServer({
    artifactPath: UPSTREAM_CAPTURE_ARTIFACT_PATH,
    fixtureVariables: createE2EReplayFixtureVariables(E2E_HOME_DIR),
    fixturePaths: resolveUpstreamReplayFixturePaths(specs),
  });
  upstreamE2EBaseUrl = upstreamReplayServer.baseUrl;
  process.env.E2E_PROVIDER_CAPTURE_MODE = "replay";
  process.env.E2E_PROVIDER_CAPTURE_PATH = upstreamReplayServer.artifactPath;
  process.env.E2E_PROVIDER_CAPTURE_PROXY_URL = upstreamReplayServer.baseUrl;
  process.env.E2E_PROVIDER_EXPECTED_HOST = `${upstreamReplayServer.host}:${upstreamReplayServer.port}`;
  process.env.E2E_PROVIDER_EXPECTED_PROTOCOL = "http";
  process.env.E2E_PROVIDER_RUNTIME_BASE_URL = upstreamReplayServer.baseUrl;
  process.env.NO_PROXY = DEFAULT_E2E_NETWORK_CAPTURE_NO_PROXY;
  process.env.no_proxy = DEFAULT_E2E_NETWORK_CAPTURE_NO_PROXY;
  applyE2EWorkerReplayProxyEnv(
    process.env,
    specs,
    upstreamReplayServer.baseUrl,
    configuredE2EWorkerNetworkEnv,
  );
  writeUpstreamE2ERuntimeFile("replay", upstreamReplayServer.baseUrl);
}

function shouldUseCodingPlanTeamMock(specs: string[] = []) {
  return shouldPrepareCodingPlanTeamMock(specs);
}

async function startCodingPlanTeamMockIfNeeded(specs: string[] = []) {
  if (!shouldUseCodingPlanTeamMock(specs)) {
    await stopCodingPlanTeamMock();
    return;
  }

  const preparedBaseUrl = process.env[CODING_PLAN_TEAM_MOCK_BASE_URL_ENV]?.trim();
  if (!codingPlanTeamMockServer && preparedBaseUrl) {
    if (await isCodingPlanTeamMockAlive(preparedBaseUrl)) {
      codingPlanTeamMockBaseUrl = preparedBaseUrl;
      applyCodingPlanTeamMockEnv(process.env, preparedBaseUrl);
      return;
    }
    delete process.env[CODING_PLAN_TEAM_MOCK_BASE_URL_ENV];
  }
  if (codingPlanTeamMockServer) {
    applyCodingPlanTeamMockEnv(process.env, codingPlanTeamMockBaseUrl);
    return;
  }
  if (process.env.WDIO_WORKER_ID !== undefined) {
    throw new Error(
      "coding plan reset mock not prepared in onPrepare (runnerEnv missing active CF_E2E_CODING_PLAN_MOCK_URL).",
    );
  }

  let caseMode:
    | "default"
    | typeof SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE
    | "model-provider-plan-surface" = "default";
  let subagentOAuthTokenIssued = false;
  let modelProviderCatalogMode: "full" | "partial" | "unavailable" = "full";
  let presentation: EntitlementPresentation | undefined;
  let scenario: "personalOnly" | "teamOnly" | "both" = "both";
  const startIndependent = workerSpecsContain(
    specs,
    "conversation-session-start-plan-independent.test.ts",
  );
  let providerResponsive = startIndependent;
  let faultMode:
    | "none"
    | "optionalActivity"
    | "quotaBusinessFailure"
    | "quotaFailure"
    | "startBalance"
    | "startBalanceFailure"
    | "unavailableTeam"
    | "expiredTeam"
    | "twoTeams" = "none";
  let resetScenario:
    | "none"
    | "emptyThenGrant"
    | "existingMultiple"
    | "fiveHourUse"
    | "multiFiveHourUse"
    | "multiFiveHourUseLagging"
    | "urgentOpportunity" = "none";
  let resetScenarioStartedAt = Date.now();
  let resetOpportunityGranted = false;
  let resetUseAccepted = false;
  let resetUseConfirmed = false;
  let resetUsedAt: number | null = null;
  const resetMultiUsedKeys = new Set<string>();
  let resetMultiUnread = false;
  const RESET_USE_VISIBLE_LAG_MS = 600;
  let resetMultiLag: {
    usedAt: number | null;
    usedCount: number;
    unread: boolean;
    visibleAt: number;
  } | null = null;
  const requests: Array<{
    body?: unknown;
    headers: Record<string, string | string[] | undefined>;
    method: string;
    path: string;
    query: Record<string, string>;
  }> = [];
  const shareMockRoute = createConversationShareMockRoute();
  codingPlanTeamMockServer = createServer(async (request, response) => {
    if (await shareMockRoute(request, response)) return;
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__e2e/coding-plan/case-mode" && request.method === "POST") {
      presentation = undefined;
      const body = await readRequestJson<{ mode?: typeof caseMode }>(request);
      caseMode =
        body.mode === SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE
          ? SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE
          : body.mode === "model-provider-plan-surface"
            ? "model-provider-plan-surface"
            : "default";
      subagentOAuthTokenIssued = false;
      modelProviderCatalogMode = "full";
      scenario =
        caseMode === SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE ? "personalOnly" : "both";
      faultMode = "none";
      resetScenario = "none";
      resetScenarioStartedAt = Date.now();
      resetOpportunityGranted = false;
      resetUseAccepted = false;
      resetUseConfirmed = false;
      resetUsedAt = null;
      resetMultiUsedKeys.clear();
      resetMultiUnread = false;
      resetMultiLag = null;
      requests.length = 0;
      writeJson(response, { mode: caseMode, ok: true });
      return;
    }
    if (url.pathname === "/__e2e/coding-plan/team-health" && request.method === "GET") {
      writeJson(response, { ok: true, mock: "team" });
      return;
    }

    if (url.pathname === "/__e2e/coding-plan/catalog-mode" && request.method === "POST") {
      const body = await readRequestJson<{ mode?: string }>(request);
      if (body.mode !== "full" && body.mode !== "partial" && body.mode !== "unavailable") {
        writeJson(response, { code: 400, msg: "invalid catalog mode" }, 400);
        return;
      }
      modelProviderCatalogMode = body.mode;
      writeJson(response, { mode: modelProviderCatalogMode, ok: true });
      return;
    }

    if (url.pathname === "/__e2e/coding-plan/scenario" && request.method === "POST") {
      const body = await readRequestJson<{
        scenario?: typeof scenario;
        faultMode?: typeof faultMode;
        providerResponsive?: boolean;
        presentation?: EntitlementPresentation;
      }>(request);
      providerResponsive = body.providerResponsive === true;
      presentation = body.presentation;
      if (
        body.scenario === "personalOnly" ||
        body.scenario === "teamOnly" ||
        body.scenario === "both"
      ) {
        scenario = body.scenario;
      }
      faultMode =
        body.faultMode === "optionalActivity" ||
        body.faultMode === "quotaBusinessFailure" ||
        body.faultMode === "quotaFailure" ||
        body.faultMode === "startBalance" ||
        body.faultMode === "unavailableTeam" ||
        body.faultMode === "expiredTeam" ||
        body.faultMode === "twoTeams" ||
        body.faultMode === "startBalanceFailure"
          ? body.faultMode
          : "none";
      requests.length = 0;
      writeJson(response, { faultMode, ok: true, scenario });
      return;
    }
    if (url.pathname === "/__e2e/coding-plan/reset-scenario" && request.method === "POST") {
      const body = await readRequestJson<{
        resetScenario?: typeof resetScenario;
      }>(request);
      resetScenario =
        body.resetScenario === "emptyThenGrant" ||
        body.resetScenario === "existingMultiple" ||
        body.resetScenario === "fiveHourUse" ||
        body.resetScenario === "multiFiveHourUse" ||
        body.resetScenario === "multiFiveHourUseLagging" ||
        body.resetScenario === "urgentOpportunity"
          ? body.resetScenario
          : "none";
      resetOpportunityGranted = false;
      resetScenarioStartedAt = Date.now();
      resetUseAccepted = false;
      resetUseConfirmed = false;
      resetUsedAt = null;
      resetMultiUsedKeys.clear();
      resetMultiUnread = false;
      resetMultiLag = null;
      requests.length = 0;
      writeJson(response, { ok: true, resetScenario });
      return;
    }
    if (url.pathname === "/__e2e/coding-plan/reset-confirm-use" && request.method === "POST") {
      resetUseConfirmed = true;
      resetUsedAt ??= Date.now();
      writeJson(response, { ok: true });
      return;
    }
    if (url.pathname === "/__e2e/coding-plan/requests") {
      writeJson(response, { ok: true, requests });
      return;
    }

    const isResetMutation =
      request.method === "POST" &&
      (url.pathname.endsWith("/coding-plan/reset/opportunity") ||
        url.pathname.endsWith("/coding-plan/reset/use"));
    const requestBody = isResetMutation ? await readRequestJson<unknown>(request) : undefined;
    requests.push({
      ...(requestBody === undefined ? {} : { body: requestBody }),
      headers: {
        authorization: request.headers.authorization,
        "bigmodel-organization": request.headers["bigmodel-organization"],
        "bigmodel-project": request.headers["bigmodel-project"],
        "x-bigmodel-authorization": request.headers["x-bigmodel-authorization"],
      },
      method: request.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
    });

    if (presentation) {
      const fixture = presentationResponse(url.pathname, presentation);
      if (fixture) {
        writeJson(response, fixture);
        return;
      }
    }

    if (
      caseMode === SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE &&
      request.method === "POST" &&
      url.pathname === "/api/v1/oauth/cli/init"
    ) {
      writeJson(response, {
        code: 0,
        data: {
          authorize_url: `https://bigmodel.cn/login?appId=cf&redirect=${encodeURIComponent("https://cf.z.ai/api/v1/oauth/cli/callback/bigmodel")}&state=${SUBAGENT_CODING_PLAN_OAUTH_STATE}`,
          expires_at: Math.floor(Date.now() / 1000) + 300,
          flow_id: SUBAGENT_CODING_PLAN_OAUTH_FLOW_ID,
          poll_interval_sec: 30,
        },
        msg: "",
      });
      return;
    }

    if (caseMode === "model-provider-plan-surface" && request.method === "GET") {
      if (url.pathname === "/api/v2/releases/latest") {
        writeJson(response, {
          config_version: "e2e-model-provider-catalog-v1",
          version: "3.8.1-e2e",
        });
        return;
      }
      if (url.pathname === "/api/v1/client/configs") {
        if (modelProviderCatalogMode === "unavailable") {
          writeJson(
            response,
            { code: 503, data: null, msg: "catalog temporarily unavailable" },
            503,
          );
          return;
        }
        if (modelProviderCatalogMode === "partial") {
          writeJson(response, {
            ...MODEL_PROVIDER_CATALOG_PAYLOAD,
            data: {
              ...MODEL_PROVIDER_CATALOG_PAYLOAD.data,
              builtinModels: MODEL_PROVIDER_CATALOG_PAYLOAD.data.builtinModels.slice(0, 1),
              builtinProviders: MODEL_PROVIDER_CATALOG_PAYLOAD.data.builtinProviders.slice(0, 1),
            },
          });
          return;
        }
        writeJson(response, MODEL_PROVIDER_CATALOG_PAYLOAD);
        return;
      }
    }

    if (
      caseMode === SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE &&
      request.method === "GET" &&
      url.pathname === `/api/v1/oauth/cli/poll/${SUBAGENT_CODING_PLAN_OAUTH_FLOW_ID}`
    ) {
      writeJson(response, {
        code: 0,
        data: { status: "pending" },
        msg: "",
      });
      return;
    }

    if (
      caseMode === SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE &&
      request.method === "POST" &&
      url.pathname === "/api/v1/oauth/token"
    ) {
      subagentOAuthTokenIssued = true;
      writeJson(response, {
        code: 0,
        data: {
          token: "e2e-subagent-login-cf-jwt",
          bigmodel: {
            access_token: "e2e-subagent-login-bigmodel-token",
            refresh_token: "e2e-subagent-login-bigmodel-refresh-token",
          },
        },
        msg: "",
      });
      return;
    }

    if (
      caseMode === SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE &&
      request.method === "GET" &&
      url.pathname === "/api/v2/releases/latest"
    ) {
      writeJson(response, {
        config_version: resolveSubagentLoginCatalogConfigVersion(subagentOAuthTokenIssued),
        version: "3.8.1-e2e",
      });
      return;
    }

    if (
      caseMode === SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE &&
      request.method === "GET" &&
      url.pathname === "/api/v1/client/configs"
    ) {
      writeJson(
        response,
        resolveSubagentLoginCatalogPayload({
          configVersion: url.searchParams.get("config_version"),
          oauthTokenIssued: subagentOAuthTokenIssued,
        }),
      );
      return;
    }

    if (
      faultMode === "startBalanceFailure" &&
      url.pathname === "/api/v1/cf-plan/billing/balance"
    ) {
      writeJson(response, { code: 429, msg: "Too many requests" }, 429);
      return;
    }

    if (
      providerResponsive &&
      request.method === "GET" &&
      url.pathname === "/api/v1/cf-plan/billing/balance"
    ) {
      writeJson(
        response,
        buildProviderResponsiveStartBalance(startIndependent ? "GLM-5.2" : undefined),
      );
      return;
    }

    if (
      caseMode === SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE &&
      request.method === "GET" &&
      url.pathname === "/api/v1/cf-plan/billing/balance"
    ) {
      writeJson(response, {
        code: 0,
        data: { balances: [], plans: [] },
        msg: "",
        success: true,
      });
      return;
    }

    if (
      caseMode === "model-provider-plan-surface" &&
      request.method === "GET" &&
      url.pathname === "/api/v1/cf-plan/billing/balance"
    ) {
      writeJson(response, {
        code: 0,
        data: {
          plans: [
            {
              plan_id: "cf-v3-start-plan",
              name: "CodeFusion V3 Start Plan",
              status: "active",
            },
          ],
          balances: [],
        },
        msg: "",
        success: true,
      });
      return;
    }

    if (url.pathname === "/api/v1/coding-plan/reset/status") {
      if (resetScenario === "multiFiveHourUse" || resetScenario === "multiFiveHourUseLagging") {
        const lag =
          resetMultiLag !== null && Date.now() < resetMultiLag.visibleAt ? resetMultiLag : null;
        const usedCount = lag ? lag.usedCount : resetMultiUsedKeys.size;
        const usedAt = lag ? lag.usedAt : resetUsedAt;
        writeJson(response, {
          code: 0,
          data: {
            available_five_hour_resets: [
              { expire_at: resetScenarioStartedAt + 3_600_000 },
              { expire_at: resetScenarioStartedAt + 7_200_000 },
            ].slice(usedCount),
            available_week_resets: [{ expire_at: resetScenarioStartedAt + 86_400_000 }],
            latest_five_hour_reset_history:
              usedCount > 0 && usedAt !== null ? { used_at: usedAt } : null,
            latest_week_reset_history: null,
            has_unread_history: lag ? lag.unread : resetMultiUnread,
          },
        });
        return;
      }
      const useConfirmed = resetUseAccepted && resetUseConfirmed;
      const hasGrantedOpportunity = resetScenario !== "emptyThenGrant" || resetOpportunityGranted;
      const availableFiveHourResets =
        resetScenario === "none" || !hasGrantedOpportunity || useConfirmed
          ? []
          : resetScenario === "existingMultiple"
            ? [
                { expire_at: resetScenarioStartedAt + 3_600_000 },
                { expire_at: resetScenarioStartedAt + 7_200_000 },
              ]
            : resetScenario === "urgentOpportunity"
              ? // E2E mock must remain urgent after the Electron restart/build barrier;
                // anchoring to scenario setup made the opportunity expire before the
                // renderer finished its first status poll on slower Air runs.
                [{ expire_at: Date.now() + 120_000 }]
              : [{ expire_at: resetScenarioStartedAt + 3_600_000 }];
      const availableWeekResets =
        resetScenario === "existingMultiple" || resetScenario === "fiveHourUse"
          ? [{ expire_at: resetScenarioStartedAt + 86_400_000 }]
          : [];
      writeJson(response, {
        code: 0,
        data: {
          available_five_hour_resets: availableFiveHourResets,
          available_week_resets: availableWeekResets,
          latest_five_hour_reset_history:
            useConfirmed && resetUsedAt !== null ? { used_at: resetUsedAt } : null,
          latest_week_reset_history: null,
          has_unread_history: useConfirmed,
        },
      });
      return;
    }

    if (url.pathname === "/api/v1/coding-plan/reset/opportunity") {
      const granted = resetScenario === "emptyThenGrant" || resetScenario === "existingMultiple";
      resetOpportunityGranted ||= granted;
      writeJson(response, {
        code: granted ? 0 : 3301,
        data: granted ? { granted: true } : { granted: false, next_try_at: Date.now() + 60_000 },
      });
      return;
    }

    if (url.pathname === "/api/v1/coding-plan/reset/use") {
      if (resetScenario === "multiFiveHourUse" || resetScenario === "multiFiveHourUseLagging") {
        const idempotencyKey = (requestBody as { idempotency_key?: unknown } | null | undefined)
          ?.idempotency_key;
        if (
          typeof idempotencyKey === "string" &&
          idempotencyKey &&
          !resetMultiUsedKeys.has(idempotencyKey)
        ) {
          if (resetScenario === "multiFiveHourUseLagging") {
            resetMultiLag = {
              usedAt: resetUsedAt,
              usedCount: resetMultiUsedKeys.size,
              unread: resetMultiUnread,
              visibleAt: Date.now() + RESET_USE_VISIBLE_LAG_MS,
            };
          }
          resetMultiUsedKeys.add(idempotencyKey);
          resetUsedAt = Math.max(Date.now(), (resetUsedAt ?? 0) + 1);
          resetMultiUnread = true;
        }
        writeJson(response, { code: 0, data: { used: true } });
        return;
      }
      resetUseAccepted = true;
      resetUseConfirmed = false;
      writeJson(response, { code: 0, data: { used: true } });
      return;
    }

    if (url.pathname === "/api/v1/coding-plan/reset/history/read") {
      resetMultiUnread = false;
      writeJson(response, { code: 0, data: null });
      return;
    }

    if (url.pathname === "/api/v1/client/configs") {
      writeJson(response, {
        code: 0,
        success: true,
        data: {
          configs: requestSecurityClientConfig(),
        },
      });
      return;
    }
    if (url.pathname === "/api/v1/agent/configs") {
      writeJson(response, {
        code: 0,
        data: requestSecurityAgentConfig(),
      });
      return;
    }

    if (url.pathname === "/api/anthropic/v1/messages") {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
      });
      response.end(CODING_PLAN_MODEL_SSE_BODY);
      return;
    }

    if (url.pathname === "/api/biz/subscription/enterprise/v2/pricing") {
      writeJson(response, {
        code: 200,
        data: {
          productList:
            scenario === "personalOnly"
              ? []
              : [
                  {
                    productId: "product-team-a",
                    tier: "PRO",
                    subscribeMode: "CONTINUOUS",
                    subscribePeriod: "MONTHLY",
                    purchaseMethodName: "Monthly auto-renew",
                    subscribed: true,
                  },
                ],
        },
      });
      return;
    }

    if (url.pathname === "/api/biz/customer/getCustomerInfo") {
      writeJson(response, {
        code: 200,
        data: {
          ...(caseMode === SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE
            ? {
                avatar: "",
                customerName: "Subagent Login E2E",
                customerNumber: "subagent-login-e2e-user",
                nickName: "Subagent Login E2E",
              }
            : {}),
          organizations: [
            ...(["expiredTeam", "twoTeams"].includes(faultMode)
              ? [
                  {
                    organizationId: "org-team-b",
                    organizationName: "Active Team",
                    projects: [{ projectId: "proj-team-b", projectName: "Team B", projectType: 2 }],
                  },
                ]
              : []),
            ...(faultMode === "unavailableTeam"
              ? [
                  {
                    organizationId: "org-unavailable",
                    organizationName: "Unavailable Team",
                    projects: [
                      { projectId: "proj-unavailable", projectName: "Unavailable", projectType: 2 },
                    ],
                  },
                ]
              : []),
            {
              organizationId: "org-team-a",
              organizationName: providerResponsive ? PROVIDER_RESPONSIVE_TEAM_NAME : "Team Org",
              projects: [
                ...(scenario !== "teamOnly" ||
                caseMode === SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE ||
                caseMode === "model-provider-plan-surface"
                  ? [
                      {
                        projectId: "proj-personal-a",
                        projectName: "Personal Project",
                        projectType: 1,
                      },
                    ]
                  : []),
                {
                  projectId: "proj-team-a",
                  projectName: "Team A",
                  projectType: 2,
                },
              ],
            },
          ],
        },
      });
      return;
    }

    if (request.method === "POST" && url.pathname.endsWith("/access_tokens")) {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const expiresAt = Math.floor(Date.now() / 1000) + 600;
      const token = `${encode({ alg: "HS256", typ: "JWT", sign_type: "SIGN" })}.${encode({ token_use: "project_access", api_key: "e2e-key", exp: expiresAt })}.e2e-signature`;
      writeJson(response, {
        code: 200,
        data: { enable: true, accessToken: token, tokenType: "Bearer", expiresIn: 600, expiresAt },
      });
      return;
    }

    if (url.pathname.endsWith("/api_keys")) {
      const personal = url.pathname.includes("/projects/proj-personal-a/");
      if (faultMode === "unavailableTeam" && url.pathname.includes("/projects/proj-unavailable/")) {
        writeJson(
          response,
          request.method === "POST"
            ? { code: 200, success: false, msg: "暂无有效的团队套餐授权记录", data: null }
            : { code: 200, data: [] },
        );
        return;
      }
      writeJson(response, {
        code: 200,
        data: [
          {
            apiKey: personal ? "personal-ak" : "team-ak",
            keyType: personal ? 1 : 2,
            name: personal ? "cf-api-key" : "cf-team-api-key",
          },
        ],
      });
      return;
    }

    if (
      request.method === "POST" &&
      /^\/api\/biz\/v1\/organization\/org-team-a\/projects\/proj-(personal|team)-a\/api_keys\/(personal|team)-ak\/access_tokens$/.test(
        url.pathname,
      )
    ) {
      const body = await readRequestJson<{ clientType?: string }>(request);
      if (body.clientType !== "cf" || !request.headers.authorization?.startsWith("Bearer ")) {
        writeJson(response, { code: 400, msg: "invalid_token_request" }, 400);
        return;
      }
      const expiresIn = 600;
      const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const token = `${encode({ alg: "HS256", typ: "JWT", sign_type: "SIGN" })}.${encode({ token_use: "project_access", api_key: "e2e-key", exp: expiresAt })}.e2e-signature`;
      writeJson(response, {
        code: 200,
        data: { enable: true, accessToken: token, tokenType: "Bearer", expiresIn, expiresAt },
      });
      return;
    }

    if (
      url.pathname.endsWith("/api_keys/copy/team-ak") ||
      url.pathname.endsWith("/api_keys/copy/personal-ak")
    ) {
      const personal = url.pathname.endsWith("/api_keys/copy/personal-ak");
      writeJson(response, {
        code: 200,
        data: { secretKey: personal ? "personal-secret" : "team-secret" },
      });
      return;
    }

    if (url.pathname === "/api/biz/team/subscribe/product/querySubscribeDetail") {
      writeJson(response, {
        code: 200,
        success: true,
        data:
          scenario === "personalOnly"
            ? { hasSubscription: false }
            : {
                hasSubscription: true,
                status:
                  faultMode === "expiredTeam" &&
                  request.headers["bigmodel-project"] !== "proj-team-b"
                    ? "EXPIRED"
                    : "EFFECTIVE",
                memberGrantStatus: "VALID",
                productId: "product-team-a",
                productName: "Team Org",
                subscribeEndTime: "2027-08-25",
                subscribePeriod: "YEARLY",
              },
      });
      return;
    }

    if (url.pathname === "/api/biz/subscription/list") {
      writeJson(response, {
        code: 200,
        data:
          scenario === "teamOnly"
            ? []
            : [
                {
                  productId: "personal-coding",
                  productName: "Coding Plan",
                  inCurrentPeriod: true,
                  status: "VALID",
                  renewTime: "2026-08-01T00:00:00.000Z",
                },
              ],
      });
      return;
    }

    if (url.pathname === "/api/monitor/usage/quota/limit") {
      if (faultMode === "quotaBusinessFailure") {
        writeJson(response, { code: 500, msg: "e2e quota business failure" });
        return;
      }
      if (faultMode === "quotaFailure") {
        writeJson(response, { code: 500, msg: "e2e quota transport failure" }, 500);
        return;
      }
      const isTeam = url.searchParams.get("type") === "2";
      const hasPlan = isTeam ? scenario !== "personalOnly" : scenario !== "teamOnly";
      if (!hasPlan) {
        writeJson(response, {
          code: 500,
          success: false,
          msg: "当前用户不存在coding plan",
        });
        return;
      }
      writeJson(response, {
        code: 200,
        data: {
          level: isTeam ? "team" : "pro",
          limits: [
            {
              type: "TOKENS_LIMIT",
              unit: 3,
              number: 5,
              remaining: isTeam ? 900 : 700,
              percentage: isTeam ? 10 : 30,
              nextResetTime: Date.UTC(2026, 6, 4, 10, 0),
            },
            {
              type: "TOKENS_LIMIT",
              unit: 6,
              remaining: isTeam ? 8000 : 6000,
              percentage: isTeam ? 20 : 40,
              nextResetTime: Date.UTC(2026, 6, 10, 0, 0),
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === "/api/monitor/credit-usage/activity") {
      if (faultMode === "optionalActivity") {
        writeJson(response, { code: 500, msg: "e2e optional activity failure" }, 500);
        return;
      }
      writeJson(response, {
        code: 200,
        data: {
          summary: {
            totalTokens: 350720,
            peakDailyTokens: 120000,
            peakDailyTokensDate: "2026-08-16",
            totalUsageDurationMs: 5400000,
            currentStreakDays: 2,
            longestStreakDays: 4,
          },
          series: [
            {
              date: "2026-08-16",
              totalTokens: 350720,
              modelCallCount: 7,
              mcpCalls: 3,
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === "/api/monitor/credit-usage/usage-detail") {
      const isModel = url.searchParams.get("usageType") === "MODEL";
      writeJson(response, {
        code: 200,
        data: isModel
          ? {
              summary: {
                cacheHitRate: { value: 0.893, trend: 0.12 },
                totalCredits: { value: 28.95, trend: -0.2 },
                averageDailyCredits: { value: 4.13, trend: 0 },
              },
              modelUsage: {
                xTime: ["2026-08-16"],
                modelDataList: [
                  {
                    modelName: "glm-credit-e2e",
                    totalTokens: 350720,
                    totalCredits: 28.95,
                    totalCreditsUsage: [28.95],
                    totalTokensUsage: [350720],
                    cachedInputCreditsUsage: [17.68],
                    uncachedInputCreditsUsage: [8.63],
                    outputCreditsUsage: [2.64],
                    cachedInputTokensUsage: [200000],
                    uncachedInputTokensUsage: [100000],
                    outputTokensUsage: [50720],
                    sortOrder: 1,
                  },
                ],
              },
            }
          : {
              summary: {
                cacheHitRate: { value: null },
                totalCredits: { value: 1, trend: 0.5 },
                averageDailyCredits: { value: 0.2, trend: 0.1 },
              },
              mcpUsage: {
                xTime: ["2026-08-16"],
                mcpDataList: [
                  {
                    mcpCode: "e2e-search",
                    mcpName: "E2E Search MCP",
                    creditsUsage: [1],
                    mcpCallCount: [3],
                    totalUsageCount: 3,
                    totalCredits: 1,
                    sortOrder: 1,
                  },
                ],
              },
            },
      });
      return;
    }

    if (url.pathname === "/api/monitor/usage/model-performance-day") {
      writeJson(response, {
        code: 200,
        data: {
          x_time: ["2026-08-16"],
          proMaxDecodeSpeed: [125.4],
          liteDecodeSpeed: [55.2],
        },
      });
      return;
    }

    if (url.pathname === "/api/monitor/usage/model-usage") {
      const isTeam = url.searchParams.get("type") === "2";
      writeJson(response, {
        code: 200,
        data: {
          x_time: ["2026-07-01", "2026-07-02"],
          granularity: "daily",
          totalUsage: {
            totalModelCallCount: 2,
            totalTokensUsage: isTeam ? 3210 : 1230,
          },
          modelDataList: [
            {
              modelName: isTeam ? "glm-team-e2e" : "glm-personal-e2e",
              sortOrder: 1,
              tokensUsage: isTeam ? [1200, 2010] : [500, 730],
              totalTokens: isTeam ? 3210 : 1230,
            },
          ],
          modelSummaryList: [
            {
              modelName: isTeam ? "glm-team-e2e" : "glm-personal-e2e",
              sortOrder: 1,
              totalTokens: isTeam ? 3210 : 1230,
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === "/api/monitor/usage/tool-usage") {
      const isTeam = url.searchParams.get("type") === "2";
      writeJson(response, {
        code: 200,
        data: {
          x_time: ["2026-07-01", "2026-07-02"],
          granularity: "daily",
          toolDataList: [
            {
              toolCode: isTeam ? "team-search" : "personal-search",
              toolName: isTeam ? "Team Search" : "Personal Search",
              sortOrder: 1,
              usageCount: isTeam ? [2, 3] : [1, 1],
              totalUsageCount: isTeam ? 5 : 2,
            },
          ],
          toolSummaryList: [
            {
              toolCode: isTeam ? "team-search" : "personal-search",
              toolName: isTeam ? "Team Search" : "Personal Search",
              sortOrder: 1,
              totalUsageCount: isTeam ? 5 : 2,
            },
          ],
        },
      });
      return;
    }

    writeJson(response, { code: 404, msg: `Unhandled mock path: ${url.pathname}` }, 404);
  });

  await new Promise<void>((resolveStart) => {
    codingPlanTeamMockServer?.listen(0, "127.0.0.1", resolveStart);
  });
  const address = codingPlanTeamMockServer.address() as AddressInfo;
  codingPlanTeamMockBaseUrl = `http://127.0.0.1:${address.port}`;
  applyCodingPlanTeamMockEnv(process.env, codingPlanTeamMockBaseUrl);
}

async function isCodingPlanTeamMockAlive(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/__e2e/coding-plan/team-health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function configureCodingPlanTeamMockForSpecs(specs: string[]) {
  if (!shouldUseCodingPlanTeamMock(specs)) {
    return;
  }
  const baseUrl =
    codingPlanTeamMockBaseUrl || process.env.CF_E2E_CODING_PLAN_MOCK_URL?.trim() || "";
  if (!baseUrl) {
    throw new Error("coding plan mock case mode configuration failed: mock URL not initialized.");
  }
  const mode = isSubagentCodingPlanLoginCatalogStaleSpec(specs)
    ? SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_MODE
    : isModelProviderPlanSurfaceSpec(specs)
      ? "model-provider-plan-surface"
      : "default";
  const response = await fetch(`${baseUrl}/__e2e/coding-plan/case-mode`, {
    body: JSON.stringify({ mode }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) {
    throw new Error(`coding plan mock case mode ConfigurationFailed：status=${response.status} mode=${mode}`);
  }
}

async function stopCodingPlanTeamMock() {
  if (codingPlanTeamMockServer) {
    await new Promise<void>((resolveStop) => {
      codingPlanTeamMockServer?.close(() => resolveStop());
    });
    codingPlanTeamMockServer = null;
  }
  if (codingPlanDataPlaneProxy) {
    await codingPlanDataPlaneProxy.stop();
    codingPlanDataPlaneProxy = null;
  }
  const ownedBaseUrl =
    codingPlanTeamMockBaseUrl || process.env[CODING_PLAN_TEAM_MOCK_BASE_URL_ENV]?.trim() || "";
  codingPlanTeamMockBaseUrl = "";
  if (!ownedBaseUrl) {
    return;
  }
  clearCodingPlanTeamMockEnv(process.env, ownedBaseUrl);
}

const HIGHSPEED_DATA_PLANE_FIXTURE_PATHS = [
  "test/e2e/fixtures/upstream/conversation-session/conversation-session-highspeed-card.json",
  "test/e2e/fixtures/upstream/conversation-session/conversation-session-highspeed-card-draw-timeout.json",
  "test/e2e/fixtures/upstream/conversation-session/conversation-session-highspeed-card-draw-miss.json",
  "test/e2e/fixtures/upstream/conversation-session/conversation-session-highspeed-card-fallback-unlocks-model.json",
];

interface DataPlaneTurnFixture {
  match: { lastUserMessageIncludes: string[] };
  response: { body: string };
}

async function readDataPlaneTurnFixtures(path: string): Promise<DataPlaneTurnFixture[]> {
  return (
    JSON.parse(await readFile(resolve(DESKTOP_DIR, path), "utf8")) as {
      fixtures: DataPlaneTurnFixture[];
    }
  ).fixtures;
}

function createDataPlaneTurnResponder(
  fixtures: readonly DataPlaneTurnFixture[],
  options: { fallbackBody: string; title: { id: string; text: string } },
) {
  return (requestBody: string) => {
    const request = JSON.parse(requestBody) as {
      stream?: boolean;
      messages?: Array<{ role: string; content: unknown }>;
    };
    if (request.stream !== true)
      return JSON.stringify({
        id: options.title.id,
        type: "message",
        role: "assistant",
        model: "GLM-5.2",
        content: [{ type: "text", text: options.title.text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 4 },
      });
    const messages = request.messages ?? [];
    const lastUser = JSON.stringify(
      messages.findLast((message) => message.role === "user")?.content,
    );
    return (
      fixtures.find((fixture) =>
        fixture.match.lastUserMessageIncludes.every((marker) => lastUser?.includes(marker)),
      )?.response.body ?? options.fallbackBody
    );
  };
}

async function startCodingPlanDataPlaneProxy(specs: readonly string[]) {
  if (!shouldPrepareCodingPlanTeamMock(specs)) return;
  if (specs.some((spec) => spec.includes("conversation-session-toolsearch"))) return;
  if (codingPlanDataPlaneProxy) {
    for (const [key, value] of Object.entries(codingPlanDataPlaneProxy.env)) {
      process.env[key] = value;
    }
    return;
  }
  const modelResponseBody = specs.some((spec) =>
    spec.includes("conversation-session-model-provider-effective-selection.test.ts"),
  )
    ? (
        JSON.parse(
          await readFile(
            resolve(
              DESKTOP_DIR,
              "test/e2e/fixtures/upstream/conversation-session/conversation-session-model-provider-effective-selection.json",
            ),
            "utf8",
          ),
        ) as {
          fixtures: Array<{ response: { body: string } }>;
        }
      ).fixtures[0]!.response.body
    : CODING_PLAN_MODEL_SSE_BODY;
  const startIndependentFixtures = specs.some((spec) =>
    spec.includes("conversation-session-start-plan-independent.test.ts"),
  )
    ? await readDataPlaneTurnFixtures(
        "test/e2e/fixtures/upstream/conversation-session/conversation-session-start-plan-independent.json",
      )
    : null;
  const highspeedFixtures = specs.some((spec) =>
    spec.includes("conversation-session-highspeed-card"),
  )
    ? (
        await Promise.all(
          HIGHSPEED_DATA_PLANE_FIXTURE_PATHS.map((path) => readDataPlaneTurnFixtures(path)),
        )
      ).flat()
    : null;
  codingPlanDataPlaneProxy = await startE2ENetworkCaptureProxy({
    artifactPath: CODING_PLAN_DATA_PLANE_ARTIFACT_PATH,
    caDir: E2E_CODING_PLAN_DATA_PLANE_CA_DIR,
    responseMocks: [
      {
        host: "open.bigmodel.cn",
        method: "POST",
        path: "/api/paas/c1f3a7e2/v2/client",
        body: JSON.stringify({ code: 500, msg: "E2E handshake unavailable" }),
      },
      ...(startIndependentFixtures
        ? [
            {
              host: "start154-e2e.invalid",
              method: "POST",
              path: "/v1/messages",
              headers: { "content-type": "text/event-stream; charset=utf-8" },
              body: createDataPlaneTurnResponder(startIndependentFixtures, {
                fallbackBody: CODING_PLAN_MODEL_SSE_BODY,
                title: { id: "start154-title", text: "Start154 checks" },
              }),
            },
          ]
        : []),
      {
        body: highspeedFixtures
          ? createDataPlaneTurnResponder(highspeedFixtures, {
              fallbackBody: modelResponseBody,
              title: { id: "highspeed-title", text: '{"title":"Highspeed draw"}' },
            })
          : modelResponseBody,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
        host: "open.bigmodel.cn",
        method: "POST",
        path: "/api/anthropic/v1/messages",
      },
    ],
  });
  for (const [key, value] of Object.entries(codingPlanDataPlaneProxy.env)) {
    process.env[key] = value;
  }
}

async function readRequestJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolveRead) => {
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveRead());
  });
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  return (raw ? JSON.parse(raw) : {}) as T;
}

function writeJson(response: ServerResponse, payload: unknown, statusCode = 200) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function startUpstreamCaptureProxy(specs: readonly string[]) {
  const toolSearchFixture = specs.some((spec) => spec.includes("conversation-session-toolsearch"));
  if (!toolSearchFixture) assertUpstreamCaptureConfig();
  const toolSearchSpec = specs.find((spec) => spec.includes("conversation-session-toolsearch"));
  const toolSearchResponses = toolSearchSpec
    ? await loadToolSearchResponses(
        toolSearchSpec
          .replaceAll("\\", "/")
          .split("/")
          .at(-1)!
          .replace(/\.test\.ts$/, ""),
      )
    : undefined;
  const apiKey = toolSearchFixture ? E2E_PROVIDER_REPLAY_API_KEY : readE2EProviderApiKey();
  const responseMocks = requestSecurityCaptureMocks(process.env, e2eProviderPresetName);
  upstreamCaptureProxy = await startE2ENetworkCaptureProxy({
    artifactPath: UPSTREAM_CAPTURE_ARTIFACT_PATH,
    caDir: E2E_NETWORK_CAPTURE_CA_DIR,
    recordResponseChunkTimeline: true,
    responseChunkTimelineLimitBytes: UPSTREAM_CAPTURE_RESPONSE_CHUNK_TIMELINE_BYTES,
    responsePreviewLimitBytes: UPSTREAM_CAPTURE_RESPONSE_PREVIEW_BYTES,
    responseMocks: toolSearchFixture
      ? [
          ...(responseMocks ?? []),
          {
            host: "open.bigmodel.cn",
            method: "POST",
            path: "/api/paas/c1f3a7e2/v2/client",
            body: JSON.stringify({ code: 500, msg: "E2E handshake unavailable" }),
          },
          {
            body: (body) =>
              toolSearchResponses!.get(
                toolSearchResponseStage(JSON.parse(body) as ToolSearchRequest),
              ).response.body,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
            host: "open.bigmodel.cn",
            method: "POST",
            path: "/api/anthropic/v1/messages",
          },
        ]
      : responseMocks,
  });
  process.env.E2E_PROVIDER_API_KEY = apiKey;
  upstreamE2EBaseUrl = e2eProviderPreset.baseUrl;

  for (const [key, value] of Object.entries(upstreamCaptureProxy.env)) {
    process.env[key] = value;
  }
  process.env.E2E_PROVIDER_CAPTURE_MODE = "capture";
  process.env.E2E_PROVIDER_CAPTURE_PATH = upstreamCaptureProxy.artifactPath;
  process.env.E2E_PROVIDER_CAPTURE_PROXY_URL = upstreamCaptureProxy.proxyUrl;
  process.env.E2E_PROVIDER_EXPECTED_HOST = e2eProviderPreset.expectedHost;
  process.env.E2E_PROVIDER_EXPECTED_PROTOCOL = e2eProviderPreset.expectedProtocol;
  process.env.E2E_PROVIDER_RUNTIME_BASE_URL = e2eProviderPreset.baseUrl;
  recordRequestSecurityCaptureMode(process.env, Boolean(responseMocks));
  writeUpstreamE2ERuntimeFile("capture", e2eProviderPreset.baseUrl);
}

function writeUpstreamE2ERuntimeFile(mode: "capture" | "replay", baseUrl: string) {
  mkdirSync(E2E_NETWORK_CAPTURE_DIR, { recursive: true });
  writeFileSync(
    E2E_PROVIDER_RUNTIME_FILE,
    JSON.stringify(
      {
        artifactPath: process.env.E2E_PROVIDER_CAPTURE_PATH ?? "",
        baseUrl,
        mode,
      },
      null,
      2,
    ),
  );
}

async function stopUpstreamE2EHttp() {
  if (!upstreamCaptureProxy) {
    if (upstreamReplayServer) {
      await upstreamReplayServer.stop();
      upstreamReplayServer = null;
    }
    return;
  }
  await upstreamCaptureProxy.stop();
  upstreamCaptureProxy = null;
  if (upstreamReplayServer) {
    await upstreamReplayServer.stop();
    upstreamReplayServer = null;
  }
}

async function startCodingPlanUpgradeE2EMock(
  specs: string[] = [],
  options: { prepareForBuild?: boolean } = {},
) {
  const resolvedScenario = resolveCodingPlanUpgradeMockScenario(specs);
  const scenario =
    resolvedScenario ??
    (options.prepareForBuild && shouldPrepareCodingPlanUpgradeMockForBuild(specs)
      ? "webview-refresh-provider"
      : null);
  if (!scenario) {
    await stopCodingPlanUpgradeE2EMock();
    return;
  }
  const preparedBaseUrl = process.env[CODING_PLAN_UPGRADE_MOCK_BASE_URL_ENV]?.trim();
  const mockOptions = { marketingTouch: specs.some((spec) => spec.includes("marketing-touch-")) };
  if (!codingPlanUpgradeMockServer && preparedBaseUrl) {
    await resetCodingPlanUpgradeMockServer(preparedBaseUrl, scenario, mockOptions);
    applyCodingPlanUpgradeMockEnv(process.env, preparedBaseUrl);
    return;
  }
  if (codingPlanUpgradeMockServer) {
    await resetCodingPlanUpgradeMockServer(
      codingPlanUpgradeMockServer.baseUrl,
      scenario,
      mockOptions,
    );
    applyCodingPlanUpgradeMockEnv(process.env, codingPlanUpgradeMockServer.baseUrl);
    return;
  }
  codingPlanUpgradeMockServer = await startCodingPlanUpgradeMockServer(scenario, mockOptions);
  process.env[CODING_PLAN_UPGRADE_MOCK_BASE_URL_ENV] = codingPlanUpgradeMockServer.baseUrl;
  applyCodingPlanUpgradeMockEnv(process.env, codingPlanUpgradeMockServer.baseUrl);
}

async function startOffPeakE2EMock(specs: string[] = []): Promise<void> {
  const isOffPeakSpec = specs.some((spec) => spec.includes("off-peak") || spec.includes("offpeak"));
  if (isOffPeakSpec) {
    process.env.CF_OFFPEAK_MOCK = "1";
    process.env.CF_OFFPEAK_MOCK_PORT = "45197";
    const isSubagentInheritanceSpec = isOffPeakSubagentModelInheritanceSpec(specs);
    const isInvalidTicketSpec = isOffPeakInvalidTicketSpec(specs);
    process.env.CF_OFFPEAK_MOCK_READY_DELAY_MS =
      isSubagentInheritanceSpec || isInvalidTicketSpec ? "0" : "60000";
    process.env.CF_OFFPEAK_MOCK_READY_TTL_MS = "600000";
    process.env.CF_OFFPEAK_MOCK_ACTIVE_MS = "600000";
    process.env.CF_OFFPEAK_MOCK_NEXT_POLL_S = "1";
    if (isSubagentInheritanceSpec) {
      process.env.CF_OFFPEAK_MOCK_SCENARIO = "foreground-subagents";
    } else if (isInvalidTicketSpec) {
      process.env.CF_OFFPEAK_MOCK_SCENARIO = "invalid-ticket";
    } else if (
      specs.some((spec) =>
        spec.includes("conversation-session-offpeak-create-existing-session.test.ts"),
      )
    ) {
      process.env.CF_OFFPEAK_MOCK_SCENARIO = "foreground-subagents";
    } else {
      delete process.env.CF_OFFPEAK_MOCK_SCENARIO;
    }
    const isLimitPreGateSpec = specs.some((spec) => spec.includes("off-peak-limit-pre-gate"));
    if (isLimitPreGateSpec) {
      process.env.CF_OFFPEAK_MOCK_AVAILABILITY_BLOCK_MS = "3600000";
    } else {
      delete process.env.CF_OFFPEAK_MOCK_AVAILABILITY_BLOCK_MS;
    }
    await materializeOffPeakMockCfBuiltinProviderConfig(
      Number(process.env.CF_OFFPEAK_MOCK_PORT),
      isSubagentInheritanceSpec ? "GLM-5.3" : "GLM-5.2",
    );
    process.env.CF_BUILTIN_PROVIDER_CONFIG_FILE = E2E_OFFPEAK_CF_BUILTIN_PROVIDER_CONFIG_FILE;
  } else {
    delete process.env.CF_OFFPEAK_MOCK;
    delete process.env.CF_OFFPEAK_MOCK_AVAILABILITY_BLOCK_MS;
    delete process.env.CF_OFFPEAK_MOCK_PORT;
    delete process.env.CF_OFFPEAK_MOCK_SCENARIO;
    if (INITIAL_CF_BUILTIN_PROVIDER_CONFIG_FILE) {
      process.env.CF_BUILTIN_PROVIDER_CONFIG_FILE = INITIAL_CF_BUILTIN_PROVIDER_CONFIG_FILE;
    } else {
      delete process.env.CF_BUILTIN_PROVIDER_CONFIG_FILE;
    }
  }
}

async function materializeOffPeakMockCfBuiltinProviderConfig(
  port: number,
  modelId: string,
): Promise<void> {
  const sourcePath = resolve(REPO_ROOT, "config/provider/cf-builtin.json");
  const document = JSON.parse(await readFile(sourcePath, "utf8")) as {
    config?: {
      providerConfigRules?: {
        providerRules?: Array<{
          providerId: string;
          config: { api?: { baseUrl?: string }; builtinModelIds?: string[] };
        }>;
      };
    };
  };
  const offPeakProviderIds = [
    "account:zai-offpeak-idle-plan",
    "account:bigmodel-offpeak-idle-plan",
  ];
  for (const providerId of offPeakProviderIds) {
    const offPeakProvider = document.config?.providerConfigRules?.providerRules?.find(
      (rule) => rule.providerId === providerId,
    )?.config;
    if (!offPeakProvider?.api) {
      throw new Error(`CodeFusion Built-in Config Missing ${providerId}.api`);
    }
    offPeakProvider.api.baseUrl = `http://127.0.0.1:${port}/api/v1/off-peak/anthropic`;
    offPeakProvider.builtinModelIds = [modelId];
  }
  await mkdir(resolve(E2E_OFFPEAK_CF_BUILTIN_PROVIDER_CONFIG_FILE, ".."), {
    recursive: true,
  });
  await writeFile(
    E2E_OFFPEAK_CF_BUILTIN_PROVIDER_CONFIG_FILE,
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
}

function configureHighspeedE2EMock(specs: string[] = []): void {
  const scenario = resolveHighspeedE2EMockScenario(specs);
  if (scenario) {
    process.env[HIGHSPEED_MOCK_SCENARIO_ENV] = scenario;
  } else {
    delete process.env[HIGHSPEED_MOCK_SCENARIO_ENV];
  }
}

async function stopCodingPlanUpgradeE2EMock() {
  const ownedBaseUrl =
    codingPlanUpgradeMockServer?.baseUrl ??
    process.env[CODING_PLAN_UPGRADE_MOCK_BASE_URL_ENV]?.trim() ??
    "";
  if (!codingPlanUpgradeMockServer) {
    if (ownedBaseUrl) {
      clearCodingPlanUpgradeMockEnv(process.env, ownedBaseUrl);
    }
    restoreE2EProviderEndpointEnv();
    return;
  }
  await codingPlanUpgradeMockServer.stop();
  codingPlanUpgradeMockServer = null;
  clearCodingPlanUpgradeMockEnv(process.env, ownedBaseUrl);
  restoreE2EProviderEndpointEnv();
}

function restoreE2EProviderEndpointEnv() {
  const endpointEnv = getE2EProviderEndpointEnv(
    configuredE2ESpecs,
    e2eProviderPresetName,
    upstreamE2EHttpMode,
  );
  if (Object.keys(endpointEnv).length > 0) {
    Object.assign(process.env, endpointEnv);
    return;
  }
  restoreRequestSecurityEndpointEnv(process.env, e2eProviderPresetName, upstreamE2EHttpMode);
}

async function startModelContextBudgetConfigE2EMock(specs: string[] = []) {
  const scenario = resolveModelContextBudgetConfigMockScenario(specs);
  if (!scenario) {
    await stopModelContextBudgetConfigE2EMock();
    return;
  }
  if (modelContextBudgetConfigMockServer?.scenario !== scenario) {
    await stopModelContextBudgetConfigE2EMock();
    modelContextBudgetConfigMockServer = await startModelContextBudgetConfigMockServer(scenario);
  }
  process.env.CF_BASE_URL = modelContextBudgetConfigMockServer.baseUrl;
  process.env.CF_TEST_BASE_URL = modelContextBudgetConfigMockServer.baseUrl;
  process.env.CF_ENDPOINT_ORIGIN = modelContextBudgetConfigMockServer.baseUrl;
}

async function stopModelContextBudgetConfigE2EMock() {
  if (!modelContextBudgetConfigMockServer) {
    return;
  }
  await modelContextBudgetConfigMockServer.stop();
  modelContextBudgetConfigMockServer = null;
  delete process.env.CF_BASE_URL;
  delete process.env.CF_TEST_BASE_URL;
  delete process.env.CF_ENDPOINT_ORIGIN;
}

async function startDynamicWorkflowConfigE2EMock(specs: string[] = []) {
  const scenario = resolveDynamicWorkflowConfigMockScenario(specs);
  if (!scenario) {
    await stopDynamicWorkflowConfigE2EMock();
    return;
  }
  if (dynamicWorkflowConfigMockServer?.scenario !== scenario) {
    await stopDynamicWorkflowConfigE2EMock();
    dynamicWorkflowConfigMockServer = await startDynamicWorkflowConfigMockServer(scenario);
  }
  applyDynamicWorkflowConfigMockEnv(process.env, dynamicWorkflowConfigMockServer.baseUrl);
}

async function stopDynamicWorkflowConfigE2EMock() {
  if (!dynamicWorkflowConfigMockServer) {
    return;
  }
  const baseUrl = dynamicWorkflowConfigMockServer.baseUrl;
  await dynamicWorkflowConfigMockServer.stop();
  dynamicWorkflowConfigMockServer = null;
  clearDynamicWorkflowConfigMockEnv(process.env, baseUrl);
}

async function startClientScenesE2EMockIfNeeded(specs: string[] = []) {
  if (!shouldUseClientScenesMock(specs)) {
    await stopClientScenesE2EMock();
    return;
  }
  clientScenesMockServer ??= await startClientScenesMockServer();
  applyClientScenesMockEnv(process.env, clientScenesMockServer.baseUrl);
}

async function stopClientScenesE2EMock() {
  if (!clientScenesMockServer) {
    return;
  }
  const baseUrl = clientScenesMockServer.baseUrl;
  await clientScenesMockServer.stop();
  clientScenesMockServer = null;
  clearClientScenesMockEnv(process.env, baseUrl);
}

async function startPluginCdnZipFixtureIfNeeded(specs: string[] = []) {
  if (!shouldUsePluginCdnZipMarketplaceFixture(specs)) {
    return;
  }
  pluginCdnZipFixtureServer ??= await startPluginCdnZipFixtureServer();
}

async function stopPluginCdnZipFixture() {
  await stopPluginCdnZipFixtureServer(pluginCdnZipFixtureServer ?? undefined);
  pluginCdnZipFixtureServer = null;
}

async function armCurrentElectronAppQuit(stage: string) {
  currentE2EElectronAppPid = null;
  try {
    const result = (await browser.electron.execute((electron) => {
      const currentAppPid = process.pid;
      const appName = electron.app.getName();
      if (appName !== "CodeFusion E2E") {
        return {
          appName,
          appPid: currentAppPid,
          armedWindowCount: 0,
        };
      }

      const appWindows = electron.BrowserWindow.getAllWindows();
      let quitRequested = false;
      const requestQuitAfterDriverClose = () => {
        if (quitRequested || electron.BrowserWindow.getAllWindows().length > 0) {
          return;
        }
        quitRequested = true;
        electron.app.quit();
      };

      for (const appWindow of appWindows) {
        appWindow.once("closed", requestQuitAfterDriverClose);
      }
      return {
        appName,
        appPid: currentAppPid,
        armedWindowCount: appWindows.length,
      };
    })) as {
      appName?: string;
      appPid?: number;
      armedWindowCount?: number;
    };

    currentE2EElectronAppPid = typeof result.appPid === "number" ? result.appPid : null;
    if (!result.armedWindowCount) {
      writeE2ECleanupWarning(
        `${stage}: skip app quit barrier because current Electron app is ${result.appName ?? "unknown"} or has no windows`,
      );
      return;
    }
  } catch (error) {
    writeE2ECleanupWarning(`${stage}: app quit barrier failed: ${formatErrorMessage(error)}`);
  }
}

async function cleanupE2EElectronProcesses(
  stage: string,
  {
    requireExit = false,
    waitForGracefulExit = false,
  }: { requireExit?: boolean; waitForGracefulExit?: boolean } = {},
) {
  try {
    let targetPids =
      currentE2EElectronAppPid !== null && isProcessAlive(currentE2EElectronAppPid)
        ? [currentE2EElectronAppPid]
        : listCurrentE2EProcessPids();
    if (waitForGracefulExit && targetPids.length > 0) {
      await waitForProcessesExit(targetPids, E2E_ELECTRON_APP_QUIT_TIMEOUT_MS);
      targetPids = targetPids.filter((pid) => isProcessAlive(pid));
      if (targetPids.length === 0) {
        targetPids = listCurrentE2EProcessPids();
      }
    }
    if (targetPids.length === 0) {
      return;
    }

    writeE2ECleanupWarning(
      `${stage}: force terminating leftover Electron e2e pids=${targetPids.join(",")}`,
    );
    if (process.platform === "win32") {
      forceTerminateWindowsProcesses(targetPids);
      await waitForProcessesExit(targetPids, E2E_ELECTRON_FORCE_KILL_GRACE_MS);
    } else {
      terminatePosixProcesses(targetPids, "SIGTERM");
      await waitForProcessesExit(targetPids, E2E_ELECTRON_FORCE_KILL_GRACE_MS);
      const remainingAfterTerm = targetPids.filter((pid) => isProcessAlive(pid));
      terminatePosixProcesses(remainingAfterTerm, "SIGKILL");
      await waitForProcessesExit(remainingAfterTerm, E2E_ELECTRON_FORCE_KILL_GRACE_MS);
    }

    const remainingPids = listCurrentE2EProcessPids();
    if (remainingPids.length > 0) {
      throw new Error(`E2E process exit barrier failed, remaining pids=${remainingPids.join(",")}`);
    }
  } catch (error) {
    writeE2ECleanupWarning(
      `${stage}: leftover Electron cleanup failed: ${formatErrorMessage(error)}`,
    );
    if (requireExit) {
      throw error;
    }
  }
}

function listCurrentE2EProcessPids() {
  const detectedPids = listE2EProcessTreePids({
    chromiumProfileRootDir: E2E_CHROMIUM_USER_DATA_ROOT_DIR,
    homeDir: E2E_HOME_DIR,
    runId: E2E_RUN_ID,
  });
  if (
    currentE2EElectronAppPid !== null &&
    currentE2EElectronAppPid !== process.pid &&
    isProcessAlive(currentE2EElectronAppPid)
  ) {
    detectedPids.push(currentE2EElectronAppPid);
  }
  return [...new Set(detectedPids)];
}

async function cleanupE2EDirectory(stage: string, userDataDir: string, requireRemoved = false) {
  try {
    await rm(userDataDir, {
      force: true,
      maxRetries: process.platform === "win32" ? 3 : 1,
      recursive: true,
      retryDelay: 300,
    });
    if (existsSync(userDataDir)) {
      throw new Error(`E2E directory still exists: ${userDataDir}`);
    }
  } catch (error) {
    writeE2ECleanupWarning(
      `${stage}: E2E directory cleanup failed (${userDataDir}): ${formatErrorMessage(error)}`,
    );
    if (requireRemoved) {
      throw error;
    }
  }
}

function forceTerminateWindowsProcesses(pids: number[]) {
  if (pids.length === 0) {
    return;
  }
  try {
    execFileSync("taskkill", buildWindowsTaskkillArgs(pids), {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    const alivePids = pids.filter((pid) => isProcessAlive(pid));
    if (alivePids.length > 0) {
      writeE2ECleanupWarning(
        `taskkill failed for pids=${alivePids.join(",")}: ${formatErrorMessage(error)}`,
      );
    }
  }
}

function terminatePosixProcesses(pids: number[], signal: NodeJS.Signals) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (isProcessAliveError(error)) {
        writeE2ECleanupWarning(`${signal} failed for pid=${pid}: ${formatErrorMessage(error)}`);
      }
    }
  }
}

async function waitForProcessesExit(pids: number[], timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (pids.every((pid) => !isProcessAlive(pid))) {
      return true;
    }
    await delay(100);
  }
  return pids.every((pid) => !isProcessAlive(pid));
}

async function runE2ERendererBridgePreflight(specs: string[] = []) {
  const attempt = await waitForE2ERendererBridgePreflight();
  if (!attempt.error) {
    return;
  }

  throw createE2ERendererBridgePreflightError(attempt.latest, specs, attempt.error, false);
}

async function waitForE2ERendererBridgePreflight(): Promise<{
  error: unknown | null;
  latest: E2ERendererBridgePreflightResult | null;
}> {
  let latest: E2ERendererBridgePreflightResult | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await inspectE2ERendererBridgePreflight();
        return latest.ok;
      },
      {
        interval: 250,
        timeout: E2E_RENDERER_BRIDGE_PREFLIGHT_TIMEOUT_MS,
        timeoutMsg: "E2E renderer bridge preflight timed out",
      },
    );
    return { error: null, latest };
  } catch (error) {
    return { error, latest: latest as E2ERendererBridgePreflightResult | null };
  }
}

function createE2ERendererBridgePreflightError(
  lastResult: E2ERendererBridgePreflightResult | null,
  specs: string[],
  cause: unknown,
  recoveryAttempted: boolean,
): Error {
  return new Error(
    [
      "e2e-bridge-preflight infra failure",
      `reason=${lastResult?.reason ?? "unknown"}`,
      `url=${lastResult?.url ?? "unknown"}`,
      `readyState=${lastResult?.documentReadyState ?? "unknown"}`,
      `currentHandle=${lastResult?.currentHandle ?? "unknown"}`,
      `handles=${JSON.stringify(lastResult?.handles ?? [])}`,
      `candidateHandles=${JSON.stringify(lastResult?.candidateHandles ?? [])}`,
      `targets=${JSON.stringify(lastResult?.targets ?? [])}`,
      `missingBridgeMethods=${JSON.stringify(lastResult?.missingBridgeMethods ?? [])}`,
      `missingStateMethods=${JSON.stringify(lastResult?.missingStateMethods ?? [])}`,
      `recoveryAttempted=${recoveryAttempted}`,
      `specs=${JSON.stringify(specs)}`,
      `cause=${formatErrorMessage(cause)}`,
    ].join("; "),
  );
}

async function inspectE2ERendererBridgePreflight(): Promise<E2ERendererBridgePreflightResult> {
  const handles = await browser.getWindowHandles();
  const targets = await getE2EBrowserTargetInfo().catch(() => []);
  const candidates = collectE2EWebDriverPageHandleCandidates(handles, targets);
  const fallback: E2ERendererBridgePreflightResult = {
    bridgeMethods: {},
    candidateHandles: candidates.map((candidate) => candidate.handle),
    currentHandle: await browser.getWindowHandle().catch(() => null),
    documentReadyState: null,
    handle: null,
    handles,
    hasSessionBridge: false,
    missingBridgeMethods: E2E_RENDERER_BRIDGE_REQUIRED_BRIDGE_METHODS,
    missingStateMethods: E2E_RENDERER_BRIDGE_REQUIRED_STATE_METHODS,
    ok: false,
    reason:
      handles.length === 0
        ? "renderer-handle-missing"
        : candidates.length === 0
          ? "renderer-page-handle-intersection-missing"
          : "renderer-url-missing",
    stateMethods: {},
    targets,
    url: null,
  };

  let latest = fallback;
  for (const candidate of candidates) {
    const handle = candidate.handle;
    try {
      await browser.switchToWindow(handle);
      const currentHandle = await browser.getWindowHandle().catch(() => null);
      if (currentHandle !== handle) {
        latest = {
          ...fallback,
          currentHandle,
          handle,
          reason: "renderer-handle-switch-mismatch",
        };
        continue;
      }
      const result = (await browser.execute(
        (requiredBridgeMethods, requiredStateMethods) => {
          const bridge = (
            window as typeof window & {
              __cfSessionStoreE2E?: Record<string, unknown> & {
                getState?: () => Record<string, unknown>;
                setState?: (...args: unknown[]) => unknown;
                subscribe?: (...args: unknown[]) => unknown;
              };
            }
          ).__cfSessionStoreE2E;
          const bridgeMethods = Object.fromEntries(
            requiredBridgeMethods.map((method) => [method, typeof bridge?.[method] === "function"]),
          ) as Record<string, boolean>;
          const missingBridgeMethods = requiredBridgeMethods.filter(
            (method) => !bridgeMethods[method],
          );
          const state =
            typeof bridge?.getState === "function"
              ? (() => {
                  try {
                    return bridge.getState?.() ?? null;
                  } catch {
                    return null;
                  }
                })()
              : null;
          const stateMethods = Object.fromEntries(
            requiredStateMethods.map((method) => [
              method,
              Boolean(state && typeof state[method] === "function"),
            ]),
          ) as Record<string, boolean>;
          const missingStateMethods = requiredStateMethods.filter(
            (method) => !stateMethods[method],
          );
          const url = window.location.href;
          const isRendererUrl = url.includes("/renderer/index.html");
          const hasSessionBridge = Boolean(bridge);
          const ok =
            isRendererUrl &&
            hasSessionBridge &&
            missingBridgeMethods.length === 0 &&
            missingStateMethods.length === 0;
          const reason = !isRendererUrl
            ? "renderer-url-missing"
            : !hasSessionBridge
              ? "session-bridge-missing"
              : missingBridgeMethods.length > 0
                ? "session-bridge-method-missing"
                : missingStateMethods.length > 0
                  ? "session-state-method-missing"
                  : "ok";

          return {
            bridgeMethods,
            documentReadyState: document.readyState,
            hasSessionBridge,
            missingBridgeMethods,
            missingStateMethods,
            ok,
            reason,
            stateMethods,
            url,
          };
        },
        E2E_RENDERER_BRIDGE_REQUIRED_BRIDGE_METHODS,
        E2E_RENDERER_BRIDGE_REQUIRED_STATE_METHODS,
      )) as Omit<
        E2ERendererBridgePreflightResult,
        "candidateHandles" | "currentHandle" | "handle" | "handles" | "targets"
      >;
      latest = {
        ...result,
        candidateHandles: fallback.candidateHandles,
        currentHandle,
        handle,
        handles,
        targets,
      };
      if (latest.ok || latest.url?.includes("/renderer/index.html")) {
        (
          browser.electron as typeof browser.electron & {
            windowHandle?: string;
          }
        ).windowHandle = handle;
        return latest;
      }
    } catch (error) {
      latest = {
        ...fallback,
        handle,
        reason: `renderer-preflight-execute-failed:${formatErrorMessage(error)}`,
      };
    }
  }

  return latest;
}

async function getE2EBrowserTargetInfo(): Promise<E2EBrowserTargetInfo[]> {
  const puppeteer = await browser.getPuppeteer();
  return puppeteer.targets().map((target) => ({
    id: (target as unknown as { _targetId?: string })._targetId ?? null,
    type: target.type(),
    url: target.url(),
  }));
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isProcessAliveError(error);
  }
}

function isProcessAliveError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code !== "ESRCH",
  );
}

function delay(ms: number) {
  return new Promise<void>((resolveDelay) => {
    const timer = setTimeout(resolveDelay, Math.max(ms, 0));
    timer.unref?.();
  });
}

function writeE2ECleanupWarning(message: string) {
  process.stderr.write(`[desktop-e2e-cleanup] ${message}\n`);
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function armE2ERunnerExitWatchdog(exitCode: number) {
  if (e2eRunnerExitWatchdog) {
    clearTimeout(e2eRunnerExitWatchdog);
  }

  e2eRunnerExitWatchdog = setTimeout(() => {
    writeE2ECleanupWarning(
      `onComplete: forcing WDIO runner exit after ${E2E_RUNNER_FORCE_EXIT_TIMEOUT_MS}ms`,
    );
    process.exit(exitCode);
  }, E2E_RUNNER_FORCE_EXIT_TIMEOUT_MS);
  e2eRunnerExitWatchdog.unref?.();
}

function forceFinalizeE2ERunnerFromGuard() {
  writeE2ECleanupWarning(
    `finalization guard: onComplete did not start within ${E2E_RUNNER_FINALIZATION_GUARD_TIMEOUT_MS}ms`,
  );
  try {
    e2eReporter.writeSummary(1);
  } catch (error) {
    writeE2ECleanupWarning(
      `finalization guard: summary recovery failed: ${formatErrorMessage(error)}`,
    );
  }
  armE2ERunnerExitWatchdog(1);

  const cleanupKeepAlive = setInterval(() => {}, 1000);
  void (async () => {
    try {
      await stopUpstreamE2EHttp();
      await stopCodingPlanTeamMock();
      await stopCodingPlanUpgradeE2EMock();
      await stopRequestSecurityFixture();
      await stopModelContextBudgetConfigE2EMock();
      await stopDynamicWorkflowConfigE2EMock();
      await stopPluginCdnZipFixture();
      await cleanupE2EElectronProcesses("finalization-guard");
      if (process.env.CF_E2E_KEEP_HOME_ON_FAIL === "1") {
        console.warn(`[e2e] finalization guard keeping failure home: ${E2E_HOME_DIR}`);
      } else {
        await cleanupE2EDirectory("finalization-guard-home", E2E_HOME_DIR);
      }
      await cleanupE2EDirectory("finalization-guard-cache", E2E_RUN_CACHE_DIR);
    } catch (error) {
      writeE2ECleanupWarning(
        `finalization guard: emergency cleanup failed: ${formatErrorMessage(error)}`,
      );
    } finally {
      clearInterval(cleanupKeepAlive);
      process.exit(1);
    }
  })();
}

async function resetE2EHome(specs: string[] = []) {
  await removeE2EHomeWithRetry();
  mkdirSync(E2E_HOME_DIR, { recursive: true });
  seedE2EStartupState(specs);
  await seedRemoteOnboardingFixture({
    enabled:
      process.env.CF_E2E_REMOTE_PROFILE === "1" ||
      specs.some((spec) => spec.endsWith("ui-shell/marketing-touch-delivery.test.ts")),
    specs,
    appConfigDir: E2E_APP_CONFIG_DIR,
    userId: E2E_USER_PROFILE.id,
  });
  if (workerSpecsContain(specs, PROJECT_UPGRADE_ORDER_SPEC)) {
    await seedProjectUpgradeOrderFixture(E2E_HOME_DIR, E2E_APP_SETTINGS_FILE);
  }
  if (usesProviderReadinessColdStartFixture(specs) || usesGitReviewEntryFixture(specs)) {
    await seedProviderReadinessHistoryFixture({
      cliEntryPoint: CF_CLI_ENTRYPOINT,
      e2eHomeDir: E2E_HOME_DIR,
      workspacePath: resolve(E2E_HOME_DIR, "CfProject"),
    });
  }
  if (usesTaskIndexRowAuthorityFixture(specs)) {
    await seedTaskIndexRowAuthorityFixture({
      cliEntryPoint: CF_CLI_ENTRYPOINT,
      e2eHomeDir: E2E_HOME_DIR,
      workspacePath: resolve(E2E_HOME_DIR, "CfProject"),
    });
  }
  if (specs.some((spec) => spec.includes(TASK_TITLE_MARQUEE_SPEC))) {
    await seedTaskTitleMarqueeFixture({
      cliEntryPoint: CF_CLI_ENTRYPOINT,
      e2eHomeDir: E2E_HOME_DIR,
      workspacePath: resolve(E2E_HOME_DIR, "CfProject"),
    });
  }
  if (specs.some((spec) => spec.includes("usage-stats-app-usage.test.ts"))) {
    await seedAppUsageE2EFixture({
      cliEntryPoint: CF_CLI_ENTRYPOINT,
      e2eHomeDir: E2E_HOME_DIR,
      workspacePath: resolve(E2E_HOME_DIR, "CfProject"),
    });
  }
  seedE2EWorkerModelStreamConfig(specs);
  await seedE2EModelConfig(specs);
  seedE2EPluginCdnZipMarketplace(specs);
  seedE2EPluginMcpSkillInstalledPlugins(specs);
  seedE2EPluginMcpSkillState(specs);
  seedE2EWorkspacePluginState(specs);
  seedE2EBuiltinWorkspacePluginDisable(specs);
  seedE2EBuiltInSubagentModelOverrides(specs);
  seedE2ESubagentProfiles(specs);
  await seedE2EGitReviewEntryWorkspace(specs);
  seedE2EGitCommitDialogWorkspace(specs);
  if (specs.some((spec) => spec.includes("conversation-session-history-first.test.ts"))) {
    await seedSessionHistoryFirstFixture({
      cliEntryPoint: CF_CLI_ENTRYPOINT,
      e2eHomeDir: E2E_HOME_DIR,
      workspacePath: resolve(E2E_HOME_DIR, "CfProject"),
      providerId: e2eProviderPreset.providerId,
      modelId: e2eProviderPreset.model,
      thoughtLevel: readE2EThoughtLevel(),
    });
  }
  if (specs.some((spec) => spec.includes(HOOKS_LIFECYCLE_SPEC))) {
    await installHooksLifecycleFixture();
  }
  if (workerSpecsContain(specs, "conversation-session-stop-tool-results.test.ts")) {
    await installStopToolResultsFixture();
  }
  if (specs.some((spec) => spec.includes(HOOK_TRUST_SPEC))) {
    await installHookTrustFixture();
  }
}

async function removeE2EHomeWithRetry() {
  for (let attempt = 0; attempt <= E2E_HOME_REMOVE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await rm(E2E_HOME_DIR, {
        force: true,
        maxRetries: process.platform === "win32" ? 3 : 1,
        recursive: true,
        retryDelay: 500,
      });
      return;
    } catch (error) {
      if (!isRetryableRemoveError(error) || attempt === E2E_HOME_REMOVE_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await cleanupE2EElectronProcesses(`beforeSession-remove-home-attempt-${attempt + 1}`);
      await delay(E2E_HOME_REMOVE_RETRY_DELAYS_MS[attempt] ?? 0);
    }
  }
}

function isRetryableRemoveError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    ["EBUSY", "ENOTEMPTY", "EPERM"].includes(String((error as { code?: unknown }).code)),
  );
}

function seedE2EPluginCdnZipMarketplace(specs: string[] = []) {
  if (!shouldUsePluginCdnZipMarketplaceFixture(specs)) {
    return;
  }
  if (!pluginCdnZipFixtureServer) {
    throw new Error("Plugin CDN zip fixture server must start before seeding marketplace");
  }
  seedPluginCdnZipMarketplaceFixture({
    e2eHomeDir: E2E_HOME_DIR,
    server: pluginCdnZipFixtureServer,
    lastUpdated: resolvePluginCdnZipMarketplaceLastUpdated(specs),
  });
}

// `apps/cli/packages/adapters/src/plugins/marketplace.ts:347`）。
function seedE2EPluginMcpSkillInstalledPlugins(specs: string[] = []) {
  const state = resolvePluginMcpSkillState(specs);
  if (!state || state === "not-installed" || state === "workspace-root") return;
  const templateName =
    state === "installed-enabled"
      ? "installed-plugins.enabled.template.json"
      : "installed-plugins.disabled.template.json";
  const fixturePath = resolve(DESKTOP_DIR, "test/e2e/fixtures/plugin-mcp-skill", templateName);
  const pluginRoot = resolve(DESKTOP_DIR, "test/e2e/fixtures/plugin-mcp-skill/e2e-plugin-mcp-ping");
  const template = readFileSync(fixturePath, "utf-8").replaceAll("__INSTALL_PATH__", pluginRoot);
  // pluginStorageRoot = <home>/.cf/cli/plugins
  const targetDir = resolve(E2E_STORAGE_ROOT, "cli/plugins");
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(resolve(targetDir, "installed_plugins.json"), template, "utf-8");
}

function shouldSeedGitCommitDialogWorkspace(specs: string[] = []) {
  return specs.some((spec) => spec.includes(GIT_COMMIT_DIALOG_UI_FLOW_SPEC));
}

function seedE2EGitCommitDialogWorkspace(specs: string[] = []) {
  if (!shouldSeedGitCommitDialogWorkspace(specs)) {
    return;
  }

  const workspacePath = resolve(E2E_HOME_DIR, "CfProject");
  mkdirSync(resolve(workspacePath, "src"), { recursive: true });
  writeFileSync(resolve(workspacePath, "README.md"), "Git commit dialog E2E workspace\n", "utf-8");
  runGitE2ECommand(workspacePath, ["init"]);
  runGitE2ECommand(workspacePath, ["checkout", "-B", "main"]);
  runGitE2ECommand(workspacePath, ["config", "user.name", "CodeFusion E2E"]);
  runGitE2ECommand(workspacePath, ["config", "user.email", "cf-e2e@example.com"]);
  runGitE2ECommand(workspacePath, ["add", "README.md"]);
  runGitE2ECommand(workspacePath, ["commit", "-m", "chore: seed git commit dialog e2e"]);
  runGitE2ECommand(workspacePath, ["branch", "e2e-target"]);

  writeFileSync(
    resolve(workspacePath, "src/staged-file.ts"),
    "export const stagedGitCommitDialogE2E = true;\n",
    "utf-8",
  );
  writeFileSync(
    resolve(workspacePath, "src/unstaged-file.ts"),
    "export const unstagedGitCommitDialogE2E = true;\n",
    "utf-8",
  );
  runGitE2ECommand(workspacePath, ["add", "src/staged-file.ts"]);
}

function runGitE2ECommand(cwd: string, args: string[]) {
  execFileSync("git", args, {
    cwd,
    env: process.env,
    stdio: "ignore",
  });
}

function seedE2EStartupState(specs: string[] = []) {
  mkdirSync(E2E_APP_CONFIG_DIR, { recursive: true });
  const useFreshConversationWorkspace = specs.some((spec) =>
    spec.includes("conversation-session-conversation-workspace.test.ts"),
  );
  const legacyDefaultProjectPath = resolve(E2E_HOME_DIR, "CfProject");
  const agentWarmupFixture = AGENT_WARMUP_FIXTURE_SPECS.some((marker) =>
    workerSpecsContain(specs, marker),
  );
  const agentWarmupScenario = SMALL_AGENT_WARMUP_SPECS.some((marker) =>
    workerSpecsContain(specs, marker),
  )
    ? SMALL_AGENT_WARMUP_SCENARIO
    : PASSIVE_AGENT_STARTUP_SCENARIO;
  const modelProviderRegressionFixture = workerSpecsContain(
    specs,
    MODEL_PROVIDER_REGRESSION_GAPS_SPEC,
  );
  const passiveWorkspacePaths = agentWarmupFixture
    ? seedPassiveAgentStartupWorkspaces(E2E_HOME_DIR, agentWarmupScenario.workspaceCount)
    : [];
  if (modelProviderRegressionFixture) {
    mkdirSync(legacyDefaultProjectPath, { recursive: true });
  }
  if (!useFreshConversationWorkspace && !agentWarmupFixture) {
    mkdirSync(legacyDefaultProjectPath, { recursive: true });
  }
  const now = Date.now();
  const codingPlanTeamSpec = shouldUseCodingPlanTeamMock(specs);
  const codingPlanUpgradeE2E = isCodingPlanUpgradeE2E(specs);
  const oauthCredentialRecoverySpec = isOAuthCredentialRecoverySpec(specs);
  const jwtExpiryReauthenticationSpec = isJwtExpiryReauthenticationSpec(specs);
  const subagentLoginCatalogStaleSpec = isSubagentCodingPlanLoginCatalogStaleSpec(specs);
  const builtInSubagentModelOverridesSpec = isBuiltInSubagentModelSelectionOverridesSpec(specs);
  const providerReadinessColdStartFixture = usesProviderReadinessColdStartFixture(specs);
  const shouldUseBigmodelAuth = codingPlanTeamSpec || codingPlanUpgradeE2E;
  const authProviderId = shouldUseBigmodelAuth ? BIGMODEL_PROVIDER_ID : E2E_AUTH_PROVIDER_ID;
  writeFileSync(
    E2E_APP_SETTINGS_FILE,
    JSON.stringify(
      {
        providerFamilyDomain: shouldUseBigmodelAuth ? "bigmodel" : "zai",
        providerFamilyDomainMigrated: true,
        providerFamilyDomainUpdatedAt: now,
        ...(modelProviderRegressionFixture
          ? {
              recentProjects: [legacyDefaultProjectPath, ...passiveWorkspacePaths],
              lastWorkspaceSession: [legacyDefaultProjectPath, ...passiveWorkspacePaths].map(
                (workspacePath) => ({
                  kind: "local" as const,
                  workspacePath,
                  workspacePurpose: "project" as const,
                }),
              ),
              lastActiveTabIndex: 0,
            }
          : agentWarmupFixture
            ? {
                recentProjects: passiveWorkspacePaths,
                lastWorkspaceSession: passiveWorkspacePaths.map((workspacePath) => ({
                  kind: "local" as const,
                  workspacePath,
                  workspacePurpose: "project" as const,
                })),
                lastActiveTabIndex: agentWarmupScenario.activeWorkspaceIndex,
              }
            : !useFreshConversationWorkspace
              ? {
                  lastWorkspaceSession: [
                    {
                      kind: "local",
                      workspacePath: legacyDefaultProjectPath,
                      workspacePurpose: "project",
                    },
                  ],
                  lastActiveTabIndex: 0,
                }
              : {}),
        ...(shouldSeedGuideInteractionBehavior(specs)
          ? {
              cfInteractionBehavior: "guide",
            }
          : {}),
        providerFamilyConnectionSelections: shouldUseBigmodelAuth
          ? { bigmodel: { kind: "individual-coding-plan" } }
          : {},
        ...(upstreamCaptureProxy
          ? {
              httpProxy: upstreamCaptureProxy.proxyUrl,
              httpProxyCaCertPath: upstreamCaptureProxy.caCertPath,
              httpProxyNoProxy: DEFAULT_E2E_NETWORK_CAPTURE_NO_PROXY,
            }
          : {}),
      },
      null,
      2,
    ),
    "utf-8",
  );
  writeFileSync(
    E2E_APP_CREDENTIALS_FILE,
    JSON.stringify(
      providerReadinessColdStartFixture ||
        workerSpecsContain(specs, "oauth-login-failure-cancel.test.ts")
        ? {}
        :
          builtInSubagentModelOverridesSpec
          ? {}
          : subagentLoginCatalogStaleSpec
            ? {}
            : oauthCredentialRecoverySpec
              ? createCorruptOAuthCredentialSeed(authProviderId)
              : jwtExpiryReauthenticationSpec
                ? createExpiredJwtOAuthCredentialSeed(authProviderId)
                : createE2EStartupCredentialSeed({
                    specs,
                    accountMock: codingPlanTeamSpec || codingPlanUpgradeE2E,
                    remoteProfile: process.env.CF_E2E_REMOTE_PROFILE === "1",
                    legacyAuthToken: E2E_AUTH_TOKEN,
                    restoredOAuthCredentials: {
                      "oauth:active_provider": authProviderId,
                      [`oauth:${authProviderId}:access_token`]: shouldUseBigmodelAuth
                        ? "e2e-bigmodel-oauth-token"
                        : E2E_AUTH_TOKEN,
                      [`oauth:${authProviderId}:user_info`]: JSON.stringify(E2E_USER_PROFILE),
                      cfjwttoken: E2E_AUTH_TOKEN,
                    },
                  }),
      null,
      2,
    ),
    "utf-8",
  );
}

function isOAuthCredentialRecoverySpec(specs: string[] = []) {
  return workerSpecsContain(specs, OAUTH_CREDENTIAL_RECOVERY_SPEC);
}

function isJwtExpiryReauthenticationSpec(specs: string[] = []) {
  return workerSpecsContain(specs, JWT_EXPIRY_REAUTHENTICATION_SPEC);
}

function isSubagentCodingPlanLoginCatalogStaleSpec(specs: string[] = []) {
  return workerSpecsContain(specs, SUBAGENT_CODING_PLAN_LOGIN_CATALOG_STALE_SPEC);
}

function usesProviderReadinessColdStartFixture(specs: string[] = []) {
  return (
    workerSpecsContain(specs, PROVIDER_READINESS_AGENT_STARTUP_SPEC) ||
    workerSpecsContain(specs, WINDOWS_AGENT_METRIC_PROBE_ABSENCE_SPEC)
  );
}

function usesContextWindowColdResumeFixture(specs: string[] = []) {
  return workerSpecsContain(specs, CONTEXT_WINDOW_COLD_RESUME_SPEC);
}

function usesTaskIndexRowAuthorityFixture(specs: string[] = []) {
  return workerSpecsContain(specs, TASK_INDEX_ROW_AUTHORITY_SPEC);
}

function usesGitReviewEntryFixture(specs: string[] = []) {
  return workerSpecsContain(specs, GIT_REVIEW_ENTRY_SPEC);
}

async function seedE2EGitReviewEntryWorkspace(specs: string[] = []) {
  if (!usesGitReviewEntryFixture(specs)) return;

  const workspacePath = resolve(E2E_HOME_DIR, "CfProject");
  const caseRoot = resolve(workspacePath, ".cf-e2e/conversation-session-git-review-entry");
  await mkdir(caseRoot, { recursive: true });
  await runGitReviewEntryCommand(workspacePath, ["init"]);
  await runGitReviewEntryCommand(workspacePath, ["checkout", "-B", "main"]);
  await writeFile(
    resolve(caseRoot, "status-panel-review.txt"),
    "status panel Git review e2e fixture\n",
    "utf8",
  );
}

async function runGitReviewEntryCommand(cwd: string, args: string[]) {
  await execFileAsync(process.env.CF_GIT_BINARY?.trim() || "git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

function createCorruptOAuthCredentialSeed(authProviderId: string): Record<string, string> {
  const corruptEncryptedValue = "enc:v1:bad.bad.bad";
  const corruptTokenProvider = process.env.CF_E2E_CORRUPT_OAUTH_TOKEN_PROVIDER;
  if (corruptTokenProvider === BIGMODEL_PROVIDER_ID || corruptTokenProvider === ZAI_PROVIDER_ID) {
    return {
      "oauth:active_provider": corruptTokenProvider,
      [`oauth:${corruptTokenProvider}:access_token`]: corruptEncryptedValue,
      [`oauth:${corruptTokenProvider}:refresh_token`]: "stale-refresh-token",
      [`oauth:${corruptTokenProvider}:user_info`]: JSON.stringify(
        corruptTokenProvider === ZAI_PROVIDER_ID
          ? { user_id: "e2e-user", name: "Fixture User" }
          : { id: "e2e-user", username: "Fixture User", displayName: "Fixture User" },
      ),
      cfjwttoken: "e2e-valid-opaque-jwt",
      "bot:e2e:credential": "e2e-independent-bot-token",
    };
  }
  return {
    "oauth:active_provider": corruptEncryptedValue,
    [`oauth:${authProviderId}:access_token`]: "stale-access-token",
    [`oauth:${authProviderId}:refresh_token`]: "stale-refresh-token",
    [`oauth:${authProviderId}:user_info`]: JSON.stringify(E2E_USER_PROFILE),
    [`oauth:${BIGMODEL_PROVIDER_ID}:access_token`]: "stale-bigmodel-access-token",
    [`oauth:${BIGMODEL_PROVIDER_ID}:refresh_token`]: "stale-bigmodel-refresh-token",
    [`oauth:${BIGMODEL_PROVIDER_ID}:user_info`]: JSON.stringify(E2E_USER_PROFILE),
    cfjwttoken: "stale-cf-jwt-token",
    "bot:e2e:credential": "e2e-independent-bot-token",
  };
}

function createExpiredJwtOAuthCredentialSeed(authProviderId: string): Record<string, string> {
  return {
    "oauth:active_provider": authProviderId,
    [`oauth:${authProviderId}:access_token`]: "expired-session-access-token",
    [`oauth:${authProviderId}:refresh_token`]: "expired-session-refresh-token",
    [`oauth:${authProviderId}:user_info`]: JSON.stringify(E2E_USER_PROFILE),
    cfjwttoken: "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjF9.e2e",
  };
}

function isCodingPlanUpgradeE2E(specs: string[] = []) {
  return resolveCodingPlanUpgradeMockScenario(specs) !== null;
}

function shouldSeedGuideInteractionBehavior(specs: string[] = []) {
  return specs.some(
    (arg) =>
      arg.includes("conversation-session-running-guide-steer.test.ts") ||
      arg.includes("conversation-session-background-guide-steer.test.ts"),
  );
}

const PLUGIN_MCP_SKILL_SPEC_PATTERN =
  /conversation-session-plugin-mcp-skill-(not-installed|installed-enabled|installed-disabled|workspace-enabled|workspace-disabled|workspace-inherited|workspace-isolation|workspace-root|workspace-freeze)\.test\.ts/u;
const PLUGIN_MCP_SKILL_STATES = new Set([
  "not-installed",
  "installed-enabled",
  "installed-disabled",
  "workspace-enabled",
  "workspace-disabled",
  "workspace-inherited",
  "workspace-isolation",
  "workspace-root",
  "workspace-freeze",
]);

function resolvePluginMcpSkillState(
  specs: string[] = [],
):
  | "not-installed"
  | "installed-enabled"
  | "installed-disabled"
  | "workspace-enabled"
  | "workspace-disabled"
  | "workspace-inherited"
  | "workspace-isolation"
  | "workspace-root"
  | "workspace-freeze"
  | null {
  const envState = process.env.CF_E2E_PLUGIN_MCP_SKILL_STATE?.trim();
  if (envState && PLUGIN_MCP_SKILL_STATES.has(envState)) {
    return envState as Exclude<ReturnType<typeof resolvePluginMcpSkillState>, null>;
  }
  for (const arg of specs) {
    if (arg.includes("conversation-session-plugin-resident-freeze-cold-resume.test.ts")) {
      return "workspace-freeze";
    }
    const match = arg.match(PLUGIN_MCP_SKILL_SPEC_PATTERN);
    if (match && match[1]) {
      return match[1] as
        | "not-installed"
        | "installed-enabled"
        | "installed-disabled"
        | "workspace-enabled"
        | "workspace-disabled"
        | "workspace-inherited"
        | "workspace-isolation"
        | "workspace-root"
        | "workspace-freeze";
    }
  }
  return null;
}

function seedE2EPluginMcpSkillState(specs: string[] = []) {
  const state = resolvePluginMcpSkillState(specs);
  if (!state || state === "not-installed" || state.startsWith("workspace-")) return;
  const configPath = resolve(E2E_CLI_CONFIG_DIR, "config.json");
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as { code?: string }).code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const plugins = (config.plugins as Record<string, unknown> | undefined) ?? {};
  const enabledPlugins = (plugins.enabledPlugins as Record<string, boolean> | undefined) ?? {};
  const pluginId = "e2e-plugin-mcp-ping@e2e-fixture";
  // apps/cli/packages/adapters/src/plugins/index.ts:resolveCandidates）；
  if (state === "installed-disabled") {
    enabledPlugins[pluginId] = false;
  } else {
    enabledPlugins[pluginId] = true;
  }
  plugins.enabledPlugins = enabledPlugins;
  config.plugins = plugins;
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function seedE2EWorkspacePluginState(specs: string[] = []) {
  const state = resolvePluginMcpSkillState(specs);
  if (!state?.startsWith("workspace-")) return;

  const workspacePath = resolve(E2E_HOME_DIR, "CfProject");
  const userConfigPath = resolve(E2E_CLI_CONFIG_DIR, "config.json");
  const workspaceConfigPath = resolve(workspacePath, ".cf", "config.json");
  const pluginId = "e2e-plugin-mcp-ping@e2e-fixture";
  const pluginRoot = resolve(DESKTOP_DIR, "test/e2e/fixtures/plugin-mcp-skill/e2e-plugin-mcp-ping");
  mkdirSync(resolve(workspacePath, ".cf"), { recursive: true });
  const userConfig = JSON.parse(readFileSync(userConfigPath, "utf-8")) as Record<string, unknown>;
  const userPlugins = (userConfig.plugins as Record<string, unknown> | undefined) ?? {};
  const userEnabledPlugins =
    (userPlugins.enabledPlugins as Record<string, boolean> | undefined) ?? {};
  const userOptions =
    (userPlugins.options as Record<string, Record<string, unknown>> | undefined) ?? {};
  userEnabledPlugins[pluginId] = state !== "workspace-isolation";
  userOptions[pluginId] = {
    label: "user-label",
    secret: "E2E_USER_PLUGIN_SECRET",
  };
  userPlugins.enabledPlugins = userEnabledPlugins;
  userPlugins.options = userOptions;
  userConfig.plugins = userPlugins;
  writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2), "utf-8");

  const workspaceEnabledPlugins =
    state === "workspace-inherited"
      ? {}
      : {
          [pluginId]:
            state === "workspace-enabled" ||
            state === "workspace-isolation" ||
            state === "workspace-root" ||
            state === "workspace-freeze",
        };
  const workspaceDirs = state === "workspace-root" ? [pluginRoot] : undefined;
  writeFileSync(
    workspaceConfigPath,
    JSON.stringify(
      {
        plugins: {
          ...(workspaceDirs ? { dirs: workspaceDirs } : {}),
          enabledPlugins: workspaceEnabledPlugins,
          options: {
            [pluginId]: {
              label: "workspace-label",
              secret: "E2E_WORKSPACE_PLUGIN_SECRET",
            },
          },
        },
      },
      null,
      2,
    ),
    "utf-8",
  );

  if (state === "workspace-isolation") {
    mkdirSync(resolve(E2E_HOME_DIR, "WorkspaceB"), { recursive: true });
  }
}

function seedE2EBuiltinWorkspacePluginDisable(specs: string[] = []) {
  if (
    !specs.some((spec) =>
      spec.includes("conversation-session-plugin-builtin-workspace-disable.test.ts"),
    )
  ) {
    return;
  }

  const pluginId = "skill-creator@cf-plugins-official";
  const workspaceA = resolve(E2E_HOME_DIR, "CfProject");
  const workspaceB = resolve(E2E_HOME_DIR, "WorkspaceB");
  const userConfig = JSON.parse(readFileSync(E2E_CLI_CONFIG_FILE, "utf-8")) as Record<
    string,
    unknown
  >;
  const userPlugins = (userConfig.plugins as Record<string, unknown> | undefined) ?? {};
  const enabledPlugins = (userPlugins.enabledPlugins as Record<string, boolean> | undefined) ?? {};
  const options =
    (userPlugins.options as Record<string, Record<string, unknown>> | undefined) ?? {};
  enabledPlugins[pluginId] = true;
  options[pluginId] = { e2e: "preserve-user-option" };
  userPlugins.enabledPlugins = enabledPlugins;
  userPlugins.options = options;
  userConfig.plugins = userPlugins;
  writeFileSync(E2E_CLI_CONFIG_FILE, `${JSON.stringify(userConfig, null, 2)}\n`, "utf-8");

  mkdirSync(resolve(workspaceA, ".cf"), { recursive: true });
  mkdirSync(workspaceB, { recursive: true });
  writeFileSync(
    resolve(workspaceA, ".cf", "config.json"),
    `${JSON.stringify(
      {
        plugins: {
          enabledPlugins: {
            [pluginId]: false,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  const pluginDataDir = resolve(E2E_CLI_CONFIG_DIR, "plugins", "data", pluginId);
  mkdirSync(pluginDataDir, { recursive: true });
  writeFileSync(
    resolve(pluginDataDir, "state.json"),
    `${JSON.stringify({ marker: "preserve-user-data" }, null, 2)}\n`,
    "utf-8",
  );
}

async function seedE2EModelConfig(specs: string[] = []) {
  if (usesContextWindowColdResumeFixture(specs)) {
    await seedContextWindowColdResumeModelConfig();
    return;
  }
  await seedUpstreamE2EModelConfig(specs);
  await seedModelOutputTokenProviders(specs);
}

interface ModelOutputTokenProviderSeed {
  apiFormat?: "openai-chat-completions" | "openai-responses";
  id: string;
  kind?: "openai" | "openai-compatible";
  models: Array<{
    contextWindow: number;
    id: string;
    limitOutput?: number;
    maxOutputTokens?: number;
  }>;
  name: string;
  supportedFormat?: "openai" | "responses";
}

function seedE2EWorkerModelStreamConfig(specs: string[] = []) {
  const modelStreamIdleTimeoutMs = resolveE2EWorkerModelStreamIdleTimeoutMs(specs);
  if (modelStreamIdleTimeoutMs === undefined) return;
  mkdirSync(E2E_CLI_CONFIG_DIR, { recursive: true });
  writeFileSync(
    E2E_CLI_CONFIG_FILE,
    JSON.stringify({ modelStream: { idleTimeoutMs: modelStreamIdleTimeoutMs } }, null, 2),
    "utf-8",
  );
}

async function seedModelOutputTokenProviders(specs: string[] = []) {
  const providerSeeds: ModelOutputTokenProviderSeed[] = [];
  if (specs.some((spec) => spec.includes(MODEL_OUTPUT_TOKEN_BUDGET_SPEC))) {
    providerSeeds.push({
      id: "output-token-budget-e2e",
      models: [
        { contextWindow: 128_000, id: "otb-default" },
        { contextWindow: 128_000, id: "otb-16k", limitOutput: 16_000 },
        { contextWindow: 128_000, id: "otb-64k", maxOutputTokens: 64_000 },
        { contextWindow: 128_000, id: "otb-runtime-refresh" },
      ],
      name: "Output Token Budget E2E",
    });
  }
  if (specs.some((spec) => spec.includes(MODEL_OUTPUT_TOKEN_PREFLIGHT_SPEC))) {
    providerSeeds.push({
      id: "output-token-preflight-e2e",
      models: [
        {
          contextWindow: 128_000,
          id: "otb-preflight-64k",
          limitOutput: 64_000,
        },
        {
          contextWindow: 64_000,
          id: "otb-preflight-smoke-64k-48k",
          limitOutput: 48_000,
        },
        {
          contextWindow: 200_000,
          id: "otb-preflight-smoke-200k-128k",
          limitOutput: 128_000,
        },
      ],
      name: "Output Token Preflight E2E",
    });
  }
  if (specs.some((spec) => spec.includes(OUTPUT_LIMIT_CONTINUE_MARKDOWN_PROTOCOLS_SPEC))) {
    providerSeeds.push(
      {
        id: "otc-protocol-chat",
        models: [{ contextWindow: 128_000, id: "otc-protocol-chat" }],
        name: "OTC Chat Completions E2E",
      },
      {
        apiFormat: "openai-responses",
        id: "otc-protocol-responses",
        kind: "openai",
        models: [{ contextWindow: 128_000, id: "otc-protocol-responses" }],
        name: "OTC Responses API E2E",
        supportedFormat: "responses",
      },
    );
  }
  if (providerSeeds.length === 0) {
    return;
  }

  const apiKey =
    upstreamE2EHttpMode === "replay"
      ? E2E_PROVIDER_REPLAY_API_KEY
      : (process.env.E2E_PROVIDER_API_KEY?.trim() ?? "");
  if (!apiKey || apiKey === "xxx") {
    throw new Error("Output-token E2E 缺少可用 provider API Key");
  }
  const appProviders = providerSeeds.map(
    (provider): PersonalProviderConfigSeed => ({
      apiFormat: "openai-chat-completions",
      apiKey,
      baseURL: upstreamE2EBaseUrl,
      enabled: true,
      id: provider.id,
      label: provider.name,
      models: provider.models.map((model) => ({
        contextWindow: model.contextWindow,
        id: model.id,
        ...(model.maxOutputTokens === undefined && model.limitOutput === undefined
          ? {}
          : { maxOutputTokens: model.maxOutputTokens ?? model.limitOutput }),
      })),
    }),
  );
  for (const provider of appProviders) {
    await seedPersonalProviderConfig(E2E_APP_PROVIDER_CONFIG_FILE, provider);
  }
}

async function seedContextWindowColdResumeModelConfig() {
  const apiKey =
    upstreamE2EHttpMode === "replay"
      ? E2E_PROVIDER_REPLAY_API_KEY
      : (process.env.E2E_PROVIDER_API_KEY?.trim() ?? "");
  if (!apiKey || apiKey === "xxx") {
    throw new Error("context-window cold-resume 缺少可用 provider API Key");
  }
  const provider: PersonalProviderConfigSeed = {
    id: CONTEXT_WINDOW_COLD_RESUME_PROVIDER_ID,
    label: CONTEXT_WINDOW_COLD_RESUME_PROVIDER_NAME,
    baseURL: upstreamE2EBaseUrl,
    apiFormat: "openai-chat-completions",
    apiKey,
    enabled: true,
    models: [
      {
        id: CONTEXT_WINDOW_COLD_RESUME_MODEL_ID,
        contextWindow: CONTEXT_WINDOW_COLD_RESUME_MAX_TOKENS,
        maxOutputTokens: CONTEXT_WINDOW_COLD_RESUME_MAX_OUTPUT_TOKENS,
      },
    ],
  };
  await seedPersonalProviderConfig(E2E_APP_PROVIDER_CONFIG_FILE, provider);
  mkdirSync(E2E_APP_CONFIG_DIR, { recursive: true });
  await seedPersonalDefaultModelSelection(E2E_APP_PROVIDER_CONFIG_FILE, {
    providerId: CONTEXT_WINDOW_COLD_RESUME_PROVIDER_ID,
    modelId: CONTEXT_WINDOW_COLD_RESUME_MODEL_ID,
  });
}

function isSubagentProviderRegistryColdStartSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(SUBAGENT_PROVIDER_REGISTRY_COLD_START_SPEC));
}

function isBuiltInSubagentModelSelectionOverridesSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(BUILT_IN_SUBAGENT_MODEL_OVERRIDES_SPEC));
}

function isSettingsSubagentCreateEditPersistenceSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(SETTINGS_SUBAGENT_CREATE_EDIT_PERSISTENCE_SPEC));
}

function isSubagentRuntimeCatalogReasoningSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(SUBAGENT_RUNTIME_CATALOG_REASONING_SPEC));
}

function isOffPeakSubagentModelInheritanceSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(OFFPEAK_SUBAGENT_MODEL_INHERITANCE_SPEC));
}

function isOffPeakInvalidTicketSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(OFFPEAK_INVALID_TICKET_SPEC));
}

function isModelProviderPlanSurfaceSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(MODEL_PROVIDER_PLAN_SURFACE_SPEC));
}

function isToolErrorSurfaceSpec(specs: string[] = []) {
  return specs.some((spec) => spec.includes(TOOL_ERROR_SURFACE_SPEC));
}

function seedE2EBuiltInSubagentModelOverrides(specs: string[] = []) {
  const builtInModelSelectionOverridesSpec = isBuiltInSubagentModelSelectionOverridesSpec(specs);
  const runtimeCatalogSpec = isSubagentRuntimeCatalogReasoningSpec(specs);
  const offPeakSubagentModelInheritanceSpec = isOffPeakSubagentModelInheritanceSpec(specs);
  if (
    !builtInModelSelectionOverridesSpec &&
    !runtimeCatalogSpec &&
    !offPeakSubagentModelInheritanceSpec
  ) {
    return;
  }

  if (existsSync(E2E_AGENTS_STATE_FILE)) {
    return;
  }

  const overrideSelection = runtimeCatalogSpec
    ? {
        providerId: SUBAGENT_RUNTIME_CATALOG_PROVIDER_ID,
        modelId: SUBAGENT_RUNTIME_CATALOG_MODEL,
      }
    : {
        providerId: E2E_PROVIDER_ALTERNATE_PROVIDER_ID,
        modelId: E2E_PROVIDER_SECONDARY_MODEL,
      };
  const initialGeneralPurposeSelection =
    runtimeCatalogSpec || offPeakSubagentModelInheritanceSpec
      ? overrideSelection
      : {
          providerId: e2eProviderPreset.providerId,
          modelId: e2eProviderPreset.model,
        };
  mkdirSync(E2E_APP_CONFIG_DIR, { recursive: true });
  writeFileSync(
    E2E_AGENTS_STATE_FILE,
    JSON.stringify(
      {
        builtInModelSelectionOverrides: {
          Explore: {
            ...overrideSelection,
            ...(builtInModelSelectionOverridesSpec || runtimeCatalogSpec
              ? { options: { reasoningLevel: "invalid-e2e" } }
              : {}),
          },
          "general-purpose": {
            ...initialGeneralPurposeSelection,
            ...(runtimeCatalogSpec ? { options: { reasoningLevel: "high" } } : {}),
          },
        },
        disabledAgentIds: [],
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function seedE2ESubagentProfiles(specs: string[] = []) {
  if (specs.some((spec) => spec.includes("conversation-session-subagent-cross-host.test.ts"))) {
    const pluginDir = resolve(E2E_STORAGE_ROOT, "cli/plugins");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      resolve(pluginDir, "installed_plugins.json"),
      JSON.stringify({
        version: 1,
        plugins: [
          {
            id: "e2e-subagent-refresh@e2e-fixture",
            name: "e2e-subagent-refresh",
            marketplace: "e2e-fixture",
            version: "1.0.0",
            installPath: resolve(DESKTOP_DIR, "test/e2e/fixtures/subagent-refresh-plugin"),
            installedAt: "2026-09-18T00:00:00.000Z",
            updatedAt: "2026-09-18T00:00:00.000Z",
            scope: "user",
          },
        ],
      }),
    );
    const config = existsSync(E2E_CLI_CONFIG_FILE)
      ? JSON.parse(readFileSync(E2E_CLI_CONFIG_FILE, "utf8"))
      : {};
    config.plugins = {
      ...config.plugins,
      enabledPlugins: {
        ...config.plugins?.enabledPlugins,
        "e2e-subagent-refresh@e2e-fixture": true,
      },
    };
    writeFileSync(E2E_CLI_CONFIG_FILE, JSON.stringify(config));
  }
  const profileEntries: Array<{ content: string; name: string }> = [];

  if (isBuiltInSubagentModelSelectionOverridesSpec(specs)) {
    profileEntries.push({
      name: SUBAGENT_REASONING_AGENT_NAME,
      content: `---
name: ${SUBAGENT_REASONING_AGENT_NAME}
description: E2E custom subagent for reasoning effort persistence coverage.
model: custom:${E2E_PROVIDER_ALTERNATE_PROVIDER_ID}:${E2E_PROVIDER_SECONDARY_MODEL}
thoughtLevel: invalid-e2e
tools: Read
maxTurns: 1
---
You are the E2E reasoning reviewer. Reply only with the requested marker.
`,
    });
  }

  if (isSubagentRuntimeCatalogReasoningSpec(specs)) {
    profileEntries.push({
      name: SUBAGENT_RUNTIME_CATALOG_AGENT_NAME,
      content: `---
name: ${SUBAGENT_RUNTIME_CATALOG_AGENT_NAME}
description: E2E custom subagent for runtime reasoning catalog coverage.
model: custom:${SUBAGENT_RUNTIME_CATALOG_PROVIDER_ID}:${SUBAGENT_RUNTIME_CATALOG_MODEL}
thoughtLevel: invalid-e2e
tools: Read
maxTurns: 1
---
You are the E2E Claude catalog reviewer. Reply only with the requested marker.
`,
    });
  }

  if (isSubagentProviderRegistryColdStartSpec(specs)) {
    profileEntries.push({
      name: SUBAGENT_PROVIDER_REGISTRY_AGENT_NAME,
      content: `---
name: ${SUBAGENT_PROVIDER_REGISTRY_AGENT_NAME}
description: E2E subagent bound to an alternate provider for cold-start registry sync reproduction.
model: custom:${E2E_PROVIDER_ALTERNATE_PROVIDER_ID}:${E2E_PROVIDER_SECONDARY_MODEL}
tools: Read
maxTurns: 1
---
You are the E2E provider registry reviewer. Reply only with the requested marker.
`,
    });
  }

  if (isOffPeakSubagentModelInheritanceSpec(specs)) {
    profileEntries.push(
      {
        name: "Code Search",
        content: `---
name: Code Search
description: E2E custom foreground subagent with an explicit alternate provider model.
model: custom:${E2E_PROVIDER_ALTERNATE_PROVIDER_ID}:${E2E_PROVIDER_SECONDARY_MODEL}
tools: Read
maxTurns: 1
---
You are the E2E Code Search reviewer. Reply only with the requested marker.
`,
      },
      {
        name: "E2E OffPeak Inherit Reviewer",
        content: `---
name: E2E OffPeak Inherit Reviewer
description: E2E custom foreground subagent that normally inherits the session model.
tools: Read
maxTurns: 1
---
You are the E2E inherited-model reviewer. Reply only with the requested marker.
`,
      },
      {
        name: "E2E OffPeak Background Reviewer",
        content: `---
name: E2E OffPeak Background Reviewer
description: E2E custom profile configured to run in the background.
model: custom:${E2E_PROVIDER_ALTERNATE_PROVIDER_ID}:${E2E_PROVIDER_SECONDARY_MODEL}
tools: Read
background: true
maxTurns: 1
---
This E2E profile must be rejected before any provider request during an idle-plan turn.
`,
      },
    );
  }

  if (isToolErrorSurfaceSpec(specs)) {
    profileEntries.push(
      {
        name: TOOL_ERROR_SURFACE_STALE_AGENT_NAME,
        content: `---
name: ${TOOL_ERROR_SURFACE_STALE_AGENT_NAME}
description: E2E subagent intentionally bound to a stale provider/model for tool error surface coverage.
model: custom:e2e-stale-provider:e2e-stale-model
tools: Read
maxTurns: 1
---
You are the stale E2E reviewer. This profile should fail before any child model request.
`,
      },
      {
        name: TOOL_ERROR_SURFACE_HEALTHY_AGENT_NAME,
        content: `---
name: ${TOOL_ERROR_SURFACE_HEALTHY_AGENT_NAME}
description: E2E subagent used as the healthy sibling when another Agent tool fails.
tools: Read
maxTurns: 1
---
You are the healthy E2E reviewer. Reply only with the requested marker.
`,
      },
    );
  }

  if (specs.some((spec) => spec.includes(SUBAGENT_TEAM_SCOPE_SPEC))) {
    profileEntries.push({
      name: "e2e-team-scope-reviewer",
      content: `---
name: e2e-team-scope-reviewer
description: E2E custom subagent bound to a Team connection without organization/project scope.
model: custom:team-plan:e2e-missing-scope:team-model
tools: Read
maxTurns: 1
---
This child must fail before sending a provider request when the Team scope is unavailable.
`,
    });
  }

  if (profileEntries.length === 0) {
    return;
  }

  for (const agentsDir of [E2E_USER_AGENTS_DIR, E2E_CLI_AGENTS_DIR]) {
    mkdirSync(agentsDir, { recursive: true });
    for (const profile of profileEntries) {
      const profilePath = resolve(agentsDir, `${profile.name}.md`);
      if (!existsSync(profilePath)) {
        writeFileSync(profilePath, profile.content, "utf-8");
      }
    }
  }
}

async function seedUpstreamE2EModelConfig(specs: string[] = []) {
  if (isOAuthCredentialRecoverySpec(specs) || usesProviderReadinessColdStartFixture(specs)) {
    return;
  }

  const apiKey =
    upstreamE2EHttpMode === "replay"
      ? E2E_PROVIDER_REPLAY_API_KEY
      : (process.env.E2E_PROVIDER_API_KEY?.trim() ?? "");
  if (!apiKey || apiKey === "xxx") {
    return;
  }

  const anthropicBaseURL = buildUpstreamE2EAnthropicBaseUrl();
  const modelSwitchToolEditForkSpec = specs.some((spec) =>
    spec.includes("conversation-session-model-switch-tool-edit-fork.test.ts"),
  );
  const modelProviderListFilteringSpec = specs.some((spec) =>
    spec.includes("conversation-session-model-provider-list-filtering.test.ts"),
  );
  const forkMergedAssistantSpec = specs.some((spec) =>
    spec.includes("conversation-session-fork-merged-assistant.test.ts"),
  );
  const bashReadStateSpec = specs.some((spec) =>
    spec.includes("conversation-session-bash-read-state.test.ts"),
  );
  const runningGuideSteerSpec = specs.some((spec) =>
    spec.includes("conversation-session-running-guide-steer.test.ts"),
  );
  const subagentProviderRegistryColdStartSpec = isSubagentProviderRegistryColdStartSpec(specs);
  const builtInSubagentModelOverridesSpec = isBuiltInSubagentModelSelectionOverridesSpec(specs);
  const settingsSubagentCreateEditPersistenceSpec =
    isSettingsSubagentCreateEditPersistenceSpec(specs);
  const exposeSubagentReasoningMetadata =
    specs.some((spec) =>
      /conversation-session-(thought-level-session-isolation|readstate-model-isolation|v4-goal)\.test\.ts$/.test(
        spec,
      ),
    ) ||
    builtInSubagentModelOverridesSpec ||
    settingsSubagentCreateEditPersistenceSpec ||
    specs.some((spec) => spec.includes("plugin-subagent-override-cold.test.ts")) ||
    isSubagentCodingPlanLoginCatalogStaleSpec(specs);
  const subagentRuntimeCatalogReasoningSpec = isSubagentRuntimeCatalogReasoningSpec(specs);
  const offPeakSubagentModelInheritanceSpec = isOffPeakSubagentModelInheritanceSpec(specs);
  const browserUseIabLifecycleSpec = specs.some(
    (spec) =>
      spec.includes("conversation-session-browser-use-iab-full-chain.test.ts") ||
      spec.includes("conversation-session-browser-zoom-coordinates.test.ts") ||
      spec.includes("conversation-session-browser-use-iab-multitab-lifecycle.test.ts") ||
      spec.includes("conversation-session-node-repl-stateless-browser-multisession.test.ts") ||
      spec.includes("conversation-session-browser-use-subagent-boundary.test.ts"),
  );
  const toolCallGroupingSpec = specs.some(
    (spec) =>
      spec.includes("conversation-session-tool-stage-grouping-live-transition.test.ts") ||
      spec.includes("conversation-session-terminal-expanded-details-and-status.test.ts") ||
      spec.includes("conversation-session-changes-group-responsive-file-summary.test.ts") ||
      spec.includes("conversation-session-tool-group-reasoning-visibility-boundary.test.ts") ||
      spec.includes("conversation-session-tool-groups-history-restore.test.ts") ||
      spec.includes("conversation-session-cua-response-grouping.test.ts"),
  );
  const autoCompactSpec = specs.some(
    (spec) =>
      spec.includes("conversation-session-compact-auto.test.ts") ||
      spec.includes("conversation-session-compact-auto-actions.test.ts") ||
      spec.includes("conversation-session-goal-run-cases.test.ts") ||
      spec.includes("conversation-session-model-switch-auto-compact.test.ts") ||
      (spec.includes("test/e2e/conversation-session/manual-review/") &&
        !modelSwitchToolEditForkSpec &&
        !forkMergedAssistantSpec &&
        !bashReadStateSpec &&
        !runningGuideSteerSpec &&
        !spec.includes("conversation-session-output-limit-continue-ui.test.ts") &&
        !spec.includes("conversation-session-output-limit-continue-markdown-boundaries.test.ts") &&
        !spec.includes(
          "conversation-session-output-limit-continue-markdown-content-types.test.ts",
        ) &&
        !spec.includes("conversation-session-output-limit-continue-markdown-protocols.test.ts") &&
        !subagentProviderRegistryColdStartSpec &&
        !builtInSubagentModelOverridesSpec &&
        !subagentRuntimeCatalogReasoningSpec &&
        !offPeakSubagentModelInheritanceSpec &&
        !spec.includes("conversation-session-tool-input-validation-provider-content.test.ts") &&
        !spec.includes("conversation-session-offpeak-create-existing-session.test.ts") &&
        !spec.includes("conversation-session-anthropic-reasoning-history-replay.test.ts") &&
        !spec.includes("conversation-session-sse-stall-diagnostic.test.ts") &&
        !spec.includes("conversation-session-plugin-resident-freeze-cold-resume.test.ts") &&
        !toolCallGroupingSpec &&
        !browserUseIabLifecycleSpec &&
        !spec.includes("conversation-session-background-file-diff.test.ts") &&
        !spec.includes("conversation-session-permission-hook-race.test.ts") &&
        !spec.includes("conversation-session-permission-hook-rewrite.test.ts") &&
        !spec.includes("conversation-session-virtual-project-cold-roots.test.ts") &&
        !spec.includes("conversation-session-web-remote-unread.test.ts") &&
        !spec.includes("conversation-session-tool-cross-product.test.ts") &&
        !spec.includes("conversation-session-subagent-catalog-refresh.test.ts") &&
        !spec.includes("conversation-session-subagent-profile-fields.test.ts") &&
        !spec.includes("conversation-session-subagent-context-boundaries.test.ts") &&
        !spec.includes("conversation-session-subagent-multi-workspace.test.ts") &&
        !spec.includes("conversation-session-subagent-cross-host.test.ts")),
  );
  const modelSwitchAutoCompactSpec = specs.some((spec) =>
    spec.includes("conversation-session-model-switch-auto-compact.test.ts"),
  );
  const contextWindow = upstreamE2EContextWindowOverride ?? (autoCompactSpec ? 240 : 128000);
  const maxOutputTokens = upstreamE2EMaxOutputTokensOverride ?? (autoCompactSpec ? 80 : undefined);
  const appContextWindow =
    upstreamE2EContextWindowOverride ?? (modelSwitchAutoCompactSpec ? 1 : contextWindow);
  const appMaxOutputTokens =
    upstreamE2EMaxOutputTokensOverride ?? (modelSwitchAutoCompactSpec ? 1 : maxOutputTokens);
  mkdirSync(E2E_APP_CONFIG_DIR, { recursive: true });
  const composerToolbarSpec = specs.some((spec) =>
    spec.includes("conversation-session-v4-composer-toolbar.test.ts"),
  );
  const reasoning = (): PersonalProviderConfigSeed["models"][number]["reasoningLevel"] => ({
    values: specs.some((spec) => spec.endsWith("conversation-session-v4-goal.test.ts"))
      ? ["high", "low", "max"]
      :
        e2eProviderPresetName === "env" ||
          e2eProviderPresetName === "stagingmodel" ||
          composerToolbarSpec
        ? builtInSubagentModelOverridesSpec
          ? ["off", "low", "high", "max"]
          : ["high", "max"]
        : ["disabled"],
    map: exposeSubagentReasoningMetadata
      ? '{"thinking":{"type":"enabled","budget_tokens":1024},"output_config":{"effort":reasoningLevel}}'
      : "{}",
  });
  const model = (
    id: string,
    visibility?: "visible" | "hidden",
  ): PersonalProviderConfigSeed["models"][number] => ({
    id,
    contextWindow: appContextWindow,
    ...(specs.some(
      (spec) =>
        spec.includes("conversation-session-v4-attachment-layout.test.ts") ||
        spec.includes("conversation-session-stop-tool-results.test.ts"),
    )
      ? { inputModalities: ["text", "image"] as const }
      : {}),
    ...(appMaxOutputTokens !== undefined ? { maxOutputTokens: appMaxOutputTokens } : {}),
    reasoningLevel: reasoning(),
    ...(visibility ? { visibility } : {}),
  });
  const provider = (params: {
    apiKey?: string;
    baseURL?: string;
    enabled?: boolean;
    id: string;
    label: string;
    models: PersonalProviderConfigSeed["models"];
    visibility?: "visible" | "hidden";
  }): PersonalProviderConfigSeed => ({
    apiFormat: "anthropic-messages",
    apiKey: params.apiKey ?? apiKey,
    baseURL: params.baseURL ?? anthropicBaseURL,
    enabled: params.enabled ?? true,
    id: params.id,
    label: params.label,
    models: params.models,
    ...(params.visibility ? { visibility: params.visibility } : {}),
  });
  const appProviders: PersonalProviderConfigSeed[] = [
    provider({
      id: e2eProviderPreset.providerId,
      label: e2eProviderPreset.providerName,
      models: [
        model(e2eProviderPreset.model),
        ...(e2eProviderPresetName === "env" ? [model(E2E_PROVIDER_SECONDARY_MODEL)] : []),
      ],
    }),
    ...(e2eProviderPresetName === "env"
      ? [
          provider({
            id: E2E_PROVIDER_ALTERNATE_PROVIDER_ID,
            label: E2E_PROVIDER_ALTERNATE_PROVIDER_NAME,
            models: [model(E2E_PROVIDER_SECONDARY_MODEL)],
          }),
        ]
      : []),
    ...(subagentRuntimeCatalogReasoningSpec
      ? [
          provider({
            id: SUBAGENT_RUNTIME_CATALOG_PROVIDER_ID,
            label: SUBAGENT_RUNTIME_CATALOG_PROVIDER_NAME,
            models: [
              {
                ...model(SUBAGENT_RUNTIME_CATALOG_MODEL),
                maxOutputTokens: 32_000,
                reasoningLevel: {
                  values: ["low", "medium", "high", "xhigh"],
                  map: '{"thinking":{"type":"enabled","budget_tokens":reasoningLevel == "low" ? 4000 : reasoningLevel == "medium" ? 8000 : reasoningLevel == "high" ? 16000 : 31999},"output_config":{"effort":reasoningLevel}}',
                },
              },
            ],
          }),
        ]
      : []),
    ...(modelProviderListFilteringSpec
      ? [
          provider({
            id: "e2e-hidden-provider",
            label: "Hidden Provider",
            models: [model("hidden-provider-model")],
            visibility: "hidden",
          }),
          provider({
            id: "e2e-visible-provider-hidden-model",
            label: "Visible Provider With Hidden Model",
            models: [model("visible-companion-model"), model("hidden-model", "hidden")],
          }),
          provider({
            enabled: false,
            id: "e2e-hidden-disabled",
            label: "Hidden Disabled Provider",
            models: [model("hidden-disabled-model")],
          }),
          provider({
            apiKey: "",
            id: "e2e-hidden-no-key",
            label: "Hidden No Key Provider",
            models: [model("hidden-no-key-model")],
          }),
          provider({
            baseURL: "",
            id: "e2e-hidden-no-endpoint",
            label: "Hidden No Endpoint Provider",
            models: [model("hidden-no-endpoint-model")],
          }),
          provider({
            baseURL: `${anthropicBaseURL}/builtin-personal-conflict`,
            id: "e2e-zai-template-provider",
            label: "Z.ai Template Provider E2E",
            models: [model("glm-5.3")],
          }),
        ]
      : []),
  ];
  for (const provider of appProviders) {
    await seedPersonalProviderConfig(E2E_APP_PROVIDER_CONFIG_FILE, provider);
  }
  await seedPersonalDefaultModelSelection(E2E_APP_PROVIDER_CONFIG_FILE, {
    providerId: e2eProviderPreset.providerId,
    modelId: e2eProviderPreset.model,
    options: { reasoningLevel: readE2EThoughtLevel() || "disabled" },
  });
}

function buildUpstreamE2EAnthropicBaseUrl() {
  const baseURL = upstreamE2EBaseUrl.replace(/\/+$/u, "");
  return baseURL.endsWith("/anthropic") ? baseURL : `${baseURL}/anthropic`;
}

export const config: WebdriverIO.Config = {
  runner: "local",
  connectionRetryCount: E2E_WEBDRIVER_REQUEST_LIMITS.retryCount,
  connectionRetryTimeout: pluginNoGitGitHubArchiveE2E
    ? 300_000
    : E2E_WEBDRIVER_REQUEST_LIMITS.timeoutMs,
  runnerEnv: {
    E2E_PROVIDER_ALTERNATE_MODEL: E2E_PROVIDER_SECONDARY_MODEL,
    E2E_PROVIDER_ALTERNATE_PROVIDER_ID,
    E2E_PROVIDER_ALTERNATE_PROVIDER_NAME,
    E2E_PROVIDER_HTTP_MODE: upstreamE2EHttpMode,
    [REQUESTED_UPSTREAM_HTTP_MODE_ENV]: requestedUpstreamE2EHttpMode ?? "",
    E2E_PROVIDER_MODEL: resolveActiveE2EProviderEnv().model,
    E2E_PROVIDER_ID: resolveActiveE2EProviderEnv().providerId,
    E2E_PROVIDER_NAME: resolveActiveE2EProviderEnv().providerName,
    E2E_PROVIDER_PRESET: e2eProviderPresetName,
    ...requestSecurityWorkerEnv(process.env),
    E2E_PROVIDER_THOUGHT_LEVEL: resolveActiveE2EProviderEnv().thoughtLevel,
    ...(upstreamE2EHttpMode === "replay"
      ? { E2E_PROVIDER_API_KEY: E2E_PROVIDER_REPLAY_API_KEY }
      : {}),
    HOME: E2E_HOME_DIR,
    USERPROFILE: E2E_HOME_DIR,
    E2E_PLUGIN_RUNTIME_SECRET: "e2e-plugin-runtime-secret-fixture-20260718",
    ...(pluginNoGitGitHubArchiveE2E
      ? {
          CF_GIT_BINARY: resolve(E2E_HOME_DIR, "missing-bin", "git"),
        }
      : {}),
    VITE_CF_E2E_STORE_BRIDGE: "1",
    CF_AGENT_SERVER_ARGS_JSON: "",
    CF_AGENT_SERVER_COMMAND: "",
    CF_DATA_BASE_DIR: E2E_HOME_DIR,
    CF_BUILTIN_PROVIDER_CONFIG_FILE:
      INITIAL_CF_BUILTIN_PROVIDER_CONFIG_FILE ?? E2E_DEFAULT_CF_BUILTIN_PROVIDER_CONFIG_FILE,
    CF_DESKTOP_APPLICATION_NAME: "CodeFusion E2E",
    CF_DESKTOP_HOME_DIR: E2E_HOME_DIR,
    CF_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA: "1",
    CF_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
    CF_E2E_HOME_DIR: E2E_HOME_DIR,
    CF_E2E_ARTIFACT_DIR: e2eReporter.artifactDir,
    CF_E2E_DEFER_APP_DATA_CLEANUP: "1",
    CF_E2E_RUN_ID: E2E_RUN_ID,
    CF_ENV: "test",
    ...getE2EProviderEndpointEnv(configuredE2ESpecs, e2eProviderPresetName, upstreamE2EHttpMode),
    ...(process.env.CF_TELEMETRY_PARITY_CAPTURE_PATH?.trim()
      ? {
          CF_TELEMETRY_PARITY_CAPTURE_PATH: process.env.CF_TELEMETRY_PARITY_CAPTURE_PATH,
        }
      : {}),
    ...(process.env.CF_TELEMETRY_PARITY_VARIANT?.trim()
      ? {
          CF_TELEMETRY_PARITY_VARIANT: process.env.CF_TELEMETRY_PARITY_VARIANT,
        }
      : {}),
  },
  framework: "mocha",
  reporters: ["spec"],
  maxInstances: Number(process.env.CF_E2E_MAX_INSTANCES ?? "1"),
  maxInstancesPerCapability: Number(process.env.CF_E2E_MAX_INSTANCES ?? "1"),
  ...(containerE2E
    ? {
        autoXvfb: true,
        xvfbAutoInstall: false,
        xvfbMaxRetries: 5,
        xvfbRetryDelay: 1500,
      }
    : {}),
  services: [
    [
      E2E_ELECTRON_SERVICE_MODULE_PATH,
      {
        rootDir: DESKTOP_DIR,
      },
    ],
  ],
  capabilities: [
    {
      browserName: "electron",
      browserVersion: ELECTRON_VERSION,
      "wdio:electronServiceOptions": {
        appArgs: [
          ...(E2E_PACKAGED_APP_BINARY_PATH ? [] : [`--app=${E2E_APP_ENTRY_POINT}`]),
          "--no-sandbox",
          buildE2ERunIdArg(E2E_RUN_ID),
          createWindowsE2EHomeMarkerArg(E2E_HOME_DIR),
        ],
        appBinaryPath: ELECTRON_APP_BINARY_PATH,
      },
      "goog:chromeOptions": {
        windowTypes: ["page"],
        args: [...(containerE2E ? containerChromeArgs : [])],
      },
      ...(containerE2E
        ? {
            "wdio:chromedriverOptions": {
              cacheDir: E2E_BROWSER_DRIVER_CACHE_DIR,
            },
          }
        : {}),
    },
  ],
  specs: configuredE2ESpecs,
  exclude: [
    ...(upstreamProviderSpecRequested ? [] : [UPSTREAM_PROVIDER_SPEC]),
    ...(turnSteerProbeSpecRequested ? [] : [TURN_STEER_PROBE_SPEC]),
    ...(manualReviewE2E ? [] : [MANUAL_REVIEW_SPEC_GLOB]),
    ...resolveEnvironmentGatedFormalSpecExcludes({
      env: process.env,
      targeted: requestedE2ESpecs.length > 0,
    }),
    ...requestedE2EExcludeSpecs,
  ],
  mochaOpts: {
    rootHooks: createE2ERendererBridgeRootHooks(
      async () => {
        await measureE2ELifecyclePhase(
          "before-suite",
          { specs: currentE2EWorkerSpecs },
          async () => {
            await runE2ERendererBridgePreflight(currentE2EWorkerSpecs);
          },
        );
      },
      () => currentE2EBeforeSessionError,
    ),
    ui: "bdd",
    ...(process.env.CF_E2E_MOCHA_GREP?.trim()
      ? { grep: process.env.CF_E2E_MOCHA_GREP.trim() }
      : {}),
    timeout:
      (configuredE2ESpecs.some((spec) =>
        spec.endsWith("conversation-session-remote-sidebar-menus.test.ts"),
      )
        ?
          15 * 60_000
        : configuredE2ESpecs.some((spec) =>
              spec.endsWith("conversation-session-remote-ui-walkthrough.test.ts"),
            )
          ?
            30 * 60_000
          : configuredE2ESpecs.some((spec) =>
                spec.endsWith("conversation-session-r3-mobile.test.ts"),
              )
            ?
              40 * 60_000
            : pluginNoGitGitHubArchiveE2E ||
                workspacePluginRemoteExplicitSyncE2E ||
                configuredE2ESpecs.some((spec) =>
                  spec.endsWith("conversation-session-subagent-cross-host.test.ts"),
                )
              ? 600000
              :
                configuredE2ESpecs.some((spec) =>
                    spec.endsWith("conversation-session-background-bash-output.test.ts"),
                  )
                ? 360000
                : requestSecuritySpecTimeout(configuredE2ESpecs, 120000)) + manualReviewHoldMs,
  },
  async onPrepare() {
    try {
      e2eReporter.prepare(configuredE2ESpecs);
      await measureE2ELifecyclePhase("prepare", { specs: configuredE2ESpecs }, async () => {
        await cleanupE2EElectronProcesses("onPrepare");
        await cleanupE2EDirectory("onPrepare", E2E_CHROMIUM_USER_DATA_ROOT_DIR, true);
        await startCodingPlanTeamMockIfNeeded(configuredE2ESpecs);
        if (codingPlanTeamMockBaseUrl) {
          if (!config.runnerEnv) {
            throw new Error(
              "wdio config 缺少 runnerEnv，coding plan reset mock 端口无法透传给 worker",
            );
          }
          Object.assign(config.runnerEnv, {
            [CODING_PLAN_TEAM_MOCK_BASE_URL_ENV]: codingPlanTeamMockBaseUrl,
          });
        }
        await startCodingPlanUpgradeE2EMock(configuredE2ESpecs, {
          prepareForBuild: true,
        });
        const codingPlanUpgradeMockBaseUrl =
          process.env[CODING_PLAN_UPGRADE_MOCK_BASE_URL_ENV]?.trim();
        if (codingPlanUpgradeMockBaseUrl) {
          if (configuredE2ESpecs.some((spec) => spec.includes("marketing-touch-rewards"))) {
            process.env.VITE_REWARDS_WEBVIEW_ORIGIN = codingPlanUpgradeMockBaseUrl;
          }
          if (!config.runnerEnv) {
            throw new Error(
              "wdio config 缺少 runnerEnv，coding plan upgrade mock 端口无法透传给 worker",
            );
          }
          Object.assign(config.runnerEnv, {
            [CODING_PLAN_UPGRADE_MOCK_BASE_URL_ENV]: codingPlanUpgradeMockBaseUrl,
          });
        }
        const buildAndStage = async () =>
          withE2EDesktopBuildLock({}, async () => {
            prepareDesktopAppBuild();
            if (!E2E_PACKAGED_APP_BINARY_PATH) await stageDesktopE2EAppOutput();
          });
        if (process.env.CF_E2E_SOURCE_EVIDENCE === "1") {
          await withE2ESourceEvidence({
            freshBuild: !E2E_PACKAGED_APP_BINARY_PATH && !shouldReuseDesktopE2EBuild(process.env),
            captureSources: () => captureWorkspaceSources(REPO_ROOT),
            build: buildAndStage,
            appOutputDir: E2E_APP_OUTPUT_DIR,
            artifactDir: e2eReporter.artifactDir,
          });
        } else await buildAndStage();
        prepareCfAgentServer();
      });
    } catch (error) {
      console.error("[e2e] fatal onPrepare failure", error);
      process.exit(1);
    }
  },
  onWorkerStart(cid, _caps, specs) {
    e2eRunnerFinalizationGuard.disarm();
    e2eWorkerLifecycleStarts.set(cid, {
      specs,
      startedAt: new Date(),
    });
  },
  async beforeSession(_config, capabilities, specs, cid) {
    currentE2EWorkerSessionSpecs = specs;
    applyUpstreamE2EHttpModeForWorker(specs);
    applyAskUserQuestionClockScaleForWorker(specs);
    applyE2EProviderEnv(specs);
    configureHighspeedE2EMock(specs);
    currentE2EBeforeSessionError = null;
    applyE2EWorkerModelRetryEnv(process.env, specs, configuredModelRetryMaxRetries);
    currentE2EChromiumUserDataDir = resolveE2EWorkerChromiumProfileDir(
      E2E_CHROMIUM_USER_DATA_ROOT_DIR,
      cid,
    );
    const chromeCapabilities = capabilities as {
      "goog:chromeOptions"?: { args?: string[] };
    };
    const chromeOptions = chromeCapabilities["goog:chromeOptions"] ?? {};
    chromeOptions.args = replaceChromeUserDataDirArg(
      chromeOptions.args ?? [],
      currentE2EChromiumUserDataDir,
    );
    const storageDiagnostics =
      process.env.CF_E2E_STORAGE_WORKER_DIAGNOSTICS === "1" &&
      specs.some((spec) =>
        spec.endsWith("conversation-session-r3-desktop-settings-authority.test.ts"),
      );
    if (
      !E2E_PACKAGED_APP_BINARY_PATH &&
      (storageDiagnostics ||
        specs.some((spec) =>
          /conversation-session-subagent-(context-boundaries|multi-workspace|cross-host)\.test\.ts/.test(
            spec,
          ),
        ))
    ) {
      const entry = resolve(E2E_APP_OUTPUT_DIR, "main/subagent-e2e.mjs");
      const proxy = resolve(
        REPO_ROOT,
        storageDiagnostics
          ? "packages/desktop/test/e2e/helpers/storage-worker-diagnostics.mjs"
          : "packages/desktop/test/e2e/helpers/subagent-config-proxy.mjs",
      );
      const preload = `--import=${JSON.stringify(proxy)}`;
      const diagnostics = storageDiagnostics
        ? `process.env.CF_E2E_STORAGE_WORKER_DIAGNOSTICS_DIR = ${JSON.stringify(resolve(e2eReporter.artifactDir, "storage-workers"))};\n`
        : "";
      await writeFile(
        entry,
        `${diagnostics}process.env.NODE_OPTIONS = ${JSON.stringify(preload)};\nawait import(${JSON.stringify(pathToFileURL(E2E_APP_ENTRY_POINT).href)});\n`,
      );
      chromeOptions.args = chromeOptions.args.map((arg) =>
        arg.startsWith("--app=") ? `--app=${entry}` : arg,
      );
    }
    chromeCapabilities["goog:chromeOptions"] = chromeOptions;
    try {
      await measureE2ELifecyclePhase("before-session", { cid, specs }, async () => {
        await cleanupE2EElectronProcesses("beforeSession-start", {
          requireExit: true,
        });
        await startModelContextBudgetConfigE2EMock(specs);
        await startDynamicWorkflowConfigE2EMock(specs);
        if (specs.some((spec) => spec.endsWith("conversation-session-r3-subagent.test.ts"))) {
          process.env.CF_DYNAMIC_WORKFLOW_MODE = "alwaysOn";
        }
        await runE2EBeforeSessionSetup({
          cid,
          specs,
          configureAgentServerEnv: configureCfAgentServerEnv,
          configureCodingPlanTeamMockForSpecs,
          recordBeforeSession: e2eReporter.beforeSession,
          resetHome: resetE2EHome,
          startCodingPlanTeamMockIfNeeded,
          startCodingPlanUpgradeMockIfNeeded: startCodingPlanUpgradeE2EMock,
          startUpstreamHttpIfNeeded: startUpstreamE2EHttp,
          startCodingPlanDataPlaneProxyIfNeeded: startCodingPlanDataPlaneProxy,
          startPluginCdnZipFixtureIfNeeded,
          startOffPeakMockIfNeeded: startOffPeakE2EMock,
        });
        await startClientScenesE2EMockIfNeeded(specs);
        await startRequestSecurityFixture(specs, E2E_HOME_DIR);
        stopOAuthCompletionRaceFixture = await prepareOAuthCompletionRaceFixture(specs);
        stopAccessToken401Fixture = await prepareAccessToken401Fixture({
          specs,
          credentialsFile: E2E_APP_CREDENTIALS_FILE,
          settingsFile: E2E_APP_SETTINGS_FILE,
        });
        stopWebRemoteControlAuthGateFixture = await prepareWebRemoteControlAuthGateFixture({
          specs,
          credentialsFile: E2E_APP_CREDENTIALS_FILE,
          settingsFile: E2E_APP_SETTINGS_FILE,
          workspacePath: resolve(E2E_HOME_DIR, "CfProject"),
        });
        await installBashPrefixPermissionPnpmShim({
          environment: process.env,
          homeDir: E2E_HOME_DIR,
          specs,
        });
      });
    } catch (error) {
      currentE2EBeforeSessionError =
        error ?? new Error("beforeSession setup rejected without an error value");
    }
  },
  async before(_capabilities, specs) {
    currentE2EWorkerSpecs = specs;
  },
  async beforeTest(test) {
    await e2eReporter.startUICoverage(browser);
    await e2eReporter.startProcessSampling(browser, currentE2EWorkerSpecs);
    e2eFailureArtifacts ??= new E2EFailureArtifactCollector({
      artifactDir: e2eReporter.artifactDir,
      browser,
    });
    try {
      await e2eFailureArtifacts.start(test);
    } catch (error) {
      console.warn("[e2e] failure artifact collection could not start", error);
    }
  },
  async beforeCommand(commandName) {
    if (commandName !== "refresh") {
      return;
    }
    try {
      await e2eReporter.snapshotUICoverage();
    } catch (error) {
      console.warn("[e2e-coverage] renderer pre-refresh snapshot failed", error);
    }
  },
  async after(_result, _capabilities, specs) {
    await measureE2ELifecyclePhase("after", { specs }, async () => {
      try {
        await e2eReporter.stopProcessSampling(browser, specs);
        await e2eReporter.stopUICoverage();
      } finally {
        await armCurrentElectronAppQuit("after");
        currentE2EWorkerSpecs = [];
      }
    });
  },
  async afterSession() {
    await measureE2ELifecyclePhase(
      "after-session",
      { specs: currentE2EWorkerSessionSpecs },
      async () => {
        try {
          await cleanupE2EElectronProcesses("afterSession", {
            requireExit: true,
            waitForGracefulExit: true,
          });
          if (currentE2EChromiumUserDataDir) {
            await cleanupE2EDirectory("afterSession", currentE2EChromiumUserDataDir, true);
          }
          e2eReporter.compactNodeCoverage();
        } finally {
          await stopRequestSecurityFixture();
          await stopModelContextBudgetConfigE2EMock();
          await stopDynamicWorkflowConfigE2EMock();
          currentE2EElectronAppPid = null;
          await stopOAuthCompletionRaceFixture?.();
          stopOAuthCompletionRaceFixture = null;
          await stopWebRemoteControlAuthGateFixture?.();
          stopWebRemoteControlAuthGateFixture = null;
          await stopAccessToken401Fixture?.();
          stopAccessToken401Fixture = null;
          currentE2EBeforeSessionError = null;
          e2eFailureArtifacts = null;
          currentE2EWorkerSessionSpecs = [];
          currentE2EChromiumUserDataDir = null;
        }
      },
    );
  },
  onWorkerEnd(cid, exitCode, specs) {
    e2eRunnerFinalizationGuard.arm();
    const workerLifecycle = e2eWorkerLifecycleStarts.get(cid);
    if (!workerLifecycle) {
      return;
    }
    e2eWorkerLifecycleStarts.delete(cid);
    const completedAt = new Date();
    e2eReporter.recordLifecycleEvent({
      cid,
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - workerLifecycle.startedAt.getTime(),
      error: exitCode === 0 ? undefined : `worker exited with code ${exitCode}`,
      phase: "worker",
      specs: specs.length > 0 ? specs : workerLifecycle.specs,
      startedAt: workerLifecycle.startedAt.toISOString(),
      status: exitCode === 0 ? "passed" : "failed",
    });
  },
  async afterTest(test, _context, result) {
    let failureArtifacts;
    const collectionErrors: string[] = [];
    try {
      await e2eReporter.stopUICoverage();
    } catch (error) {
      console.warn("[e2e-coverage] renderer snapshot failed", error);
      collectionErrors.push(
        `renderer coverage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      failureArtifacts = await runE2EDiagnosticWithTimeout(
        async () =>
          e2eFailureArtifacts?.complete(test, {
            ...result,
            errorCategory: result.passed
              ? undefined
              : classifyError(
                  result.error instanceof Error ? result.error.message : String(result.error ?? ""),
                ),
          }),
        E2E_FAILURE_ARTIFACT_COLLECTION_TIMEOUT_MS,
        "E2E failure artifact collection",
      );
    } catch (error) {
      console.warn("[e2e] failure artifact collection failed", error);
      collectionErrors.push(
        `failure artifacts: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    e2eReporter.recordTestResult(test, result, failureArtifacts, collectionErrors);
  },
  async onComplete(exitCode) {
    e2eRunnerFinalizationGuard.disarm();
    let onCompleteError: unknown;
    try {
      await measureE2ELifecyclePhase("complete", { specs: configuredE2ESpecs }, async () => {
        try {
          await stopUpstreamE2EHttp();
          await stopCodingPlanTeamMock();
          await stopCodingPlanUpgradeE2EMock();
          await stopRequestSecurityFixture();
          await stopModelContextBudgetConfigE2EMock();
          await stopDynamicWorkflowConfigE2EMock();
          await stopClientScenesE2EMock();
          await stopOAuthCompletionRaceFixture?.();
          stopOAuthCompletionRaceFixture = null;
          await stopWebRemoteControlAuthGateFixture?.();
          stopWebRemoteControlAuthGateFixture = null;
          await stopAccessToken401Fixture?.();
          stopAccessToken401Fixture = null;
          await stopPluginCdnZipFixture();
        } finally {
          await cleanupE2EElectronProcesses("onComplete");
          if (exitCode !== 0 && process.env.CF_E2E_KEEP_HOME_ON_FAIL === "1") {
            console.warn(`[e2e] keeping failure home for diagnosis: ${E2E_HOME_DIR}`);
          } else {
            await cleanupE2EDirectory("onComplete-home", E2E_HOME_DIR, true);
          }
          await cleanupE2EDirectory("onComplete", E2E_RUN_CACHE_DIR);
        }
      });
    } catch (error) {
      onCompleteError = error;
    } finally {
      e2eReporter.writeSummary(exitCode);
      armE2ERunnerExitWatchdog(exitCode);
    }
    if (onCompleteError) {
      throw onCompleteError;
    }
  },
};
