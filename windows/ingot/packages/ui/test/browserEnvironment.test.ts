import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSafeLocalStorage,
  getSafeReadableLocalStorage,
  readSafeLocalStorage,
  writeSafeLocalStorage,
} from "@/lib/browserEnvironment.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserEnvironment localStorage helpers", () => {
  it("无 window 和 localStorage 时安全返回空值", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("localStorage", undefined);

    expect(getSafeReadableLocalStorage()).toBeNull();
    expect(getSafeLocalStorage()).toBeNull();
    expect(readSafeLocalStorage("cf-locale")).toBeNull();
    expect(() => writeSafeLocalStorage("cf-locale", "zh-CN")).not.toThrow();
  });

  it("localStorage getter 抛错时读写都不抛出", () => {
    const windowStub = {};
    Object.defineProperty(windowStub, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    vi.stubGlobal("window", windowStub);

    expect(getSafeReadableLocalStorage()).toBeNull();
    expect(getSafeLocalStorage()).toBeNull();
    expect(readSafeLocalStorage("cf-locale")).toBeNull();
    expect(() => writeSafeLocalStorage("cf-locale", "zh-CN")).not.toThrow();
  });

  it("Read-only storage exposes read capability only; do not return as writable storage", () => {
    const storage = {
      getItem: vi.fn(() => "en-US"),
    };
    vi.stubGlobal("window", { localStorage: storage });

    expect(getSafeReadableLocalStorage()).toBe(storage);
    expect(getSafeLocalStorage()).toBeNull();
    expect(readSafeLocalStorage("cf-locale")).toBe("en-US");
    expect(() => writeSafeLocalStorage("cf-locale", "zh-CN")).not.toThrow();
  });
});
