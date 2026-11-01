import type { Logger } from "@origin-ai/cf-contracts";
import type { listCfPlugins } from "@origin-ai/cf-bootstrap";
import { createInterface } from "node:readline";
import type { GlobalOptions, RunContext } from "@origin-ai/cf-shared-types";
import type { CliEnv } from "./env.js";

export type BootstrapModule = typeof import("@origin-ai/cf-bootstrap");
export type PluginListOutcome = ReturnType<typeof listCfPlugins>;
export type PluginListItem = PluginListOutcome["plugins"][number];
export type PluginDiagnostic = PluginListOutcome["diagnostics"][number];
export type PluginScope = "user" | "workspace";

export const BOOTSTRAP_EXPORTS = {
  addMarketplace: "addCfPluginMarketplace",
  getPluginsOverview: "getCfPluginsOverview",
  installPlugin: "installCfMarketplacePlugin",
  listPlugins: "listCfPlugins",
  removeMarketplace: "removeCfPluginMarketplace",
  setPluginEnabled: "setCfPluginEnabled",
  uninstallPlugin: "uninstallCfMarketplacePlugin",
  updateMarketplace: "updateCfPluginMarketplace",
  updatePlugin: "updateCfMarketplacePlugin",
  validatePluginPath: "validateCfPluginPath",
} as const satisfies Record<string, keyof BootstrapModule>;

export type PluginDepName = keyof typeof BOOTSTRAP_EXPORTS;
export type PluginDepFn<K extends PluginDepName> =
  BootstrapModule[(typeof BOOTSTRAP_EXPORTS)[K]];

export type PluginsCommandOverrides = { [K in PluginDepName]?: PluginDepFn<K> };

export interface PluginsCommandDependencies extends PluginsCommandOverrides {
  cwd?: () => string;
  env?: CliEnv;
  logger?: Logger;
  loadBootstrapModule?: () => Promise<BootstrapModule>;
  projectConfigPath?: string;
  skipUserConfig?: boolean;
  userConfigPath?: string;
}

export interface PluginsCommandFlags {
  all?: boolean;
  available?: boolean;
  keepData?: boolean;
  scope?: string;
  sparse?: readonly string[];
}

export class PluginsUsageError extends Error {}

export function requireOne(rest: string[]): string {
  const [value] = rest;
  if (rest.length !== 1 || !value || value.trim().length === 0) throw new PluginsUsageError();
  return value.trim();
}

export async function resolveDep<K extends PluginDepName>(
  deps: PluginsCommandDependencies,
  key: K,
): Promise<PluginDepFn<K>> {
  const override = deps[key] as PluginDepFn<K> | undefined;
  if (override) return override;
  const bootstrap = deps.loadBootstrapModule ?? (() => import("@origin-ai/cf-bootstrap"));
  return (await bootstrap())[BOOTSTRAP_EXPORTS[key]] as PluginDepFn<K>;
}

export function baseOptions(deps: PluginsCommandDependencies) {
  return {
    env: deps.env ?? process.env,
    logger: deps.logger,
    projectConfigPath: deps.projectConfigPath,
    skipUserConfig: deps.skipUserConfig,
    userConfigPath: deps.userConfigPath,
    workingDirectory: (deps.cwd ?? process.cwd)(),
  };
}

export function resolveScope(value: string | undefined): PluginScope | undefined {
  if (value === undefined) return undefined;
  if (value === "user") return "user";
  if (value === "project") return "workspace";
  if (value === "local") {
    throw new PluginsUsageError("Scope 'local' is not supported by cf. Use: user, project");
  }
  throw new PluginsUsageError(`Invalid scope '${value}'. Use: user, project`);
}

export function splitPluginIdentifier(value: string): { name: string; marketplace?: string } {
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return { name: value };
  return { name: value.slice(0, at), marketplace: value.slice(at + 1) };
}

export function hasErrors(diagnostics: readonly PluginDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

export async function resolveLoadedPluginId(
  deps: PluginsCommandDependencies,
  identifier: string,
): Promise<string> {
  if (splitPluginIdentifier(identifier).marketplace) return identifier;
  const outcome = (await resolveDep(deps, "listPlugins"))(baseOptions(deps));
  const matches = outcome.plugins.filter((plugin) => plugin.name === identifier);
  if (matches.length === 1 && matches[0]) return matches[0].id;
  if (matches.length > 1) throw ambiguousPluginError(matches.map((plugin) => plugin.id));
  throw new Error(`Plugin not found: ${identifier}`);
}

export function ambiguousPluginError(ids: string[]): Error {
  return new Error(`Plugin name is ambiguous, use <plugin>@<marketplace>: ${ids.join(", ")}`);
}

export function confirmUninstall(ctx: RunContext, pluginId: string): Promise<boolean> {
  return new Promise((resolvePrompt) => {
    const rl = createInterface({ input: ctx.stdin, output: ctx.stdout });
    rl.question(`Uninstall ${pluginId}? [y/N] `, (answer) => {
      rl.close();
      resolvePrompt(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export function reportPluginsError(
  ctx: RunContext,
  options: GlobalOptions,
  error: unknown,
): number {
  const message = error instanceof Error ? error.message : String(error);
  ctx.stderr.write(`Error: ${message}\n`);
  if (options.verbose && error instanceof Error && error.stack) {
    ctx.stderr.write(`${error.stack}\n`);
  }
  return 1;
}
