#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

import { createBundle } from "./create-bundle.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";

function fail(message) {
  process.stderr.write(`pack verification failed: ${message}\n`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} exited ${result.status}\n${result.stderr}`);
  }
  return result.stdout;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function verifyReleaseVersionAlignment() {
  const packageVersion = readJson("package.json").version;
  const versions = [
    [".qoder-plugin/plugin.json", readJson(".qoder-plugin/plugin.json").version],
    [".codex-plugin/plugin.json", readJson(".codex-plugin/plugin.json").version],
    [".cursor-plugin/plugin.json", readJson(".cursor-plugin/plugin.json").version],
    [".cursor-plugin/marketplace.json", readJson(".cursor-plugin/marketplace.json").plugins?.[0]?.version],
  ];
  for (const [source, version] of versions) {
    if (version !== packageVersion) {
      fail(`${source} version ${version ?? "<missing>"} does not match package.json ${packageVersion}`);
    }
  }
}

function parsePackOutput(stdout) {
  try {
    const packs = JSON.parse(stdout);
    const pack = packs?.[0];
    if (!pack?.filename) {
      fail("npm pack did not report a tarball filename");
    }
    if (!Array.isArray(pack.files)) {
      fail("npm pack did not report packaged files");
    }
    return {
      filename: pack.filename,
      entries: new Set(pack.files.map((file) => `package/${file.path}`)),
    };
  } catch (error) {
    fail(`could not parse npm pack output: ${error.message}`);
  }
}

function zipEntries(filename) {
  const buffer = readFileSync(filename);
  const entries = new Set();
  let offset = 0;
  while (offset < buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    entries.add(buffer.toString("utf8", nameStart, nameEnd));
    offset = nameEnd + extraLength + compressedSize;
  }
  return entries;
}

function hasPrefix(entries, prefix) {
  return [...entries].some((entry) => entry.startsWith(prefix));
}

function hasPathSegment(entries, segment) {
  return [...entries].some((entry) => entry.split("/").includes(segment));
}

const keep = process.argv.includes("--keep");
verifyReleaseVersionAlignment();
const pack = parsePackOutput(run(NPM_COMMAND, ["pack", "--json"]));
const entries = pack.entries;

const required = [
  "package/package.json",
  "package/README.md",
  "package/.qoder-plugin/plugin.json",
  "package/scripts/better-harness.mjs",
  "package/scripts/findings-recommend.json",
  "package/scripts/findings-recommend.mjs",
  "package/scripts/review-trigger/cli.mjs",
  "package/scripts/coding-agent-practices/asset-baseline.mjs",
  "package/scripts/package/create-bundle.mjs",
  "package/scripts/harness-analysis/canvas-preview-server.mjs",
  "package/scripts/harness-analysis/record-fix-output.mjs",
  "package/scripts/harness-analysis/preview-support/canvas-transform.mjs",
  "package/scripts/session-analysis/episode-facts.mjs",
  "package/scripts/session-analysis/result-facts.mjs",
  "package/scripts/session-analysis/session-core-facts.mjs",
  "package/skills/better-harness/SKILL.md",
  "package/skills/better-harness/references/agent-customize-summary.md",
  "package/skills/better-harness/references/asset-demand-reconciliation.md",
  "package/skills/better-harness/references/findings-review.md",
  "package/skills/better-harness/references/finding-bound-fix.md",
  "package/skills/better-harness/references/session-core-summary.md",
  "package/skills/better-harness/references/software-fluency.md",
  "package/templates/reporting/harness-findings.input.json",
  "package/references/coding-agent-practices/design-md-contract.md",
  "package/references/coding-agent-practices/examples/design-md-complete-example.md",
  "package/references/coding-agent-practices/examples/bug-diagnosis-skills/reproduce-frontend-bug/SKILL.md",
  "package/references/coding-agent-practices/examples/bug-diagnosis-skills/reproduce-frontend-bug/agents/openai.yaml",
  "package/references/coding-agent-practices/examples/bug-diagnosis-skills/diagnose-backend-bug/SKILL.md",
  "package/references/coding-agent-practices/examples/bug-diagnosis-skills/diagnose-backend-bug/agents/openai.yaml",
  "package/hooks/hooks.json.template",
  "package/hooks/git-scripts/blast-radius/parser.mjs",
];

const forbiddenPrefixes = [
  "package/.codex-plugin/",
  "package/.cursor-plugin/",
  "package/test/",
  "package/dev/",
  "package/.idea/",
  "package/.qoder/",
  "package/assets/wasm/",
  "package/node_modules/",
  "package/node_modules/esbuild-wasm/",
  "package/scripts/packaging/",
];

for (const entry of required) {
  if (!entries.has(entry)) {
    fail(`missing required entry ${entry}`);
  }
}

for (const prefix of forbiddenPrefixes) {
  if (hasPrefix(entries, prefix)) {
    fail(`unexpected packaged path ${prefix}`);
  }
}
if (hasPathSegment(entries, ".plugin-eval")) {
  fail("npm package contains generated .plugin-eval state");
}

if (!keep) {
  rmSync(path.resolve(repoRoot, pack.filename), { force: true });
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "better-harness-pack-"));
const bundlePath = path.join(tempDir, "better-harness-runtime.zip");
const bundle = createBundle({ out: bundlePath });
const bundleEntries = zipEntries(bundlePath);
const requiredBundleEntries = [
  "package.json",
  "README.md",
  ".qoder-plugin/plugin.json",
  "scripts/better-harness.mjs",
  "scripts/findings-recommend.json",
  "scripts/findings-recommend.mjs",
  "scripts/review-trigger/cli.mjs",
  "scripts/coding-agent-practices/asset-baseline.mjs",
  "scripts/harness-analysis/canvas-preview-server.mjs",
  "scripts/harness-analysis/canvas-module-boundaries.mjs",
  "scripts/harness-analysis/record-fix-output.mjs",
  "scripts/harness-analysis/preview-support/canvas-transform.mjs",
  "scripts/session-analysis/episode-facts.mjs",
  "scripts/session-analysis/result-facts.mjs",
  "scripts/session-analysis/session-core-facts.mjs",
  "skills/better-harness/SKILL.md",
  "skills/better-harness/references/agent-customize-summary.md",
  "skills/better-harness/references/asset-demand-reconciliation.md",
  "skills/better-harness/references/findings-review.md",
  "skills/better-harness/references/finding-bound-fix.md",
  "skills/better-harness/references/session-core-summary.md",
  "skills/better-harness/references/software-fluency.md",
  "templates/reporting/harness-findings.input.json",
  "references/coding-agent-practices/design-md-contract.md",
  "references/coding-agent-practices/examples/design-md-complete-example.md",
  "references/coding-agent-practices/examples/bug-diagnosis-skills/reproduce-frontend-bug/SKILL.md",
  "references/coding-agent-practices/examples/bug-diagnosis-skills/reproduce-frontend-bug/agents/openai.yaml",
  "references/coding-agent-practices/examples/bug-diagnosis-skills/diagnose-backend-bug/SKILL.md",
  "references/coding-agent-practices/examples/bug-diagnosis-skills/diagnose-backend-bug/agents/openai.yaml",
  "hooks/git-scripts/blast-radius/parser.mjs",
  "vendor/tree-sitter-wasm/package.json",
  "vendor/tree-sitter-wasm/wasm/tree-sitter.js",
  "vendor/tree-sitter-wasm/wasm/tree-sitter.wasm",
  "vendor/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm",
  "vendor/tree-sitter-wasm/wasm/tree-sitter-tsx.wasm",
  "vendor/esbuild-wasm/package.json",
  "vendor/esbuild-wasm/lib/main.js",
  "vendor/esbuild-wasm/esbuild.wasm",
];
const forbiddenBundlePrefixes = [
  ".codex-plugin/",
  ".cursor-plugin/",
  "test/",
  "dev/",
  ".idea/",
  ".qoder/",
  "assets/wasm/",
  "node_modules/",
  "scripts/packaging/",
];

for (const entry of requiredBundleEntries) {
  if (!bundleEntries.has(entry)) {
    fail(`runtime bundle missing required entry ${entry}`);
  }
}

for (const prefix of forbiddenBundlePrefixes) {
  if (hasPrefix(bundleEntries, prefix)) {
    fail(`runtime bundle has unexpected path ${prefix}`);
  }
}
if (hasPathSegment(bundleEntries, ".plugin-eval")) {
  fail("runtime bundle contains generated .plugin-eval state");
}

if (!keep) {
  rmSync(tempDir, { recursive: true, force: true });
}

process.stdout.write(
  `pack verification passed: npm ${entries.size} entries, runtime zip ${bundleEntries.size} entries${keep ? ` in ${pack.filename} and ${bundlePath}` : ""}\n`,
);
