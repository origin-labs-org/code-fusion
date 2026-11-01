import { afterEach, describe, expect, it, vi } from "vitest";

const { init } = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock("@arms/rum-electron/browser", () => ({
  default: { init },
}));

describe("ARMS Browser init", () => {
  afterEach(() => {
    init.mockReset();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("Explicitly use local development runtime to initialize production product environment as local", async () => {
    vi.stubGlobal("__CF_ENV__", "production");
    vi.stubGlobal("ArmsEventBridge", { send: vi.fn() });
    const { initArmsBrowserRumOnce } = await import("../src/shared/armsBrowserInit.js");

    expect(initArmsBrowserRumOnce("development")).toBe(true);
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ env: "local" }));
  });
});
