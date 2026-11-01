import { describe, expect, it } from "vitest";

describe("desktop deep link url helpers", () => {
  it("recognizes only the unified OAuth callback url", async () => {
    const { isOAuthCallbackUrl } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(isOAuthCallbackUrl(new URL("cf://oauth/callback?code=1&state=s"))).toBe(true);
    expect(isOAuthCallbackUrl(new URL("cf://bigmodel-auth/callback?authCode=1&state=s"))).toBe(
      false,
    );
    expect(isOAuthCallbackUrl(new URL("cf://zai-auth/callback?code=1&state=s"))).toBe(false);
    expect(isOAuthCallbackUrl(new URL("cf://oauth/other?code=1&state=s"))).toBe(false);
    expect(isOAuthCallbackUrl(new URL("https://oauth/callback?code=1&state=s"))).toBe(false);
  });

  it("accepts Linux one-slash callback urls", async () => {
    const { isOAuthCallbackUrl, isPaymentCallbackUrl } =
      await import("../src/main/desktopDeepLinkUrl.js");

    expect(isOAuthCallbackUrl(new URL("cf:/oauth/callback?code=1&state=s"))).toBe(true);
    expect(isOAuthCallbackUrl(new URL("cf:oauth/callback?code=1&state=s"))).toBe(true);
    expect(isPaymentCallbackUrl(new URL("cf:/payment/callback?status=return"))).toBe(true);
    expect(isPaymentCallbackUrl(new URL("cf:payment/callback?status=cancel"))).toBe(true);
  });

  it("recognizes payment callback urls separately from OAuth", async () => {
    const { isOAuthCallbackUrl, isPaymentCallbackUrl } =
      await import("../src/main/desktopDeepLinkUrl.js");

    const paymentUrl = new URL("cf://payment/callback?provider=zai&channel=paypal");
    expect(isPaymentCallbackUrl(paymentUrl)).toBe(true);
    expect(isOAuthCallbackUrl(paymentUrl)).toBe(false);
    expect(isPaymentCallbackUrl(new URL("cf://payment/other"))).toBe(false);
  });

  it("recognizes workspace open urls and extracts the encoded folder path", async () => {
    const { extractWorkspaceOpenPath, isWorkspaceOpenUrl } =
      await import("../src/main/desktopDeepLinkUrl.js");

    const workspaceUrl = new URL("cf://workspace/open?path=%2FUsers%2Fdemo%2FProject%20A%26B");
    expect(isWorkspaceOpenUrl(workspaceUrl)).toBe(true);
    expect(extractWorkspaceOpenPath(workspaceUrl)).toBe("/Users/demo/Project A&B");
    expect(isWorkspaceOpenUrl(new URL("cf://workspace/other?path=%2Ftmp"))).toBe(false);
    expect(extractWorkspaceOpenPath(new URL("cf://workspace/open"))).toBeNull();
  });

  it("Only accept share import code without extra sensitive parameters", async () => {
    const { extractShareImportCode, isShareImportUrl } =
      await import("../src/main/desktopDeepLinkUrl.js");
    const valid = new URL("cf://share/import?code=abc_DEF-123");
    expect(isShareImportUrl(valid)).toBe(true);
    expect(extractShareImportCode(valid)).toBe("abc_DEF-123");
    expect(extractShareImportCode(new URL("cf://share/import"))).toBeNull();
    expect(extractShareImportCode(new URL("cf://share/import?code=bad%2Fcode"))).toBeNull();
    expect(isShareImportUrl(new URL("https://share/import?code=abc"))).toBe(false);
  });

  it("extracts protocol urls from desktop argv variants", async () => {
    const { extractDeepLinkUrlFromArgs } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(
      extractDeepLinkUrlFromArgs(["/opt/CodeFusion/cf", "cf://oauth/callback?code=1&state=s"]),
    ).toBe("cf://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/opt/CodeFusion/cf",
        "--open-url=cf://oauth/callback?code=1&state=s",
      ]),
    ).toBe("cf://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/opt/CodeFusion/cf",
        "cf%3A%2F%2Foauth%2Fcallback%3Fcode%3D1%26state%3Ds",
      ]),
    ).toBe("cf://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/opt/CodeFusion/cf",
        "cf%253A%252F%252Foauth%252Fcallback%253Fcode%253D1%2526state%253Ds",
      ]),
    ).toBe("cf://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs(["/opt/CodeFusion/cf", "cf://oauth/callback?code=1", "&state=s"]),
    ).toBe("cf://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs(["/opt/CodeFusion/cf", "cf://oauth/callback?code=1&amp;state=s"]),
    ).toBe("cf://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/opt/CodeFusion/cf",
        "cf://payment/callback?provider=zai",
        "&channel=paypal",
        "&status=return",
      ]),
    ).toBe("cf://payment/callback?provider=zai&channel=paypal&status=return");
    expect(
      extractDeepLinkUrlFromArgs([
        "/Applications/CodeFusion.app/Contents/MacOS/CodeFusion",
        "cf://workspace/open?path=%2FUsers%2Fdemo%2FProject%2520A",
      ]),
    ).toBe("cf://workspace/open?path=%2FUsers%2Fdemo%2FProject%2520A");
  });

  it("returns null when argv does not contain a deep link", async () => {
    const { extractDeepLinkUrlFromArgs } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(extractDeepLinkUrlFromArgs(["/opt/CodeFusion/cf", "--no-sandbox"])).toBeNull();
  });

  it("extracts Windows open workspace argv without URL decoding", async () => {
    const { extractOpenWorkspacePathFromArgs } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(
      extractOpenWorkspacePathFromArgs([
        "C:\\Program Files\\CodeFusion\\CodeFusion.exe",
        "--open-workspace",
        "C:\\Users\\demo\\Project A&B#1",
      ]),
    ).toBe("C:\\Users\\demo\\Project A&B#1");
    expect(
      extractOpenWorkspacePathFromArgs([
        "C:\\Program Files\\CodeFusion\\CodeFusion.exe",
        "--open-workspace=C:\\Users\\demo\\Project%20A",
      ]),
    ).toBe("C:\\Users\\demo\\Project%20A");
    expect(extractOpenWorkspacePathFromArgs(["CodeFusion.exe", "--open-workspace", 'C:"'])).toBe("C:\\");
    expect(extractOpenWorkspacePathFromArgs(["CodeFusion.exe", "--open-workspace", 'C:\\repo"'])).toBe(
      "C:\\repo\\",
    );
    expect(extractOpenWorkspacePathFromArgs(["CodeFusion.exe", "--open-workspace"])).toBeNull();
  });

  it("passes parsed deep links through single instance additionalData", async () => {
    const {
      createDeepLinkSingleInstanceData,
      extractDeepLinkUrlFromSingleInstanceData,
      extractOpenWorkspacePathFromSingleInstanceData,
    } = await import("../src/main/desktopDeepLinkUrl.js");

    const additionalData = createDeepLinkSingleInstanceData([
      "/opt/CodeFusion/cf",
      "cf%253A%252F%252Foauth%252Fcallback%253Fcode%253D1%2526state%253Ds",
      "--open-workspace=C:\\Users\\demo\\Project A",
    ]);

    expect(extractDeepLinkUrlFromSingleInstanceData(additionalData)).toBe(
      "cf://oauth/callback?code=1&state=s",
    );
    expect(extractOpenWorkspacePathFromSingleInstanceData(additionalData)).toBe(
      "C:\\Users\\demo\\Project A",
    );
    expect(extractDeepLinkUrlFromSingleInstanceData({ deepLinkUrl: "https://example.com" })).toBe(
      null,
    );
  });

  it("builds Windows Explorer registry operations for folder context menu", async () => {
    const { buildWindowsOpenFolderCommand, buildWindowsOpenFolderRegistryOperations } =
      await import("../src/main/desktopWindowsOpenFolderContextMenu.js");

    expect(buildWindowsOpenFolderCommand("C:\\Program Files\\CodeFusion\\CodeFusion.exe")).toBe(
      '"C:\\Program Files\\CodeFusion\\CodeFusion.exe" --open-workspace "%1"',
    );
    expect(
      buildWindowsOpenFolderCommand("C:\\Electron\\electron.exe", ["C:\\repo\\desktop\\main.js"]),
    ).toBe('"C:\\Electron\\electron.exe" "C:\\repo\\desktop\\main.js" --open-workspace "%1"');

    const operations = buildWindowsOpenFolderRegistryOperations({
      executablePath: "C:\\Program Files\\CodeFusion\\CodeFusion.exe",
      locale: "en-US",
    });

    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\CodeFusion.OpenInCf\\command",
        "/ve",
        "/d",
        '"C:\\Program Files\\CodeFusion\\CodeFusion.exe" --open-workspace "%1"',
        "/f",
      ],
    });
    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Drive\\shell\\CodeFusion.OpenInCf\\command",
        "/ve",
        "/d",
        '"C:\\Program Files\\CodeFusion\\CodeFusion.exe" --open-workspace "%1"',
        "/f",
      ],
    });
  });

  it("builds localized Windows Explorer registry menu labels", async () => {
    const { buildWindowsOpenFolderRegistryOperations, getWindowsOpenFolderMenuName } =
      await import("../src/main/desktopWindowsOpenFolderContextMenu.js");

    expect(getWindowsOpenFolderMenuName("zh-CN")).toBe("在CodeFusion中打开");
    expect(getWindowsOpenFolderMenuName("en-US")).toBe("Open in CodeFusion");

    const operations = buildWindowsOpenFolderRegistryOperations({
      executablePath: "C:\\Program Files\\CodeFusion\\CodeFusion.exe",
      locale: "zh-CN",
    });

    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\CodeFusion.OpenInCf",
        "/ve",
        "/d",
        "在CodeFusion中打开",
        "/f",
      ],
    });
    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\CodeFusion.OpenInCf",
        "/v",
        "MUIVerb",
        "/t",
        "REG_SZ",
        "/d",
        "在CodeFusion中打开",
        "/f",
      ],
    });
  });
});
