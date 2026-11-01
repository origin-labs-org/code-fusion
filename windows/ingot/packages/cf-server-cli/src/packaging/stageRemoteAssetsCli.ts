import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOURCE_SERVER_REMOTE_RELEASE_TARGETS,
  beginSourceServerRemoteReleaseGeneration,
  collectSourceServerRemoteReleaseArchives,
} from "./remoteAssetRelease.js";

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], { cwd, env, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  const linuxOnly = process.argv.slice(2).includes("--linux");
  const targets = linuxOnly
    ? SOURCE_SERVER_REMOTE_RELEASE_TARGETS.filter((target) => target.startsWith("linux-"))
    : SOURCE_SERVER_REMOTE_RELEASE_TARGETS;
  const env = { ...process.env };
  if (linuxOnly) {
    const cfEnv = env.CF_ENV?.trim().toLowerCase() || "production";
    if (cfEnv !== "test" && cfEnv !== "production") {
      throw new Error(`Invalid CF_ENV for prepare:remote-assets:linux: ${cfEnv}`);
    }
    env.CF_ENV = cfEnv;
  }
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const repoRoot = resolve(packageRoot, "../..");
  const { version } = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
    version: string;
  };
  const versionReleaseDir = join(repoRoot, "packages/desktop/mock-cdn/releases", version);
  await beginSourceServerRemoteReleaseGeneration({ versionReleaseDir });
  await run("pnpm", ["--filter", "@origin-ai/cf-server-cli", "build"], repoRoot, env);
  for (const [index, target] of targets.entries()) {
    await run(
      "pnpm",
      [
        "--filter",
        "@origin-ai/cf-server-cli",
        "exec",
        "tsx",
        "src/packaging/stageCli.ts",
        "--target",
        target,
        ...(linuxOnly ? ["--skip-component-archives"] : []),
        ...(index === 0 ? [] : ["--skip-agent-build"]),
      ],
      repoRoot,
      env,
    );
  }
  const collected = await collectSourceServerRemoteReleaseArchives({
    distReleaseDir: join(packageRoot, "dist-release"),
    versionReleaseDir,
    version,
    targets,
  });
  for (const path of collected) console.log(`[source-server-release] ${path}`);
}

await main();
