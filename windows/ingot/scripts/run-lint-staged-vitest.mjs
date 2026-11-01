#!/usr/bin/env node
import { readFile, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { cleanGitEnv, run } from "./affected-unit-tests/process.mjs";

const [mode, ...args] = process.argv.slice(2);
let ownedManifest;
try {
  if (!["run", "related", "affected"].includes(mode))
    throw new Error(
      "用法：run-lint-staged-vitest.mjs <affected|run|related> [--files-manifest <path>|<files...>]",
    );
  let forwarded;
  if (args[0] === "--files-manifest") {
    const path = args[1];
    if (!path) throw new Error("MissingFile清单");
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (
      parsed.mode !== mode ||
      !Array.isArray(parsed.files) ||
      !parsed.files.every((file) => typeof file === "string" && file)
    )
      throw new Error("File清单无效");
    if (
      [resolve(tmpdir()), process.cwd()].includes(dirname(resolve(path))) &&
      /^\.(?:cf-)?lint-staged-vitest-\d+-[\da-f-]+\.json$/u.test(basename(path))
    )
      ownedManifest = path;
    forwarded = parsed.files.length ? ["--files-manifest", path] : [];
  } else forwarded = args.length ? ["--files", ...args] : [];
  if (forwarded.length) {
    const entry = fileURLToPath(new URL("./run-affected-unit-tests.mjs", import.meta.url));
    process.exitCode = (
      await run(process.execPath, [entry, ...forwarded], {
        cwd: process.cwd(),
        env: await cleanGitEnv(process.cwd()),
        inherit: true,
        allowFailure: true,
      })
    ).code;
  }
} catch (error) {
  console.error(`[affected] ${error.message}`);
  process.exitCode = 2;
} finally {
  if (ownedManifest) await rm(ownedManifest, { force: true });
}
