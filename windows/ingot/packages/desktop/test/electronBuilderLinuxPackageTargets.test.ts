import { describe, expect, it } from "vitest";
import desktopBuilderConfig from "../electron-builder.config.js";
import { resolveDesktopProductIdentity } from "../scripts/desktop-product-identity.mjs";

describe("electron-builder Linux build targets", () => {
  it("prereleases also generate unified latest.yml", () => {
    expect(desktopBuilderConfig.detectUpdateChannel).toBe(false);
  });

  it("Linux simultaneously produces AppImage, deb, rpm, and pacman packages", () => {
    const targets = desktopBuilderConfig.linux?.target ?? [];

    expect(targets).toContain("AppImage");
    expect(targets).toContain("deb");
    expect(targets).toContain("rpm");
    expect(targets).toContain("pacman");
  });

  it("packageName for rpm and deb is split by flavor and kept consistent", () => {
    const identity = resolveDesktopProductIdentity();

    expect(desktopBuilderConfig.rpm?.packageName).toBe(identity.linuxPackageName);
    expect(desktopBuilderConfig.deb?.packageName).toBe(identity.linuxPackageName);
    expect(desktopBuilderConfig.pacman?.packageName).toBe(identity.linuxPackageName);
  });

  it("rpm appends Requires for runtime libraries actually needed by Electron via fpm", () => {
    expect(desktopBuilderConfig.rpm?.fpm).toContain("mesa-libgbm");
    expect(desktopBuilderConfig.rpm?.fpm).toContain("alsa-lib");
    expect(desktopBuilderConfig.rpm?.fpm).toContain("-d");
  });

  it("pacman uses Arch native .pkg.tar.zst extension", () => {
    expect(desktopBuilderConfig.pacman?.artifactName).toContain(".pkg.tar.zst");
  });

  it("pacman explicitly declares Arch runtime libraries needed for Electron startup", () => {
    const dependencies = desktopBuilderConfig.pacman?.depends ?? [];

    expect(dependencies).toEqual([
      "gtk3",
      "nss",
      "libxss",
      "libxtst",
      "libnotify",
      "alsa-lib",
      "mesa",
      "xdg-utils",
    ]);
  });

  it("pacman does not explicitly override electron-builder default compression format", () => {
    expect(desktopBuilderConfig.pacman?.compression).toBeUndefined();
  });
});
