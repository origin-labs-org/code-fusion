import { app } from "electron";
import { join } from "node:path";
import { CF_ENV } from "@origin-ai/cf-shared";

export function resolveCfBuiltinProviderConfigFilePath(options?: {
  readonly appPath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly isPackaged?: boolean;
  readonly resourcesPath?: string;
}): string {
  const explicitPath = (options?.env ?? process.env)["CF_BUILTIN_PROVIDER_CONFIG_FILE"]?.trim();
  if (explicitPath) return explicitPath;
  if (options?.isPackaged ?? app.isPackaged) {
    return join(
      options?.resourcesPath ?? process.resourcesPath,
      "config/provider/cf-builtin.json",
    );
  }
  const filename = CF_ENV === "production" ? "cf-builtin.json" : "cf-builtin.test.json";
  return join(options?.appPath ?? app.getAppPath(), "../../config/provider", filename);
}
