import { join } from "node:path";

export const WINDOWS_CUA_DEV_ROOT_ENV = "CF_CUA_DEV_ROOT";

export const WINDOWS_CUA_PRODUCER_SEGMENTS = ["packages", "cf-cua"];

export function resolveDevDesktopWindowsCuaEnv({ platform, repoRoot, env }) {
  if (platform !== "win32") return {};
  if (typeof repoRoot !== "string" || !repoRoot.trim()) {
    throw new Error("[dev-desktop-cua-env] repoRoot is required to resolve the Windows CUA root");
  }
  if (!env || typeof env !== "object") {
    throw new Error("[dev-desktop-cua-env] env is required to resolve the Windows CUA root");
  }
  if (env[WINDOWS_CUA_DEV_ROOT_ENV]?.trim()) return {};
  return { [WINDOWS_CUA_DEV_ROOT_ENV]: join(repoRoot, ...WINDOWS_CUA_PRODUCER_SEGMENTS) };
}
