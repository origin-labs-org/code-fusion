import { describe, expect, it } from "vitest";
import {
  createDesktopProductionBuildPlan,
  resolveDesktopBuildCwd,
  resolveDesktopProductionCleanPaths,
} from "../scripts/run-production-build.mjs";

const isWindows = process.platform === "win32";

describe("createDesktopProductionBuildPlan", () => {
  it("Production builds should be enabled consistently across platforms via an explicit environment variable", () => {
    const plan = createDesktopProductionBuildPlan({
      cwd: "/repo/packages/desktop",
      baseEnv: { PATH: "/usr/bin" },
    });

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      label: "desktop production bundles",
      parallel: [
        {
          command: "pnpm",
          args: ["exec", "tsup"],
          env: {
            PATH: "/usr/bin",
            NODE_ENV: "production",
          },
        },
        {
          command: "pnpm",
          args: ["exec", "vite", "build"],
          env: {
            PATH: "/usr/bin",
            NODE_ENV: "production",
          },
        },
      ],
    });
  });

  it("Default build cwd should be the desktop package root, not the scripts subdirectory", () => {
    expect(resolveDesktopBuildCwd()).toMatch(/packages[\\/]desktop$/);
  });

  (isWindows ? it.skip : it)("Clean up old out artifacts entering app.asar before production build while preserving metadata", () => {
    expect(resolveDesktopProductionCleanPaths("/repo/packages/desktop")).toEqual([
      "/repo/packages/desktop/out/main",
      "/repo/packages/desktop/out/host",
      "/repo/packages/desktop/out/preload",
      "/repo/packages/desktop/out/renderer",
      "/repo/packages/desktop/out/plugin-sandbox",
      "/repo/packages/desktop/out/.main-build-ready",
      "/repo/packages/desktop/out/.host-build-ready",
      "/repo/packages/desktop/out/.preload-build-ready",
    ]);
  });
});
