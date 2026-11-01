// Bootstrap public API surface.

export * from "./app/create-app.js";
export type {
  ListCfSessionsOptions,
  PromptInput,
  ResolveLatestSessionOptions,
  ResumeOptions,
  RunCfProtocolAgentOptions,
  SendInputOptions,
  SendInputResult,
  SetLocaleResult,
  SteerTurnOptions,
  SubmitPromptOptions,
  UserPromptInput,
  CfApp,
  CfAppOptions,
  CfModelOption,
} from "./app/types.js";
export * from "./auth-login.js";
export {
  inspectCfCustomCommand,
  listCfCustomCommands,
  loadCfCustomCommand,
} from "./custom-commands.js";
export type {
  InspectCfCustomCommandOptions,
  ListCfCustomCommandsOptions,
  CfCustomCommandInspection,
} from "./custom-commands.js";
export { createModelAdapter } from "./model-factory.js";
export type { CreateModelAdapterOptions } from "./model-factory.js";
export {
  createDefaultProviderEndpointRoutingPort,
  resolveProcessProviderEndpointRoutingPort,
} from "./provider-endpoint-routing.js";
export type {
  CreateDefaultProviderEndpointRoutingPortOptions,
  ResolveProcessProviderEndpointRoutingPortOptions,
} from "./provider-endpoint-routing.js";
export { startProcessProviderRegistryRuntime } from "./app/process-provider-registry-runtime.js";
export type { ProcessProviderRegistryRuntimeOptions } from "./app/process-provider-registry-runtime.js";
export {
  addCfPluginMarketplace,
  getCfPluginsOverview,
  installCfMarketplacePlugin,
  listCfPlugins,
  removeCfPluginMarketplace,
  resolveCfPlugins,
  setCfPluginEnabled,
  uninstallCfMarketplacePlugin,
  updateCfMarketplacePlugin,
  updateCfPluginMarketplace,
  validateCfPluginPath,
} from "./plugins.js";
export type {
  AddCfMarketplaceOptions,
  InstallCfMarketplacePluginOptions,
  ListCfPluginsOptions,
  RemoveCfMarketplaceOptions,
  ResolveCfPluginsOptions,
  SetCfPluginEnabledOptions,
  SetCfPluginEnabledResult,
  UninstallCfMarketplacePluginOptions,
  UpdateCfMarketplaceOptions,
  UpdateCfMarketplacePluginOptions,
  ValidateCfPluginPathOptions,
  CfAvailablePluginData,
  CfInstalledPluginData,
  CfMarketplaceSummaryData,
  CfMarketplaceUpdateData,
  CfPluginInstallData,
  CfPluginUpdateData,
  CfPluginsOverviewData,
} from "./plugins.js";
export { runCfProtocolAgent } from "./cf-protocol-entrypoint.js";
// Exposed for the CLI's --output-format stream-json: it needs the same event
// shape the protocol server emits, rather than inventing a second one.
export { mapSessionEvent } from "./cf-protocol/session-mapper.js";
export { prepareCfTelemetryEnv, shutdownCfTelemetry } from "./telemetry-bootstrap.js";
export type { SessionTranscriptMessage, SessionTranscriptPart } from "./session-transcript.js";
export { listCfSessions, resolveLatestSession } from "./sessions.js";
export { inspectCfSkill, listCfSkills } from "./skills.js";
export type {
  InspectCfSkillOptions,
  ListCfSkillsOptions,
  CfSkillInspection,
} from "./skills.js";
// Exposed for the CLI's headless slash routing: it must decide "is this a real
// custom command?" with the *same* reserved-name gate the app facade's
// customCommandPromptResolver applies, or the two disagree and a reserved name
// reaches the model as literal prompt text. See prompt-command.ts.
export { isReservedCfSlashCommandName } from "./slash-command-surface.js";
export {
  grantWorkspaceHookTrust,
  inspectWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
} from "./workspace-hook-trust-cli.js";
export type {
  WorkspaceHookTrustCliItem,
  WorkspaceHookTrustCliStatus,
  WorkspaceHookTrustCliTarget,
} from "./workspace-hook-trust-cli.js";
