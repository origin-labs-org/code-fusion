import { afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

process.env.GIT_CONFIG_COUNT = "2";

if (process.platform === "win32") {
  const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  if (existsSync(join(system32, "tar.exe"))) {
    const entries = (process.env.PATH ?? "").split(";");
    const rest = entries.filter((entry) => entry.toLowerCase() !== system32.toLowerCase());
    process.env.PATH = [system32, ...rest].join(";");
  }
}
process.env.GIT_CONFIG_KEY_0 = "core.autocrlf";
process.env.GIT_CONFIG_VALUE_0 = "false";
process.env.GIT_CONFIG_KEY_1 = "core.eol";
process.env.GIT_CONFIG_VALUE_1 = "lf";
process.env.CF_TEST_RELEASE_TARGET = process.env.CF_TEST_RELEASE_TARGET ?? "darwin";
process.env.CF_TEST_RELEASE_ARCH = process.env.CF_TEST_RELEASE_ARCH ?? "aarch64";
process.env.CF_TEST_CLIENT_CONFIG_PLATFORM = process.env.CF_TEST_CLIENT_CONFIG_PLATFORM ?? "darwin-aarch64";
delete process.env.CF_DATA_BASE_DIR;

afterEach(() => {
  delete process.env.CF_DATA_BASE_DIR;
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();

  return {
    ...actual,
    homedir: () => {
      const envHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
      return envHome && envHome.length > 0 ? envHome : actual.homedir();
    },
  };
});
