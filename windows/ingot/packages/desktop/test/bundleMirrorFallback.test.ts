import { describe, expect, it, vi } from "vitest";

vi.mock("../../../scripts/intranetDefaults.mjs", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveIntranetDepsBaseUrl: () => {
    throw new Error("Configure CF_DEPS_BASE_URL or INTRANET_MACHINE_HOST");
  },
}));

const { OFFICIAL_ELECTRON_BUILDER_BINARIES_MIRROR, resolveElectronBuilderBinariesMirror } =
  await import("../scripts/bundle.mjs");

describe("未配置内网依赖源时的 electron-builder binaries 镜像", () => {
  it("Fall back to official release download URL; packaging will not fail due to missing internal address", () => {
    expect(resolveElectronBuilderBinariesMirror({})).toBe(
      OFFICIAL_ELECTRON_BUILDER_BINARIES_MIRROR,
    );
  });

  it("Explicitly configured mirrors still take precedence", () => {
    expect(
      resolveElectronBuilderBinariesMirror({
        ELECTRON_BUILDER_BINARIES_MIRROR: "https://example.test/electron-builder-binaries/",
      }),
    ).toBe("https://example.test/electron-builder-binaries/");
  });
});
