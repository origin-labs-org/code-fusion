import type { TuiReadClipboardImage, TuiWriteClipboardText } from "@origin-ai/cf-tui";
import type { UiLocale } from "@origin-ai/cf-i18n";
import type { Logger } from "@origin-ai/cf-contracts";
import type {
  createManagedCdpBrowserRuntime,
  ManagedCdpBrowserRuntimeOptions,
} from "@origin-ai/cf-adapters/browser";
import type {
  createDefaultProviderEndpointRoutingPort,
  createModelAdapter,
  createCfApp,
  CreateDefaultProviderEndpointRoutingPortOptions,
  CreateModelAdapterOptions,
  configureCodingPlanApiKey,
  ConfigureCodingPlanApiKeyOptions,
  inspectCfSkill,
  inspectWorkspaceHookTrust,
  grantWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
  inspectCfCustomCommand,
  InspectCfCustomCommandOptions,
  InspectCfSkillOptions,
  loginCfCli,
  loginBigmodelCodingPlan,
  LoginBigmodelCodingPlanOptions,
  LoginCfCliOptions,
  listCfCustomCommands,
  ListCfCustomCommandsOptions,
  loadCfCustomCommand,
  listCfSessions,
  listCfSkills,
  ListCfSessionsOptions,
  ListCfSkillsOptions,
  logoutCfCli,
  LogoutCfCliOptions,
  resolveLatestSession,
  ResolveLatestSessionOptions,
  RunCfProtocolAgentOptions,
  prepareCfTelemetryEnv,
  startProcessProviderRegistryRuntime,
  shutdownCfTelemetry,
  CfAppOptions,
} from "@origin-ai/cf-bootstrap";
import type { CliEnv, DotenvLoadResult, LoadCliDotenvOptions } from "./env.js";
import type { PluginsCommandOverrides } from "./plugins-command.js";
import type { CliShutdownProcess } from "./shutdown.js";
import type { resolveWorkspaceGitBranch } from "./tui-workspace-git.js";

export type BootstrapModule = typeof import("@origin-ai/cf-bootstrap");

export interface RunDependencies extends PluginsCommandOverrides {
  migrateStorage?: () => Promise<import("@origin-ai/cf-shared/sqlite-migrations").MigrationResult>;
  protocolLifecycle?: RunCfProtocolAgentOptions["lifecycle"];
  protocolInput?: NodeJS.ReadableStream;
  createManagedCdpBrowserRuntime?: (
    options?: ManagedCdpBrowserRuntimeOptions,
  ) => ReturnType<typeof createManagedCdpBrowserRuntime>;
  createModelAdapter?: (
    options?: CreateModelAdapterOptions,
  ) => ReturnType<typeof createModelAdapter>;
  createProviderEndpointRoutingPort?: (
    options: CreateDefaultProviderEndpointRoutingPortOptions,
  ) => ReturnType<typeof createDefaultProviderEndpointRoutingPort>;
  createCfApp?: (
    options?: CfAppOptions,
  ) => Awaited<ReturnType<typeof createCfApp>> | ReturnType<typeof createCfApp>;
  /**
   * Session-event shaper for --output-format stream-json. Defaults to the
   * bootstrap module's, which is also what the protocol server uses; injectable
   * so a caller that supplies its own `createCfApp` (tests, embedders) can
   * still stream, since the bootstrap module is not loaded on that path.
   */
  mapSessionEvent?: BootstrapModule["mapSessionEvent"];
  cwd?: () => string;
  env?: CliEnv;
  inspectSkill?: (options: InspectCfSkillOptions) => ReturnType<typeof inspectCfSkill>;
  inspectWorkspaceHookTrust?: typeof inspectWorkspaceHookTrust;
  grantWorkspaceHookTrust?: typeof grantWorkspaceHookTrust;
  revokeWorkspaceHookTrustCli?: typeof revokeWorkspaceHookTrustCli;
  inspectCustomCommand?: (
    options: InspectCfCustomCommandOptions,
  ) => ReturnType<typeof inspectCfCustomCommand>;
  loginCfCli?: (options?: LoginCfCliOptions) => ReturnType<typeof loginCfCli>;
  loginBigmodelCodingPlan?: (
    options?: LoginBigmodelCodingPlanOptions,
  ) => ReturnType<typeof loginBigmodelCodingPlan>;
  configureCodingPlanApiKey?: (
    options: ConfigureCodingPlanApiKeyOptions,
  ) => ReturnType<typeof configureCodingPlanApiKey>;
  loadDotenv?: (options?: LoadCliDotenvOptions) => DotenvLoadResult;
  prepareCfTelemetryEnv?: typeof prepareCfTelemetryEnv;
  projectConfigPath?: string;
  listSessions?: (options: ListCfSessionsOptions) => ReturnType<typeof listCfSessions>;
  listCustomCommands?: (
    options: ListCfCustomCommandsOptions,
  ) => ReturnType<typeof listCfCustomCommands>;
  loadCustomCommand?: (
    options: InspectCfCustomCommandOptions,
  ) => ReturnType<typeof loadCfCustomCommand>;
  isReservedSlashCommandName?: BootstrapModule["isReservedCfSlashCommandName"];
  listSkills?: (options: ListCfSkillsOptions) => ReturnType<typeof listCfSkills>;
  logger?: Logger;
  readClipboardImage?: TuiReadClipboardImage;
  writeClipboardText?: TuiWriteClipboardText;
  resolveLatestSession?: (
    options: ResolveLatestSessionOptions,
  ) => ReturnType<typeof resolveLatestSession>;
  resolveWorkspaceGitBranch?: typeof resolveWorkspaceGitBranch;
  logoutCfCli?: (options?: LogoutCfCliOptions) => ReturnType<typeof logoutCfCli>;
  runCfProtocolAgent?: (options?: RunCfProtocolAgentOptions) => Promise<void>;
  runTui?: typeof import("@origin-ai/cf-tui").runTui;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  exitProcess?: (code: number) => void;
  shutdownCleanupTimeoutMs?: number;
  shutdownProcess?: CliShutdownProcess;
  startProcessProviderRegistryRuntime?: typeof startProcessProviderRegistryRuntime;
  shutdownCfTelemetry?: typeof shutdownCfTelemetry;
}

export type CliPermissionMode = "build" | "plan" | "edit" | "yolo" | "guarded";
export type CliRuntimeMode = CliPermissionMode | "auto";

export interface CliModeState {
  current?: CliRuntimeMode;
  override?: CliPermissionMode;
}

export interface CliTargetRequest {
  objective: string;
  replaceExisting: boolean;
}

export type ModeCapableApp = Awaited<ReturnType<typeof createCfApp>> & {
  getMode?: () => CliRuntimeMode;
  setLocale?: (locale: UiLocale) => Promise<{ locale: "en-US" | "zh-CN" }>;
  setMode?: (mode: CliRuntimeMode) => Promise<{ mode: CliRuntimeMode }>;
};

export interface CliResumeRequest {
  continueSession: boolean;
  resumeSessionId?: string;
}
