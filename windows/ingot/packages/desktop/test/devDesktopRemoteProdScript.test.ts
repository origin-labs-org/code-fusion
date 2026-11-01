import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDesktopRemoteProdEnv,
  resolvePnpmCommand,
  resolveProductionRemoteAssetCacheDir,
} from "../../../scripts/dev-desktop-remote-prod.mjs";

const rootPackageJsonPath = resolve(import.meta.dirname, "../../../package.json");
const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf8")) as {
  scripts: Record<string, string | undefined>;
};

describe("dev desktop remote production-like script", () => {
  it("Root package.json should provide a desktop dev startup script with production-like remote behavior", () => {
    expect(rootPackageJson.scripts["dev:desktop:remote-prod"]).toBe(
      "node scripts/dev-desktop-remote-prod.mjs",
    );
  });

  it("macOS should default to reusing the production CodeFusion remote cache", () => {
    expect(resolveProductionRemoteAssetCacheDir({}, "darwin", "/Users/alice")).toBe(
      "/Users/alice/Library/Application Support/CodeFusion/remote-assets-cache",
    );
  });

  it("Linux should default to reusing the production CodeFusion remote cache", () => {
    expect(resolveProductionRemoteAssetCacheDir({}, "linux", "/home/alice")).toBe(
      "/home/alice/.config/CodeFusion/remote-assets-cache",
    );
    expect(
      resolveProductionRemoteAssetCacheDir(
        { XDG_CONFIG_HOME: "/home/alice/.config-custom" },
        "linux",
        "/home/alice",
      ),
    ).toBe("/home/alice/.config-custom/CodeFusion/remote-assets-cache");
  });

  it("Windows should default to reusing the production CodeFusion remote cache", () => {
    expect(
      resolveProductionRemoteAssetCacheDir(
        { APPDATA: "C:\\Users\\Alice\\AppData\\Roaming" },
        "win32",
        "C:\\Users\\Alice",
      ),
    ).toBe("C:\\Users\\Alice\\AppData\\Roaming\\CodeFusion\\remote-assets-cache");
  });

  it("Startup env should force CDN usage, allowing explicit cache overrides", () => {
    const env = buildDesktopRemoteProdEnv(
      {
        CF_ENV: "test",
        CF_DEV_REMOTE_ASSET_USE_CDN: "0",
        CF_REMOTE_ASSET_CACHE_DIR: "/tmp/custom-cache",
      },
      "darwin",
      "/Users/alice",
    );

    expect(env.CF_ENV).toBe("production");
    expect(env.CF_DEV_REMOTE_ASSET_USE_CDN).toBe("1");
    expect(env.CF_REMOTE_ASSET_CACHE_DIR).toBe("/tmp/custom-cache");
  });

  it("Use pnpm.cmd for startup on Windows", () => {
    expect(resolvePnpmCommand("win32")).toBe("pnpm.cmd");
    expect(resolvePnpmCommand("darwin")).toBe("pnpm");
  });
});
