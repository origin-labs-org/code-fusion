import { describe, expect, it } from "vitest";
import { resolveWebRemoteControlInitialTheme } from "#src/web-remote-control/index.js";

describe("resolveWebRemoteControlInitialTheme", () => {
  it("uses the QR theme only when mobile localStorage has no theme", () => {
    expect(
      resolveWebRemoteControlInitialTheme({
        storedTheme: null,
        qrTheme: "cf-dark",
      }),
    ).toBe("cf-dark");
  });

  it("keeps the mobile local theme once the phone has chosen one", () => {
    expect(
      resolveWebRemoteControlInitialTheme({
        storedTheme: "light",
        qrTheme: "cf-dark",
      }),
    ).toBe("cf-light");
  });

  it("treats removed theme values as invalid", () => {
    expect(
      resolveWebRemoteControlInitialTheme({
        storedTheme: null,
        qrTheme: "legacy-dark",
      }),
    ).toBe("cf-dark");
  });

  it("falls back to the web default when neither side provides a valid theme", () => {
    expect(
      resolveWebRemoteControlInitialTheme({
        storedTheme: "midnight",
        qrTheme: undefined,
      }),
    ).toBe("cf-dark");
  });

  it("allows the share page to default to light without overriding an explicit theme", () => {
    expect(
      resolveWebRemoteControlInitialTheme({
        storedTheme: "midnight",
        qrTheme: undefined,
        defaultTheme: "cf-light",
      }),
    ).toBe("cf-light");
    expect(
      resolveWebRemoteControlInitialTheme({
        storedTheme: "cf-dark",
        qrTheme: undefined,
        defaultTheme: "cf-light",
      }),
    ).toBe("cf-dark");
  });
});
