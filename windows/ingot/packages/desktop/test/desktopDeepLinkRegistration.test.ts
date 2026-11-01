import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDeepLinkProtocol } from "@desktop/main/desktopOAuthDeepLink";
import {
  createDeepLinkSingleInstanceData,
  extractDeepLinkUrlFromArgs,
  extractDeepLinkUrlFromSingleInstanceData,
} from "@desktop/main/desktopDeepLinkUrl";

const mocks = vi.hoisted(() => ({
  register: vi.fn(() => true),
  registerLinux: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    setAsDefaultProtocolClient: mocks.register,
    isPackaged: true,
    name: "CodeFusion",
    getPath: () => "/test-home",
  },
  BrowserWindow: {},
  dialog: {},
}));
vi.mock("@desktop/main/desktopLinuxDeepLinkRegistration", () => ({
  registerLinuxDeepLinkProtocol: mocks.registerLinux,
}));

const defaultAppDescriptor = Object.getOwnPropertyDescriptor(process, "defaultApp");
const logger = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.register.mockReturnValue(true);
  Object.defineProperty(process, "defaultApp", { configurable: true, value: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (defaultAppDescriptor) {
    Object.defineProperty(process, "defaultApp", defaultAppDescriptor);
  } else {
    Reflect.deleteProperty(process, "defaultApp");
  }
});

describe("Windows Deep Link startup argument boundaries", () => {
  it("In production, overwrite each registration with a template containing parameter delimiters", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    registerDeepLinkProtocol(logger);
    registerDeepLinkProtocol(logger);

    expect(mocks.register.mock.calls).toEqual([
      ["cf", process.execPath, ["--"]],
      ["cf", process.execPath, ["--"]],
    ]);
  });

  it("In development, entry stays before the delimiter; external URLs can only be appended after delimiter", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    Object.defineProperty(process, "defaultApp", { configurable: true, value: true });
    const entry = resolve("开发项目 with spaces", "main.js");
    vi.spyOn(process, "argv", "get").mockReturnValue([process.execPath, entry]);

    registerDeepLinkProtocol(logger);

    expect(mocks.register).toHaveBeenCalledWith("cf", process.execPath, [entry, "--"]);
  });

  it("Still log warning on safe registration failure", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    mocks.register.mockReturnValue(false);

    registerDeepLinkProtocol(logger);

    expect(logger.warn).toHaveBeenCalledWith("[deep-link] 注册协议失败", { scheme: "cf" });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each([
    "cf://oauth/callback?code=code%20value&state=state",
    "cf://payment/callback?provider=zai&status=return",
    "cf://workspace/open?path=C%3A%5CProject%20A%26B",
    "cf://share/import?code=abc_DEF-123",
  ])("Delimiter preserves normal URLs in cold start and single-instance delivery: %s", (url) => {
    const argv = [process.execPath, "--", url];
    expect(extractDeepLinkUrlFromArgs(argv)).toBe(url);
    expect(extractDeepLinkUrlFromSingleInstanceData(createDeepLinkSingleInstanceData(argv))).toBe(
      url,
    );
  });
});

describe("非 Windows 注册兼容性", () => {
  it.each(["darwin", "linux"] as const)("%s retains production registration calls", (platform) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);

    registerDeepLinkProtocol(logger);

    expect(mocks.register).toHaveBeenCalledWith("cf");
    expect(mocks.registerLinux).toHaveBeenCalledTimes(platform === "linux" ? 1 : 0);
  });

  it.each(["darwin", "linux"] as const)("%s retains development registration entry", (platform) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    Object.defineProperty(process, "defaultApp", { configurable: true, value: true });
    const entry = resolve("desktop", "main.js");
    vi.spyOn(process, "argv", "get").mockReturnValue([process.execPath, entry]);

    registerDeepLinkProtocol(logger);

    expect(mocks.register).toHaveBeenCalledWith("cf", process.execPath, [entry]);
    expect(mocks.registerLinux).not.toHaveBeenCalled();
  });
});
