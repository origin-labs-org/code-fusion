import { createHash } from "node:crypto";
import { join } from "node:path";

export function resolveCfBuiltinClientPlatform(): string {
  const target = process.platform === "win32" ? "windows" : process.platform;
  const arch =
    process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
  return `${target}-${arch}`;
}

export interface CfBuiltinCachePathOptions {
  readonly environmentConfigRoot: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly cfEndpointOrigin: string;
}

export interface CfBuiltinCachePaths {
  readonly activeFilePath: string;
  readonly controlFilePath: string;
}

export function resolveCfBuiltinCachePaths(
  options: CfBuiltinCachePathOptions,
): CfBuiltinCachePaths {
  const platform = normalizeSegment(options.platform, "platform");
  const appVersion = normalizeSegment(options.appVersion, "appVersion");
  const endpointKey = createCfBuiltinEndpointKey(options.cfEndpointOrigin);
  const directory = join(
    options.environmentConfigRoot,
    "runtime",
    "provider",
    platform,
    appVersion,
    endpointKey,
  );
  return {
    activeFilePath: join(directory, "cf-builtin.json"),
    controlFilePath: join(directory, "cf-builtin-refresh.json"),
  };
}

export function createCfBuiltinEndpointKey(cfEndpointOrigin: string): string {
  const normalized = normalizeCfBuiltinEndpointOrigin(cfEndpointOrigin);
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  return `endpoint-${digest}`;
}

export function normalizeCfBuiltinEndpointOrigin(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("CodeFusion Built-in Endpoint Origin 不能为空");
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CodeFusion Built-in Endpoint Origin 只支持 HTTP(S)");
  }
  return url.origin;
}

function normalizeSegment(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === "." || normalized === ".." || /[\\/]/u.test(normalized)) {
    throw new Error(`CodeFusion Built-in ${name} 不Yes合法路径段`);
  }
  return normalized;
}
