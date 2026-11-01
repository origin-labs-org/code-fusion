#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicy } from "./architecture/policy.mjs";
import { pristineUpstreamFiles } from "./architecture/upstream-admission.mjs";
import { classifyLintDiagnostics, parseLintCommand } from "./cli-lint-admission.mjs";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "apps/cli");

async function main() {
  const policy = await loadPolicy(root);
  const pristine = await pristineUpstreamFiles(
    root,
    policy.global.acceptedUpstreamCommits,
    policy.global.acceptedUpstreamSnapshot,
  );
  let errors = 0,
    warnings = 0,
    accepted = 0;
  for (const parent of ["packages", "tools"]) {
    const entries = await readdir(resolve(cli, parent), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const cwd = resolve(cli, parent, entry.name);
      let manifest;
      try {
        manifest = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (!manifest.scripts?.lint) continue;
      const args = [...parseLintCommand(manifest.scripts.lint), "--format", "json"];
      const pnpm = process.env.npm_execpath;
      if (!pnpm) throw new Error("请Passed pnpm lint Run CLI lint");
      let result;
      try {
        result = await exec(process.execPath, [pnpm, "exec", "oxlint", ...args], {
          cwd,
          maxBuffer: 16 * 1024 * 1024,
        });
      } catch (error) {
        if (error.code !== 1 || !error.stdout) throw error;
        result = error;
      }
      const report = JSON.parse(result.stdout);
      if (!Array.isArray(report.diagnostics))
        throw new Error(`${manifest.name}: 无法解析 oxlint Result`);
      const groups = classifyLintDiagnostics(report.diagnostics, {
        pristine,
        relativeDirectory: relative(root, cwd).replaceAll("\\", "/"),
      });
      if (result.code === 1 && !report.diagnostics.some((item) => item.severity === "error"))
        throw new Error(`${manifest.name}: oxlint 异常Exit：${result.stderr}`);
      for (const item of [...groups.errors, ...groups.warnings])
        console.log(
          `${manifest.name}: ${item.severity} ${item.filename} ${item.code}: ${item.message}`,
        );
      if (groups.accepted.length)
        console.log(`${manifest.name}: 接纳 ${groups.accepted.length} 项原样上游 max-lines 存量`);
      errors += groups.errors.length;
      warnings += groups.warnings.length;
      accepted += groups.accepted.length;
    }
  }
  console.log(
    `CLI lint: ${errors} errors, ${warnings} warnings, ${accepted} pristine upstream line-count diagnostics`,
  );
  return errors ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
