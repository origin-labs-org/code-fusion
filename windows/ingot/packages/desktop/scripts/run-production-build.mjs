import { rm } from "node:fs/promises";
import process from "node:process";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSpawnRuntimeOptions } from "../../../scripts/spawn-command.mjs";

export function resolveDesktopBuildCwd() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolveDesktopProductionCleanPaths(cwd) {
  return [
    resolve(cwd, "out/main"),
    resolve(cwd, "out/host"),
    resolve(cwd, "out/preload"),
    resolve(cwd, "out/renderer"),
    resolve(cwd, "out/plugin-sandbox"),
    resolve(cwd, "out/.main-build-ready"),
    resolve(cwd, "out/.host-build-ready"),
    resolve(cwd, "out/.preload-build-ready"),
  ];
}

export async function cleanDesktopProductionOutput({ cwd }) {
  if (process.env.CF_E2E_KEEP_BUILD_CACHE === "1") {
    console.log("[build] CF_E2E_KEEP_BUILD_CACHE=1, skipping clean");
    return;
  }
  await Promise.all(
    resolveDesktopProductionCleanPaths(cwd).map((targetPath) =>
      rm(targetPath, { force: true, recursive: true }),
    ),
  );
}

export function createDesktopProductionBuildPlan({ cwd, baseEnv = process.env }) {
  const env = {
    ...baseEnv,
    NODE_ENV: "production",
  };

  return [
    {
      label: "desktop production bundles",
      parallel: [
        {
          command: "pnpm",
          args: ["exec", "tsup"],
          cwd,
          env,
        },
        {
          command: "pnpm",
          args: ["exec", "vite", "build"],
          cwd,
          env,
        },
      ],
    },
  ];
}

function runCommandAsync(step) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: step.env,
      stdio: "inherit",
      ...resolveSpawnRuntimeOptions(step.command),
    });

    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      const reason = signal ? `signal ${signal}` : `code ${code}`;
      rejectRun(new Error(`${step.command} ${step.args.join(" ")} failed with ${reason}`));
    });
  });
}

export async function runDesktopProductionBuild({ cwd = resolveDesktopBuildCwd() } = {}) {
  await cleanDesktopProductionOutput({ cwd });
  for (const step of createDesktopProductionBuildPlan({ cwd })) {
    if (step.parallel) {
      await Promise.all(step.parallel.map(runCommandAsync));
      continue;
    }

    await runCommandAsync(step);
  }
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  await runDesktopProductionBuild();
}
