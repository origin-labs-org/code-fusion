import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const repositoryRoot = resolve(import.meta.dirname, "..");

/** @param {{root?: string, env?: Record<string, string | undefined>}} options */
export async function resolveBuiltinProviderBuildEnvironment({
  root = repositoryRoot,
  env = process.env,
} = {}) {
  let value = env.CF_ENV;
  if (!value?.trim()) {
    const files = [
      ".env",
      ...(env.NODE_ENV === "production"
        ? [".env.production"]
        : [".env.development", ".env.development.local"]),
    ];
    for (const file of files) {
      let content;
      try {
        content = await readFile(resolve(root, file), "utf8");
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const parsed = parseEnv(content);
      if (parsed.CF_ENV !== undefined) value = parsed.CF_ENV;
    }
  }
  const normalized = value?.trim().toLowerCase() || "test";
  if (normalized !== "test" && normalized !== "production") {
    throw new Error(`Invalid CF_ENV for Built-in Provider build: ${normalized}`);
  }
  return normalized;
}

/** @param {{root?: string, env?: Record<string, string | undefined>}} options */
export async function loadBuiltinProviderConfig({ root = repositoryRoot, env = process.env } = {}) {
  const environment = await resolveBuiltinProviderBuildEnvironment({ root, env });
  const filename = environment === "production" ? "cf-builtin.json" : "cf-builtin.test.json";
  const sourcePath = resolve(root, "config/provider", filename);
  try {
    const content = await readFile(sourcePath, "utf8");
    const { decodeCfBuiltinRelease } = await tsImport(
      pathToFileURL(resolve(repositoryRoot, "packages/provider-node/src/cf-builtin-release.ts"))
        .href,
      import.meta.url,
    );
    decodeCfBuiltinRelease(JSON.parse(content));
    return { environment, sourcePath, content };
  } catch (error) {
    throw new Error(`Invalid Built-in Provider config (${environment}): ${sourcePath}`, {
      cause: error,
    });
  }
}

/** @param {{directory: string, root?: string, env?: Record<string, string | undefined>}} options */
export async function stageBuiltinProviderConfig({ directory, ...options }) {
  const config = await loadBuiltinProviderConfig(options);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "cf-builtin.json"), config.content, "utf8");
  return config;
}
