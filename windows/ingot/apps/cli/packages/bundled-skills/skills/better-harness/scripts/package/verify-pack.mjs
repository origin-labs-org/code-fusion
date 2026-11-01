#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, inflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";

import { archiveMarkdownLinkErrors } from "./archive-markdown-links.mjs";
import { createBundle } from "./create-bundle.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";
const SKILL_RECOMMENDATION_REFERENCE = "skills/better-harness/references/session-skill-pattern-discovery.md";
const REPO_ONLY_EVALUATION_REFERENCE = "references/session-evidence/session-skill-evaluation.md";
const SKILL_RECOMMENDATION_RUNTIME_MODULES = Object.freeze([
  "scripts/harness-analysis/skill-pattern-record.mjs",
  "scripts/harness-analysis/session-skill-pattern.mjs",
]);

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

function nullTerminatedText(buffer) {
  const end = buffer.indexOf(0);
  return buffer.subarray(0, end === -1 ? buffer.length : end).toString("utf8");
}

function tarArchive(filename) {
  const buffer = gunzipSync(readFileSync(filename));
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    const name = nullTerminatedText(header.subarray(0, 100));
    if (!name) break;
    const prefix = nullTerminatedText(header.subarray(345, 500));
    const entryName = prefix ? `${prefix}/${name}` : name;
    const sizeText = nullTerminatedText(header.subarray(124, 136)).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) fail(`invalid tar entry size for ${entryName}`);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > buffer.length) fail(`truncated tar entry ${entryName}`);
    const type = header[156];
    if (type === 0 || type === 48) entries.set(entryName, buffer.subarray(contentStart, contentEnd));
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function zipArchive(filename) {
  const buffer = readFileSync(filename);
  const entries = new Map();
  let offset = 0;
  while (offset < buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const contentStart = nameEnd + extraLength;
    const contentEnd = contentStart + compressedSize;
    const entryName = buffer.toString("utf8", nameStart, nameEnd);
    if (contentEnd > buffer.length) fail(`truncated runtime zip entry ${entryName}`);
    const compressed = buffer.subarray(contentStart, contentEnd);
    const content = compressionMethod === 0
      ? compressed
      : compressionMethod === 8
        ? inflateRawSync(compressed)
        : fail(`unsupported runtime zip compression method ${compressionMethod} for ${entryName}`);
    if (content.length !== uncompressedSize) fail(`runtime zip size mismatch for ${entryName}`);
    entries.set(entryName, content);
    offset = contentEnd;
  }
  return entries;
}

function requireArchiveEntry(readEntry, entryName, surface) {
  const content = readEntry(entryName);
  if (!content) fail(`${surface} is missing required entry ${entryName}`);
  return content;
}

function verifyArchiveMarkdownLinks(archive, options) {
  const errors = archiveMarkdownLinkErrors(archive, options);
  if (errors.length > 0) fail(`relative Markdown link closure failed:\n${errors.join("\n")}`);
}

function verifyPackageRuntimeBoundary(packArchive, bundleArchive) {
  const npmFiles = new Map([...packArchive.entries()]
    .filter(([entry]) => entry.startsWith("package/"))
    .map(([entry, content]) => [entry.slice("package/".length), content]));
  const runtimeFiles = new Map([...bundleArchive.entries()]
    .filter(([entry]) => !entry.startsWith("vendor/")));
  const sourceOnly = [...runtimeFiles.keys()].filter((entry) => !npmFiles.has(entry)).sort();
  const npmOnly = [...npmFiles.keys()].filter((entry) => !runtimeFiles.has(entry)).sort();
  if (sourceOnly.length > 0 || npmOnly.length > 0) {
    fail(`source/runtime boundary differs from the installed npm package; source-only: ${sourceOnly.join(", ") || "none"}; npm-only: ${npmOnly.join(", ") || "none"}`);
  }
  for (const [entry, content] of npmFiles) {
    if (!content.equals(runtimeFiles.get(entry))) fail(`runtime entry ${entry} differs from the installed npm package`);
  }
}

function materializeImportSmoke(readEntry, prefix, destination, surface) {
  for (const modulePath of SKILL_RECOMMENDATION_RUNTIME_MODULES) {
    const content = requireArchiveEntry(readEntry, `${prefix}${modulePath}`, surface);
    const outputPath = path.join(destination, modulePath);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, content);
  }
}

async function importSmoke(destination, surface) {
  const recordPath = path.join(destination, "scripts/harness-analysis/skill-pattern-record.mjs");
  const patternPath = path.join(destination, "scripts/harness-analysis/session-skill-pattern.mjs");
  try {
    const record = await import(`${pathToFileURL(recordPath).href}?surface=${encodeURIComponent(surface)}`);
    const pattern = await import(`${pathToFileURL(patternPath).href}?surface=${encodeURIComponent(surface)}`);
    if (typeof record.validateSkillPatternRecord !== "function"
      || typeof pattern.validateSkillPatternPacket !== "function"
      || typeof pattern.validateSkillPatternResult !== "function"
      || typeof pattern.buildSkillPatternRecord !== "function") {
      fail(`${surface} Skill Recommendation modules do not expose the production validation contract`);
    }
  } catch (error) {
    fail(`${surface} Skill Recommendation module import failed: ${error.message}`);
  }
}

function verifySkillRecommendationRouting(readEntry, prefix, surface) {
  const skill = requireArchiveEntry(
    readEntry,
    `${prefix}skills/better-harness/SKILL.md`,
    surface,
  ).toString("utf8");
  const reference = requireArchiveEntry(readEntry, `${prefix}${SKILL_RECOMMENDATION_REFERENCE}`, surface).toString("utf8");
  const normalizedReference = reference.replace(/\s+/gu, " ");
  const evaluation = requireArchiveEntry(
    readEntry,
    `${prefix}${REPO_ONLY_EVALUATION_REFERENCE}`,
    surface,
  ).toString("utf8");
  if (!skill.includes("[Skill Recommendation](references/session-skill-pattern-discovery.md)")) {
    fail(`${surface} Better Harness Skill does not route the optional Skill Recommendation reference`);
  }
  if (!reference.includes("# Skill Recommendation")
    || !normalizedReference.includes("an independently discoverable Skill")) {
    fail(`${surface} Skill Recommendation does not preserve its routed reference-only boundary`);
  }
  if (!evaluation.includes("full source checkout")
    || !evaluation.includes("repository-maintainer tools")
    || !evaluation.includes("published Better Harness entry")) {
    fail(`${surface} session-derived Skill evaluation does not declare its repository-only CLI boundary`);
  }
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
  "package/datasets/platform-sdlc/qoder.md",
  "package/docs/ARCHITECTURE.md",
  "package/docs/community.md",
  "package/docs/concepts.md",
  "package/scripts/better-harness.mjs",
  "package/scripts/findings-recommend.json",
  "package/scripts/findings-recommend.mjs",
  "package/scripts/review-trigger/cli.mjs",
  "package/scripts/coding-agent-practices/asset-baseline.mjs",
  "package/scripts/platform-sdlc-catalog/index.mjs",
  "package/scripts/platform-sdlc-catalog/cli.mjs",
  "package/scripts/platform-sdlc-catalog/usage.mjs",
  "package/scripts/platform-sdlc-catalog/prompts/usage-analysis.md",
  "package/scripts/package/create-bundle.mjs",
  "package/scripts/package/archive-markdown-links.mjs",
  "package/scripts/harness-analysis/canvas-preview-server.mjs",
  "package/scripts/harness-analysis/evidence-bundle/cli.mjs",
  "package/scripts/harness-analysis/evidence-bundle/contract.mjs",
  "package/scripts/harness-analysis/evidence-bundle/index.mjs",
  "package/scripts/harness-analysis/evidence-bundle/session-evidence.mjs",
  "package/scripts/harness-analysis/evidence-bundle/project-harness.mjs",
  "package/scripts/harness-analysis/evidence-bundle/agent-customize.mjs",
  "package/scripts/harness-analysis/skill-pattern-record.mjs",
  "package/scripts/harness-analysis/session-skill-pattern.mjs",
  "package/scripts/harness-analysis/record-fix-output.mjs",
  "package/scripts/harness-analysis/preview-support/canvas-transform.mjs",
  "package/scripts/session-analysis/episode-facts.mjs",
  "package/scripts/session-analysis/result-facts.mjs",
  "package/scripts/session-analysis/session-core-facts.mjs",
  "package/skills/better-harness/SKILL.md",
  "package/skills/better-harness/references/agent-customize.md",
  "package/skills/better-harness/references/asset-demand-reconciliation.md",
  "package/skills/better-harness/references/findings-review.md",
  "package/skills/better-harness/references/finding-bound-fix.md",
  "package/skills/better-harness/references/session-repeated-workflows.md",
  "package/skills/better-harness/references/session-skill-pattern-discovery.md",
  "package/skills/better-harness/references/session-evidence.md",
  "package/skills/better-harness/references/project-harness.md",
  "package/templates/reporting/harness-findings.input.json",
  "package/references/project-harness/design-md-contract.md",
  "package/references/session-evidence/README.md",
  "package/references/session-evidence/session-skill-evaluation.md",
  "package/references/project-harness/README.md",
  "package/references/agent-customize/README.md",
  "package/case-studies/project-harness/design-md-complete-example.md",
  "package/case-studies/agent-customize/bug-diagnosis-skills/reproduce-frontend-bug/SKILL.md",
  "package/case-studies/agent-customize/bug-diagnosis-skills/reproduce-frontend-bug/agents/openai.yaml",
  "package/case-studies/agent-customize/bug-diagnosis-skills/diagnose-backend-bug/SKILL.md",
  "package/case-studies/agent-customize/bug-diagnosis-skills/diagnose-backend-bug/agents/openai.yaml",
  "package/hooks/hooks.json.template",
  "package/hooks/git-scripts/blast-radius/parser.mjs",
];

const forbiddenPrefixes = [
  "package/.codex-plugin/",
  "package/.cursor-plugin/",
  "package/test/",
  "package/dev/",
  "package/.idea/",
  "package/.cf/",
  "package/assets/wasm/",
  "package/node_modules/",
  "package/node_modules/esbuild-wasm/",
  "package/scripts/packaging/",
  "package/scripts/session-evidence-eval.mjs",
  "package/scripts/session-evidence-eval/",
  "package/benchmark/",
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

const tempDir = mkdtempSync(path.join(os.tmpdir(), "better-harness-pack-"));
const npmSmokeRoot = path.join(tempDir, "npm-package");
const packPath = path.resolve(repoRoot, pack.filename);
const packArchive = tarArchive(packPath);
const readPackEntry = (entryName) => packArchive.get(entryName) ?? null;
verifyArchiveMarkdownLinks(packArchive, { prefix: "package/", surface: "npm package" });
verifySkillRecommendationRouting(readPackEntry, "package/", "npm package");
materializeImportSmoke(readPackEntry, "package/", npmSmokeRoot, "npm package");
await importSmoke(npmSmokeRoot, "npm-package");
if (!keep) rmSync(packPath, { force: true });

const bundlePath = path.join(tempDir, "better-harness-runtime.zip");
const bundle = createBundle({ out: bundlePath });
const bundleArchive = zipArchive(bundlePath);
const bundleEntries = new Set(bundleArchive.keys());
const requiredBundleEntries = [
  "package.json",
  "README.md",
  ".qoder-plugin/plugin.json",
  "datasets/platform-sdlc/qoder.md",
  "docs/ARCHITECTURE.md",
  "docs/community.md",
  "docs/concepts.md",
  "scripts/better-harness.mjs",
  "scripts/findings-recommend.json",
  "scripts/findings-recommend.mjs",
  "scripts/review-trigger/cli.mjs",
  "scripts/coding-agent-practices/asset-baseline.mjs",
  "scripts/platform-sdlc-catalog/index.mjs",
  "scripts/platform-sdlc-catalog/cli.mjs",
  "scripts/platform-sdlc-catalog/usage.mjs",
  "scripts/platform-sdlc-catalog/prompts/usage-analysis.md",
  "scripts/package/archive-markdown-links.mjs",
  "scripts/harness-analysis/canvas-preview-server.mjs",
  "scripts/harness-analysis/evidence-bundle/cli.mjs",
  "scripts/harness-analysis/evidence-bundle/contract.mjs",
  "scripts/harness-analysis/evidence-bundle/index.mjs",
  "scripts/harness-analysis/evidence-bundle/session-evidence.mjs",
  "scripts/harness-analysis/evidence-bundle/project-harness.mjs",
  "scripts/harness-analysis/evidence-bundle/agent-customize.mjs",
  "scripts/harness-analysis/skill-pattern-record.mjs",
  "scripts/harness-analysis/session-skill-pattern.mjs",
  "scripts/harness-analysis/canvas-module-boundaries.mjs",
  "scripts/harness-analysis/record-fix-output.mjs",
  "scripts/harness-analysis/preview-support/canvas-transform.mjs",
  "scripts/session-analysis/episode-facts.mjs",
  "scripts/session-analysis/result-facts.mjs",
  "scripts/session-analysis/session-core-facts.mjs",
  "skills/better-harness/SKILL.md",
  "skills/better-harness/references/agent-customize.md",
  "skills/better-harness/references/asset-demand-reconciliation.md",
  "skills/better-harness/references/findings-review.md",
  "skills/better-harness/references/finding-bound-fix.md",
  "skills/better-harness/references/session-repeated-workflows.md",
  "skills/better-harness/references/session-skill-pattern-discovery.md",
  "skills/better-harness/references/session-evidence.md",
  "skills/better-harness/references/project-harness.md",
  "templates/reporting/harness-findings.input.json",
  "references/project-harness/design-md-contract.md",
  "references/session-evidence/README.md",
  "references/session-evidence/session-skill-evaluation.md",
  "references/project-harness/README.md",
  "references/agent-customize/README.md",
  "case-studies/project-harness/design-md-complete-example.md",
  "case-studies/agent-customize/bug-diagnosis-skills/reproduce-frontend-bug/SKILL.md",
  "case-studies/agent-customize/bug-diagnosis-skills/reproduce-frontend-bug/agents/openai.yaml",
  "case-studies/agent-customize/bug-diagnosis-skills/diagnose-backend-bug/SKILL.md",
  "case-studies/agent-customize/bug-diagnosis-skills/diagnose-backend-bug/agents/openai.yaml",
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
  ".cf/",
  "assets/wasm/",
  "node_modules/",
  "scripts/packaging/",
  "scripts/session-evidence-eval.mjs",
  "scripts/session-evidence-eval/",
  "benchmark/",
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
verifyPackageRuntimeBoundary(packArchive, bundleArchive);
verifyArchiveMarkdownLinks(bundleArchive, { surface: "runtime bundle" });

const bundleSmokeRoot = path.join(tempDir, "runtime-bundle");
const readBundleEntry = (entryName) => bundleArchive.get(entryName) ?? null;
verifySkillRecommendationRouting(readBundleEntry, "", "runtime bundle");
materializeImportSmoke(readBundleEntry, "", bundleSmokeRoot, "runtime bundle");
await importSmoke(bundleSmokeRoot, "runtime-bundle");

if (!keep) {
  rmSync(tempDir, { recursive: true, force: true });
}

process.stdout.write(
  `pack verification passed: npm ${entries.size} entries, runtime zip ${bundleEntries.size} entries${keep ? ` in ${pack.filename} and ${bundlePath}` : ""}\n`,
);
