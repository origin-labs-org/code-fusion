#!/usr/bin/env node

import {
  compareQoderProductSourceSnapshot,
  loadPackagedPlatformSdlcCatalogs,
  loadPlatformSdlcCatalog,
  readQoderProductSourceSnapshot,
  renderPlatformSdlcMatrix,
  validatePlatformSdlcCatalog,
} from "./index.mjs";
const HELP = `Usage: node scripts/platform-sdlc-catalog/cli.mjs <command> [options]

Commands:
  validate                  Validate one or every packaged platform catalog
  matrix                    Render one platform as a Markdown SDLC matrix
  usage                     Match explicit session use to one platform catalog

Options:
  --platform <id>           Platform id; validate defaults to every catalog
  --source-root <path>      Explicit CodeFusion product-source checkout for drift checks
  --workspace <path>        Workspace used for session discovery
  --history <30d|all>       Usage window (default: 30d)
  --since <yyyy-mm-dd>      Explicit usage lower bound; overrides history start
  --until <yyyy-mm-dd>      Explicit usage upper bound
  --all-projects            Include retained sessions from every provider project
  --home <path>             Explicit provider home for fixtures or isolated runs
  --json                    Emit parser-safe JSON for validate or usage
  --help                    Show this help
`;

function parseArgs(argv) {
  const options = {
    command: null,
    platform: null,
    sourceRoot: null,
    workspace: null,
    history: "30d",
    since: null,
    until: null,
    allProjects: false,
    home: null,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("-") && !options.command) options.command = arg;
    else if (arg === "--platform") options.platform = argv[++index] ?? null;
    else if (arg.startsWith("--platform=")) options.platform = arg.slice("--platform=".length);
    else if (arg === "--source-root") options.sourceRoot = argv[++index] ?? null;
    else if (arg.startsWith("--source-root=")) options.sourceRoot = arg.slice("--source-root=".length);
    else if (arg === "--workspace") options.workspace = argv[++index] ?? null;
    else if (arg.startsWith("--workspace=")) options.workspace = arg.slice("--workspace=".length);
    else if (arg === "--history") options.history = argv[++index] ?? null;
    else if (arg.startsWith("--history=")) options.history = arg.slice("--history=".length);
    else if (arg === "--since") options.since = argv[++index] ?? null;
    else if (arg.startsWith("--since=")) options.since = arg.slice("--since=".length);
    else if (arg === "--until") options.until = argv[++index] ?? null;
    else if (arg.startsWith("--until=")) options.until = arg.slice("--until=".length);
    else if (arg === "--all-projects") options.allProjects = true;
    else if (arg === "--home") options.home = argv[++index] ?? null;
    else if (arg.startsWith("--home=")) options.home = arg.slice("--home=".length);
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function validate(options) {
  const catalogs = options.platform
    ? [loadPlatformSdlcCatalog(options.platform)]
    : loadPackagedPlatformSdlcCatalogs();
  const results = catalogs.map((catalog) => {
    const errors = validatePlatformSdlcCatalog(catalog);
    if (options.sourceRoot) {
      if (catalog.platformId !== "qoder") errors.push(`--source-root is not supported for ${catalog.platformId}`);
      else errors.push(...compareQoderProductSourceSnapshot(catalog, readQoderProductSourceSnapshot(options.sourceRoot)));
    }
    return {
      platformId: catalog.platformId,
      status: errors.length === 0 ? "passed" : "failed",
      capabilities: catalog.capabilities.length,
      stages: catalog.stages.length,
      consistencyIssues: catalog.consistencyIssues.length,
      errors,
    };
  });
  if (options.json) process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  else {
    for (const result of results) {
      process.stdout.write(`${result.platformId}: ${result.status} (${result.capabilities} capabilities, ${result.stages} stages, ${result.consistencyIssues} known issues)\n`);
      for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
    }
  }
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help || !options.command) {
      process.stdout.write(HELP);
      return;
    }
    if (options.command === "validate") validate(options);
    else if (options.command === "matrix") {
      if (!options.platform) throw new Error("matrix requires --platform <id>");
      if (options.sourceRoot || options.json) throw new Error("matrix supports only --platform <id>");
      process.stdout.write(renderPlatformSdlcMatrix(loadPlatformSdlcCatalog(options.platform)));
    } else if (options.command === "usage") {
      if (!options.platform) throw new Error("usage requires --platform <id>");
      if (options.sourceRoot) throw new Error("usage does not support --source-root");
      const {
        analyzePlatformSdlcUsage,
        renderPlatformSdlcUsageMarkdown,
      } = await import("./usage.mjs");
      const report = await analyzePlatformSdlcUsage(loadPlatformSdlcCatalog(options.platform), options);
      process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderPlatformSdlcUsageMarkdown(report));
    } else throw new Error(`unknown command: ${options.command}`);
  } catch (error) {
    process.stderr.write(`platform SDLC catalog failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

await main();
