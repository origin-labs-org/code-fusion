import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  desktopProductIdentities,
  resolveDesktopArtifactSuffix,
  resolveDesktopProductFlavor,
  resolveWindowsAppUserModelId,
  resolveWindowsAppUserModelIdForFlavor,
  resolveDesktopProductIdentity,
} from "../scripts/desktop-product-identity.mjs";

describe("desktop product identity", () => {
  it("根锁文件的发布版本与构建版本一致", () => {
    const readRootJson = (name: string) =>
      JSON.parse(readFileSync(resolve(import.meta.dirname, "../../..", name), "utf8"));
    const version = readRootJson("package.json").version;
    const lock = readRootJson("package-lock.json");
    expect(lock.version).toBe(version);
    expect(lock.packages[""].version).toBe(version);
  });

  it("CF_ENV=test uses Preview identity installable side-by-side with production", () => {
    expect(resolveDesktopProductIdentity({ CF_ENV: "test" })).toEqual({
      flavor: "preview",
      appId: "dev.cf.app.preview",
      productName: "CodeFusion IDE Preview",
      linuxExecutableName: "cf-preview",
      linuxPackageName: "cf-preview",
      cuaHelperInstallVariant: "preview",
    });
  });

  it("CF_PREVIEW_IDENTITY=1 switches production backend builds to Preview identity", () => {
    for (const flag of ["1", " 1 "]) {
      const env = { CF_ENV: "production", CF_PREVIEW_IDENTITY: flag };
      expect(resolveDesktopProductFlavor(env)).toBe("preview");
      expect(resolveDesktopProductIdentity(env)).toBe(desktopProductIdentities.preview);
    }
    for (const flag of ["", "0"]) {
      const env = { CF_ENV: "production", CF_PREVIEW_IDENTITY: flag };
      expect(resolveDesktopProductFlavor(env)).toBe("production");
    }
  });

  it("Toggle only accepts 1/0: other spellings fail directly at build time, preventing missed route matching while enabling at script level", () => {
    for (const flag of ["true", "yes", "on", "false", "no", "off", "2"]) {
      expect(() =>
        resolveDesktopProductFlavor({ CF_ENV: "production", CF_PREVIEW_IDENTITY: flag }),
      ).toThrow(/expected 1 or 0/);
    }
  });

  it("Test backend is always Preview identity; toggle cannot turn it into official CodeFusion", () => {
    expect(resolveDesktopProductFlavor({ CF_ENV: "test", CF_PREVIEW_IDENTITY: "0" })).toBe(
      "preview",
    );
    expect(resolveDesktopProductFlavor({ CF_ENV: "test", CF_PREVIEW_IDENTITY: "1" })).toBe(
      "preview",
    );
  });

  it("Artifact suffix only indicates backend environment; Preview packages for production backend are distinguished by productName", () => {
    expect(resolveDesktopArtifactSuffix({ CF_ENV: "test" })).toBe("_TEST");
    expect(resolveDesktopArtifactSuffix({ CF_ENV: "production" })).toBe("");
    expect(
      resolveDesktopArtifactSuffix({ CF_ENV: "production", CF_PREVIEW_IDENTITY: "1" }),
    ).toBe("");
    expect(resolveDesktopArtifactSuffix({})).toBe("_TEST");
  });

  it("CF_ENV=production 完整保留正式包身份", () => {
    expect(resolveDesktopProductIdentity({ CF_ENV: "production" })).toBe(
      desktopProductIdentities.production,
    );
    expect(desktopProductIdentities.production).toEqual({
      flavor: "production",
      appId: "dev.cf.app",
      productName: "CodeFusion IDE",
      linuxExecutableName: "cf",
      linuxPackageName: "cf",
      cuaHelperInstallVariant: null,
    });
  });

  it("Do not mistakenly generate official install identity when environment is uninjected or unknown", () => {
    expect(resolveDesktopProductIdentity({}).flavor).toBe("preview");
    expect(resolveDesktopProductIdentity({ CF_ENV: "staging" }).flavor).toBe("preview");
  });

  it("打包态 Windows AUMID 必须和 NSIS appId 保持一致", () => {
    expect(resolveWindowsAppUserModelId({ CF_ENV: "production" })).toBe(
      desktopProductIdentities.production.appId,
    );
    expect(resolveWindowsAppUserModelId({ CF_ENV: "test" })).toBe(
      desktopProductIdentities.preview.appId,
    );
    expect(
      resolveWindowsAppUserModelId({ CF_ENV: "production", CF_PREVIEW_IDENTITY: "1" }),
    ).toBe(desktopProductIdentities.preview.appId);
    expect(resolveWindowsAppUserModelIdForFlavor("preview")).toBe(
      desktopProductIdentities.preview.appId,
    );
    expect(resolveWindowsAppUserModelIdForFlavor("production")).toBe(
      desktopProductIdentities.production.appId,
    );
  });

  it("Development mode continues to use standalone AUMID to avoid polluting packaged Shell identity", () => {
    expect(resolveWindowsAppUserModelId({}, { isPackaged: false })).toBe("cn.aminer.cf");
  });
});
