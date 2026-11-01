import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { ensureSshRemoteReleaseAssets } from "./e2e/helpers/e2e-ssh-remote-release-assets.js";

const RELEASE_DIR = "/repo/packages/desktop/mock-cdn/releases/3.12.0";
const RELEASE_FILES = [
  "source-server-release.json",
  "cf-server-linux-x64.tar.gz",
  "cf-server-linux-arm64.tar.gz",
  "cf-server-darwin-x64.tar.gz",
  "cf-server-darwin-arm64.tar.gz",
];

function createFakeExists(existing: Set<string>) {
  return vi.fn((path: string) => existing.has(path.split("\\").join("/")));
}

describe("ensureSshRemoteReleaseAssets", () => {
  it("skips prepare when the descriptor and all four target archives exist", () => {
    const prepareReleaseAssets = vi.fn();
    const exists = createFakeExists(new Set(RELEASE_FILES.map((name) => `${RELEASE_DIR}/${name}`)));

    const prepared = ensureSshRemoteReleaseAssets({
      exists,
      prepareReleaseAssets,
      releaseDir: RELEASE_DIR,
    });

    expect(prepared).toBe(false);
    expect(prepareReleaseAssets).not.toHaveBeenCalled();
  });

  it("does not treat legacy manifest-<platform>.json files as a complete release", () => {
    const existing = new Set(
      ["linux-arm64", "linux-x64", "darwin-arm64", "darwin-x64"].map(
        (platform) => `${RELEASE_DIR}/manifest-${platform}.json`,
      ),
    );
    const exists = createFakeExists(existing);
    const prepareReleaseAssets = vi.fn(() => {
      for (const name of RELEASE_FILES) existing.add(`${RELEASE_DIR}/${name}`);
    });

    const prepared = ensureSshRemoteReleaseAssets({
      exists,
      prepareReleaseAssets,
      releaseDir: RELEASE_DIR,
    });

    expect(prepared).toBe(true);
    expect(prepareReleaseAssets).toHaveBeenCalledOnce();
  });

  it("re-prepares when the release dir exists but the descriptor is missing", () => {
    const existing = new Set(
      RELEASE_FILES.filter((name) => name !== "source-server-release.json").map(
        (name) => `${RELEASE_DIR}/${name}`,
      ),
    );
    const exists = createFakeExists(existing);
    const prepareReleaseAssets = vi.fn(() => {
      existing.add(`${RELEASE_DIR}/source-server-release.json`);
    });

    const prepared = ensureSshRemoteReleaseAssets({
      exists,
      prepareReleaseAssets,
      releaseDir: RELEASE_DIR,
    });

    expect(prepared).toBe(true);
    expect(prepareReleaseAssets).toHaveBeenCalledOnce();
  });

  it("runs prepare when the release dir is missing and the assets appear afterwards", () => {
    const exists = vi.fn(() => false);
    const prepareReleaseAssets = vi.fn(() => {
      exists.mockReturnValue(true);
    });

    const prepared = ensureSshRemoteReleaseAssets({
      exists,
      prepareReleaseAssets,
      releaseDir: RELEASE_DIR,
    });

    expect(prepared).toBe(true);
    expect(prepareReleaseAssets).toHaveBeenCalledOnce();
  });

  it("stays fail-closed and names the missing archives when prepare does not complete", () => {
    const prepareReleaseAssets = vi.fn();
    const existing = new Set([
      `${RELEASE_DIR}/source-server-release.json`,
      `${RELEASE_DIR}/cf-server-linux-x64.tar.gz`,
    ]);

    expect(() =>
      ensureSshRemoteReleaseAssets({
        exists: createFakeExists(existing),
        prepareReleaseAssets,
        releaseDir: RELEASE_DIR,
      }),
    ).toThrow(
      /prepare:remote-assets.*\/releases\/3\.12\.0.*cf-server-linux-arm64\.tar\.gz, cf-server-darwin-x64\.tar\.gz, cf-server-darwin-arm64\.tar\.gz/u,
    );
    expect(prepareReleaseAssets).toHaveBeenCalledOnce();
  });
});

describe("wdio.conf.ts SSH remote assets wiring", () => {
  it("auto-prepares missing remote release assets via the root prepare:remote-assets script", () => {
    const source = readFileSync(new URL("../wdio.conf.ts", import.meta.url), "utf8");
    const stageDesktopE2EAppOutput = source.slice(
      source.indexOf("async function stageDesktopE2EAppOutput()"),
      source.indexOf("function isRendererE2EStoreBridgeCompiled"),
    );

    expect(stageDesktopE2EAppOutput).toContain("ensureSshRemoteReleaseAssets(");
    expect(stageDesktopE2EAppOutput).not.toContain("SSH remote assets missing");
    expect(stageDesktopE2EAppOutput).toMatch(
      /runPnpmWorkspaceCommand\(\["prepare:remote-assets"\]/u,
    );
    expect(stageDesktopE2EAppOutput).not.toMatch(/@cf\/desktop",\s*"prepare:remote-assets/u);
    expect(stageDesktopE2EAppOutput).toContain("timeoutMs: ");
  });
});
