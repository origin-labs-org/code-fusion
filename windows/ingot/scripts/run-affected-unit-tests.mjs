#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createVitest } from "vitest/node";
import { git, cleanGitEnv } from "./affected-unit-tests/process.mjs";
import { resolveScope } from "./affected-unit-tests/scope.mjs";

export async function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--scope" || arg === "--base") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 需要参Count`);
      options[arg.slice(2)] = value;
    } else if (arg === "--files") {
      options.files ??= [];
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) options.files.push(argv[++i]);
      if (!options.files.length) throw new Error("--files 需要File清单");
    } else if (arg === "--files-manifest") {
      const manifest = argv[++i];
      if (!manifest) throw new Error("--files-manifest 需要路径");
      const parsed = JSON.parse(await readFile(manifest, "utf8"));
      if (
        !Array.isArray(parsed.files) ||
        !parsed.files.length ||
        !parsed.files.every((file) => typeof file === "string" && file)
      )
        throw new Error("File清单无效");
      options.files = [...(options.files ?? []), ...parsed.files];
    } else throw new Error(`Unknown参Count：${arg}`);
  }
  return options;
}

const specKey = (spec) => JSON.stringify([spec.project.name, spec.pool, spec.moduleId]);

export async function main(argv = process.argv.slice(2)) {
  let vitest;
  const restored = {};
  try {
    const options = await parseArgs(argv);
    if (options.help) {
      console.log(
        "用法：pnpm test:unit:affected [--scope worktree|push] [--base <commit>] [--files <files...>] [--dry-run] [--json]\n使用 Vitest Official选择；全量选择Skip UT 并成功Exit，脏Workspace Push andError非零Exit。0=Passed/无选MediumTests/Skip全量，1=TestsFailed，2=阻止execute/脚本Error。",
      );
      return 0;
    }
    const root = (await git(process.cwd(), ["rev-parse", "--show-toplevel"])).toString().trim();
    const env = await cleanGitEnv(root);
    for (const key of Object.keys(process.env)) {
      if (!(key in env)) {
        restored[key] = process.env[key];
        delete process.env[key];
      }
    }
    const scope = await resolveScope(root, options, env);
    const selected = new Map();
    const related = new Set();
    let all = [];
    if (!scope.deletedOnly) {
      vitest = await createVitest(
        "test",
        { root, watch: false, run: true, reporters: ["default"], silent: "passed-only" },
        { server: { watch: null } },
      );
      all = await vitest.globTestSpecifications();
      for (const base of scope.bases) {
        vitest.config.changed = scope.files ? false : base;
        vitest.config.related = scope.files;
        for (const spec of await vitest.getRelevantTestSpecifications())
          selected.set(specKey(spec), spec);
        for (const file of vitest.config.related ?? []) related.add(file);
      }
    }
    const specs = [...selected.values()].sort((a, b) => specKey(a).localeCompare(specKey(b)));
    const tests = specs.map((spec) => ({
      runner: "vitest",
      project: spec.project.name,
      pool: spec.pool,
      path: relative(root, spec.moduleId).replaceAll("\\", "/"),
    }));
    if (options.json) console.log(JSON.stringify(tests, null, 2));
    else {
      console.log(
        `[affected] base=${scope.files ? "related" : scope.bases.map((base) => (base === true ? "HEAD（未Submit）" : base)).join(",")} 选Medium ${specs.length}/${all.length}${specs.length ? "" : "：无选MediumTests"}`,
      );
      if (options.dryRun)
        for (const test of tests) console.log(`  ${test.project}/${test.pool}: ${test.path}`);
    }
    if (all.length && all.every((spec) => selected.has(specKey(spec)))) {
      console.warn(
        `[affected] Vitest Official选择了整个根 UT 套件（${all.length} 个规格），已Skip UT（Not executedTests），不因此阻止 Push。改动File：${[...related].map((file) => relative(root, file)).join(", ")}`,
      );
      return 0;
    }
    if (!specs.length || options.dryRun) return 0;
    await vitest.standalone();
    const result = await vitest.runTestSpecifications(specs, false);
    return result.unhandledErrors.length ||
      result.testModules.some((module) => module.state() === "failed")
      ? 1
      : 0;
  } catch (error) {
    console.error(`[affected] ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  } finally {
    try {
      await vitest?.close();
    } finally {
      Object.assign(process.env, restored);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await main();
