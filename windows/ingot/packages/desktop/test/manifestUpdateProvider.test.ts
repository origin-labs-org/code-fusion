import {
  AppImageUpdater,
  DebUpdater,
  RpmUpdater,
  PacmanUpdater,
  MacUpdater,
  NsisUpdater,
} from "electron-updater";
import { findFile } from "electron-updater/out/providers/Provider.js";
import { describe, expect, it } from "vitest";
import {
  buildElectronManifestUrl,
  getElectronReleasePlatform,
  ManifestUpdateProvider,
} from "@desktop/main/manifestUpdateProvider.js";

describe("ManifestUpdateProvider helpers", () => {
  it("maps Electron runtime platform and arch to release platform names", () => {
    expect(getElectronReleasePlatform("darwin", "arm64")).toBe("darwin-aarch64");
    expect(getElectronReleasePlatform("darwin", "x64")).toBe("darwin-x86_64");
    expect(getElectronReleasePlatform("win32", "x64")).toBe("windows-x86_64");
    expect(getElectronReleasePlatform("linux", "arm64")).toBe("linux-aarch64");
  });

  it("builds the server manifest URL with platform, device_mid, and numeric channel", () => {
    const url = buildElectronManifestUrl({
      endpointOrigin: "https://cf.example.test/base/path",
      platform: "darwin-aarch64",
      deviceMid: "mid-1",
      channel: "preview",
    });

    expect(url.origin).toBe("https://cf.example.test");
    expect(url.pathname).toBe("/api/v1/releases/electron/manifest");
    expect(url.searchParams.get("platform")).toBe("darwin-aarch64");
    expect(url.searchParams.get("device_mid")).toBe("mid-1");
    expect(url.searchParams.get("channel")).toBe("3");
  });

  it("overrides existing manifest URL query with runtime platform, device, and channel", () => {
    const url = buildElectronManifestUrl({
      endpointOrigin: "https://cf.example.test",
      manifestUrl:
        "https://cf.z.ai/api/v1/releases/electron/manifest?platform=old&device_mid=old&channel=old",
      platform: "darwin-aarch64",
      deviceMid: "mid-1",
      channel: "stable",
    });

    expect(url.origin).toBe("https://cf.z.ai");
    expect(url.pathname).toBe("/api/v1/releases/electron/manifest");
    expect(url.searchParams.get("platform")).toBe("darwin-aarch64");
    expect(url.searchParams.get("device_mid")).toBe("mid-1");
    expect(url.searchParams.get("channel")).toBe("1");
  });
});

const linuxUpdaters = [
  [AppImageUpdater, "AppImage"],
  [DebUpdater, "deb"],
  [RpmUpdater, "rpm"],
  [PacmanUpdater, "pkg.tar.zst"],
] as const;

function createProvider(
  Updater: typeof AppImageUpdater | typeof DebUpdater | typeof RpmUpdater | typeof PacmanUpdater,
) {
  return new ManifestUpdateProvider(
    { provider: "custom", endpointOrigin: "https://cf.example.test" },
    Object.create(Updater.prototype),
    { platform: "linux", isUseMultipleRangeRequest: false, executor: {} as never },
  );
}

const artifacts = ["AppImage", "deb", "rpm", "pkg.tar.zst"].map((extension) => ({
  url: `https://cdn.example.test/releases/CodeFusion-3.12.2-linux-x64.${extension}`,
  sha512: `checksum-${extension}`,
}));
const manifest = { version: "3.12.2", releaseDate: "2026-09-16", files: artifacts };

describe("Linux manifest and real updater file selection contract", () => {
  it.each(linuxUpdaters)("%s 从混合清单选择当前安装格式 %s", (Updater, extension) => {
    const resolved = createProvider(Updater).resolveFiles(manifest);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.url.href).toBe(artifacts.find((file) => file.url.endsWith(extension))?.url);
    expect(resolved[0]?.info.sha512).toBe(`checksum-${extension}`);
    const selected = findFile(
      resolved,
      extension === "pkg.tar.zst" ? "pacman" : extension,
      ["AppImage", "deb", "rpm", "pacman"].filter((item) => item !== extension),
    );
    expect(selected).toBe(resolved[0]);
  });

  it.each(linuxUpdaters)("%s 缺少 %s 时不回退其他安装格式", (Updater, extension) => {
    expect(() =>
      createProvider(Updater).resolveFiles({
        ...manifest,
        files: artifacts.filter((file) => !file.url.endsWith(extension)),
      }),
    ).toThrow("Manifest contains no update file for");
  });

  it.each(linuxUpdaters)("%s supports relative URLs, query parameters, and case sensitivity %s", (Updater, extension) => {
    const url = `releases/CodeFusion.${extension.toUpperCase()}?download=1`;
    const [file] = createProvider(Updater).resolveFiles({
      ...manifest,
      files: [{ url, sha512: "checksum" }],
    });
    expect(file?.url.href).toBe(`https://cf.example.test/${url}`);
    expect(file?.info.sha512).toBe("checksum");
  });

  it("Pacman uses safe local filenames while real download URLs and original manifest remain unchanged", () => {
    const [file] = createProvider(PacmanUpdater).resolveFiles(manifest);
    expect(file?.info.url).toBe("CodeFusion-3.12.2-linux-x64.pkg.tar.zst");
    expect(file?.url.href).toBe(artifacts[3]?.url);
  });

  it("兼容旧 pacman 后缀", () => {
    expect(
      createProvider(PacmanUpdater).resolveFiles({
        ...manifest,
        files: [{ url: "cf.pacman", sha512: "checksum" }],
      })[0]?.url.pathname,
    ).toBe("/cf.pacman");
  });

  it("Selected file must still contain checksum", () => {
    expect(() =>
      createProvider(DebUpdater).resolveFiles({
        ...manifest,
        files: [{ url: "cf.deb", sha512: "" }],
      }),
    ).toThrow("missing checksum");
  });
});

describe("Keep macOS / Windows update parsing compatible", () => {
  it.each([
    [MacUpdater, "darwin", "zip", "dmg"],
    [NsisUpdater, "win32", "exe", "zip"],
  ] as const)("%s preserves manifest, letting original updater select %s %s", (Updater, platform, extension, other) => {
    const provider = new ManifestUpdateProvider(
      { provider: "custom", endpointOrigin: "https://cf.example.test" },
      Object.create(Updater.prototype),
      { platform, isUseMultipleRangeRequest: false, executor: {} as never },
    );
    const files = [other, extension].map((ext) => ({ url: `releases/CodeFusion.${ext}`, sha512: ext }));
    const resolved = provider.resolveFiles({ ...manifest, files });
    expect(resolved).toHaveLength(2);
    expect(findFile(resolved, extension)?.info.sha512).toBe(extension);
    expect(resolved.map((file) => file.info)).toEqual(files);
  });

  it("兼容旧 manifest 的 path 与 sha512", () => {
    const provider = createProvider(DebUpdater);
    const resolved = provider.resolveFiles({
      ...manifest,
      files: [],
      path: "CodeFusion.deb",
      sha512: "legacy",
    });
    expect(resolved[0]?.url.href).toBe("https://cf.example.test/CodeFusion.deb");
    expect(resolved[0]?.info.sha512).toBe("legacy");
  });
});
