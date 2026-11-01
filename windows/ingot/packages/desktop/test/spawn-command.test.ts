import { describe, expect, it } from "vitest";
import { resolveSpawnRuntimeOptions } from "../../../scripts/spawn-command.mjs";

describe("spawn command runtime options", () => {
  it("Executing pnpm aliases on Windows should also explicitly use shell to let cmd resolve shims", () => {
    expect(resolveSpawnRuntimeOptions("pnpm", "win32")).toEqual({ shell: true });
  });

  it("Executing cmd wrapper scripts on Windows should explicitly use shell", () => {
    expect(resolveSpawnRuntimeOptions("pnpm.cmd", "win32")).toEqual({ shell: true });
  });

  it("非 Windows 平台不应强制为 cmd 包装脚本开启 shell", () => {
    expect(resolveSpawnRuntimeOptions("pnpm.cmd", "darwin")).toEqual({});
  });
});
