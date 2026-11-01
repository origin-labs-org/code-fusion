#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync, statSync, watch } from "node:fs";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertReadableFile, resolveCanvasRuntime } from "./preview-support/canvas-runtime.mjs";
import { transformCanvasSource } from "./preview-support/canvas-transform.mjs";
import {
  AGENT_WORK_LOOP_DIMENSIONS,
  AGENT_WORK_LOOP_MODEL_ID,
  AGENT_WORK_LOOP_REPORT_CONTRACT_VERSION,
} from "./fluency-dimensions.mjs";
import {
  formatServerUrl,
  isDirectModule,
  openBrowser,
  parsePreviewPort,
} from "./preview-support/platform.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../..");
const DEFAULT_CANVAS_TEMPLATE = "templates/canvas/qoder-harness-insights.canvas.tsx";
const LEARNING_CAPTURE_DESCRIPTOR = AGENT_WORK_LOOP_DIMENSIONS.find((dimension) => dimension.id === "learning-capture");

const DEFAULT_PREVIEW_REPORT = Object.freeze({
  summary: {
    projectName: "Better Harness preview fixture",
    locale: "en",
    modelId: AGENT_WORK_LOOP_MODEL_ID,
    reportContractVersion: AGENT_WORK_LOOP_REPORT_CONTRACT_VERSION,
    strengths: ["The preview fixture exercises the current Canvas report contract."],
    dimensions: [
      { id: "task-understanding", label: "Task Understanding", score: 82, summary: "Goals, context, and scope are visible.", findingRefs: [] },
      { id: "controlled-execution", label: "Controlled Execution", score: 76, summary: "Project operation stays within instructions and permissions.", findingRefs: [] },
      { id: "change-validation", label: "Change Validation", score: 70, summary: "Focused validation is available.", findingRefs: [] },
      { id: "reliable-delivery", label: "Reliable Delivery", score: 71, summary: "Acceptance evidence, approval, and recovery are represented.", findingRefs: [] },
      { id: "learning-capture", label: LEARNING_CAPTURE_DESCRIPTOR.label, score: 64, summary: "Recurring release guidance is reusable and maintainable; validation in a later similar task is still pending.", findingRefs: ["learning-capture-preview"] },
    ],
    aiAgentPractice: {
      inspectedSurfaces: ["Rules", "Skills", "Custom Agents", "Hooks", "MCP"],
      coverageRows: [{
        surface: "Rules",
        count: 1,
        scopes: ["Project"],
        paths: ["AGENTS.md"],
      }, {
        surface: "Skills",
        count: 3,
        scopes: ["Project"],
        paths: ["skills/better-harness/SKILL.md"],
      }, {
        surface: "Custom Agents",
        count: 2,
        scopes: ["Project"],
      }, {
        surface: "Hooks",
        count: 11,
        scopes: ["Project"],
        paths: [".cf/settings.json"],
      }, {
        surface: "MCP",
        count: 2,
        scopes: ["Project"],
        paths: [".cf/mcp.json"],
      }],
      repositorySourceRows: [{
        surface: "Rules",
        provider: "cursor",
        owner: ".cursor",
        count: 16,
        paths: [".cursor/rules/architecture.mdc", ".cursor/rules/code-style.mdc"],
      }, {
        surface: "Skills",
        provider: "codex-plugin",
        owner: "packages/example-codex-plugin",
        count: 5,
        paths: ["packages/example-codex-plugin/skills/review/SKILL.md"],
      }],
    },
    atAGlance: {
      coverage: { episodeCount: 2, editedEpisodeCount: 1, closedEpisodeCount: 1, recoveredEpisodeCount: 0 },
      priorityMoves: [],
    },
    usageActivity: {
      schemaVersion: 1,
      dateBasis: "UTC",
      measurementBasis: "preview-fixture-session-activity",
      truncated: false,
      dates: [
        "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20",
        "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26", "2026-07-27",
      ],
      sessions: {
        total: 6,
        starts: [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1],
        activeMinutes: [0, 18, 0, 26, 0, 0, 21, 0, 32, 0, 17, 0, 0, 24],
      },
      models: [{
        name: "qmodel_latest",
        total: 6,
        daily: [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1],
      }, {
        name: "efficient",
        total: 3,
        daily: [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      }],
      skills: [{
        name: "harness",
        total: 5,
        daily: [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0],
      }, {
        name: "canvas",
        total: 3,
        daily: [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      }, {
        name: "harness-analysis",
        total: 2,
        daily: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      }],
    },
    usageEfficiency: {
      schemaVersion: 1,
      selection: {
        strategy: "all-eligible",
        eligibleSessionCount: 6,
        analyzedSessionCount: 6,
        complete: true,
      },
      roles: {
        userThreadCandidateCount: 4,
        childAgentCandidateCount: 2,
      },
      longSessions: {
        activeCount: 0,
        wallOnlyCount: 0,
        longestActiveMinutes: 32,
      },
      accounting: {
        mode: "effort-proxy",
        responseCount: 9,
        modelAttributedResponseCount: 9,
        unattributedResponseCount: 0,
        usageFieldObservedCount: 9,
        nonZeroUsageCount: 0,
        exactCreditsAvailable: false,
        pricingVersion: null,
      },
      modelUsage: [{
        model: "qmodel_latest",
        responseCount: 6,
        usageFieldObservedCount: 6,
        nonZeroUsageCount: 0,
      }, {
        model: "efficient",
        responseCount: 3,
        usageFieldObservedCount: 3,
        nonZeroUsageCount: 0,
      }],
      outcomeReview: {
        status: "not-applicable",
        reviewedCandidateCount: 0,
        comparableModelOutcomeEvidence: false,
        recommendation: "controlled-a-b-required",
      },
    },
  },
  findings: [{
    id: "learning-capture-preview",
    title: "Preview a learning-capture finding",
    severity: "Low",
    reason: "This fixture verifies that the compact practice-source and learning-and-knowledge paths render together.",
    expectedOutput: ["Update the test in `templates/canvas/qoder-harness-insights.canvas.tsx` so the preview exposes the current finding-detail contract before release."],
    expectedArtifact: "Test",
    dimensionRefs: ["learning-capture"],
    aiFixPrompt: "Review the preview fixture only; do not modify project files.",
  }],
});

const DEFAULT_PREVIEW_CANVAS_DATA = Object.freeze({
  schemaVersion: 2,
  summary: {
    ...DEFAULT_PREVIEW_REPORT.summary,
    dimensions: DEFAULT_PREVIEW_REPORT.summary.dimensions.map((dimension) => dimension.id === "learning-capture"
      ? {
          ...dimension,
          level: "Exercised",
          subdimensions: LEARNING_CAPTURE_DESCRIPTOR.subdimensions.map((descriptor, index) => ({
            id: descriptor.id,
            label: descriptor.label,
            state: index < 2 ? "Exercised" : "Wired",
            level: index < 2 ? "Exercised" : "Wired",
          })),
        }
      : dimension),
  },
  findings: DEFAULT_PREVIEW_REPORT.findings,
});

function send(res, status, type, body) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": type,
  });
  res.end(body);
}

const LIGHT_PREVIEW_THEME_REPLACEMENTS = Object.freeze([
  ['"#E4E4E499"', '"#6B6B6B"'],
  ['"#E4E4E466"', '"#1F1F1F66"'],
  ['"#E4E4E433"', '"#1F1F1F33"'],
  ['"#E4E4E411"', '"#1F1F1F11"'],
  ['"#E4E4E4"', '"#1F1F1F"'],
  ['"#181818"', '"#FFFFFF"'],
  ['"#333333"', '"#D8D8D8"'],
  ['"#2D2D2D"', '"#F3F3F3"'],
  ['"#3D3D3D"', '"#E8E8E8"'],
]);

const PREVIEW_VSCODE_THEME_VARS = Object.freeze({
  dark: Object.freeze({
    "--vscode-editor-background": "#181818",
    "--vscode-foreground": "#E4E4E4",
    "--vscode-descriptionForeground": "#E4E4E499",
    "--vscode-button-background": "#2A3A6E",
    "--vscode-button-foreground": "#FFFFFF",
    "--vscode-button-hoverBackground": "#3A4A8E",
    "--vscode-button-secondaryBackground": "#2D2D2D",
    "--vscode-button-secondaryForeground": "#E4E4E4",
    "--vscode-button-secondaryHoverBackground": "#3D3D3D",
    "--vscode-focusBorder": "#2A3A6E",
    "--vscode-panel-border": "#333333",
    "--vscode-panel-background": "#181818",
    "--vscode-sideBar-background": "#181818",
    "--vscode-input-background": "#181818",
    "--vscode-input-border": "#333333",
    "--vscode-input-foreground": "#E4E4E4",
    "--vscode-list-hoverBackground": "#2A3A6E33",
    "--vscode-list-activeSelectionBackground": "#2A3A6E66",
    "--vscode-errorForeground": "#FC6B83",
    "--vscode-warningForeground": "#FFA500",
    "--vscode-infoForeground": "#2A3A6E",
    "--vscode-diffEditor-insertedLineBackground": "#0F3921",
    "--vscode-diffEditor-removedLineBackground": "#3E1419",
    "--vscode-diffEditor-insertedTextBackground": "#3FA26633",
    "--vscode-diffEditor-removedTextBackground": "#FC6B8333",
    "--vscode-disabledForeground": "#E4E4E466",
    "--vscode-symbolIcon-colorForeground": "#E4E4E433",
    "--vscode-textLink-foreground": "#7997FF",
    "--vscode-toolbar-hoverBackground": "#E4E4E411",
    "--vscode-widget-border": "#333333",
    "--vscode-panelSection-border": "#2D2D2D",
    "--vscode-testing-iconPassed": "#3FA266",
  }),
  light: Object.freeze({
    "--vscode-editor-background": "#F7F7F5",
    "--vscode-foreground": "#202124",
    "--vscode-descriptionForeground": "#666A73",
    "--vscode-button-background": "#5167D8",
    "--vscode-button-foreground": "#FFFFFF",
    "--vscode-button-hoverBackground": "#4055C5",
    "--vscode-button-secondaryBackground": "#ECEDEA",
    "--vscode-button-secondaryForeground": "#202124",
    "--vscode-button-secondaryHoverBackground": "#E2E3DF",
    "--vscode-focusBorder": "#5167D8",
    "--vscode-panel-border": "#DEDFDB",
    "--vscode-panel-background": "#F7F7F5",
    "--vscode-sideBar-background": "#F7F7F5",
    "--vscode-input-background": "#FFFFFF",
    "--vscode-input-border": "#D7D8D4",
    "--vscode-input-foreground": "#202124",
    "--vscode-list-hoverBackground": "#5167D812",
    "--vscode-list-activeSelectionBackground": "#5167D824",
    "--vscode-errorForeground": "#C23B4A",
    "--vscode-warningForeground": "#A76500",
    "--vscode-infoForeground": "#5167D8",
    "--vscode-diffEditor-insertedLineBackground": "#E7F4EA",
    "--vscode-diffEditor-removedLineBackground": "#FBE9EB",
    "--vscode-diffEditor-insertedTextBackground": "#2E8B5730",
    "--vscode-diffEditor-removedTextBackground": "#C23B4A26",
    "--vscode-disabledForeground": "#20212466",
    "--vscode-symbolIcon-colorForeground": "#20212433",
    "--vscode-textLink-foreground": "#4055C5",
    "--vscode-toolbar-hoverBackground": "#2021240A",
    "--vscode-widget-border": "#DEDFDB",
    "--vscode-panelSection-border": "#E7E8E4",
    "--vscode-testing-iconPassed": "#2E8B57",
  }),
});

function applyPreviewTheme(html, themeKind) {
  if (themeKind !== "light") return html;
  return LIGHT_PREVIEW_THEME_REPLACEMENTS.reduce(
    (source, [from, to]) => source.replaceAll(from, to),
    html,
  );
}

function renderHtml(htmlTemplatePath, themeKind = "dark") {
  const light = themeKind === "light";
  const html = readFileSync(htmlTemplatePath, "utf8")
    .replace(/__CANVAS_BG__/g, light ? "#FFFFFF" : "#181818")
    .replace(/__CANVAS_FG__/g, light ? "#1F1F1F" : "#E4E4E4")
    .replace(/__CANVAS_THEME_KIND__/g, light ? "light" : "dark")
    .replace(/__CANVAS_VSCODE_VARS__/g, JSON.stringify(PREVIEW_VSCODE_THEME_VARS[light ? "light" : "dark"]))
    .replace("data: new Map(),", "data: new Map(),");
  return applyPreviewTheme(html, themeKind);
}

function parseArgs(argv) {
  const args = {
    canvasPath: null,
    host: "127.0.0.1",
    port: 58575,
    watch: false,
    open: false,
    sdkRoot: undefined,
    sdkMedia: undefined,
    positional: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      args.host = argv[++index];
    } else if (arg === "--port") {
      args.port = parsePreviewPort(argv[++index], args.port);
    } else if (arg === "--watch") {
      args.watch = true;
    } else if (arg === "--open") {
      args.open = true;
    } else if (arg === "--sdk-root") {
      args.sdkRoot = argv[++index];
    } else if (arg === "--sdk-media") {
      args.sdkMedia = argv[++index];
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      args.positional.push(arg);
    }
  }

  if (args.positional.length > 0) {
    args.canvasPath = args.positional[0];
  }

  return args;
}

export async function createDefaultCanvasPreviewFixture({ repoRoot = defaultRepoRoot } = {}) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "better-harness-canvas-preview-"));
  const canvasPath = path.join(fixtureRoot, "insights.canvas.tsx");
  const findingsPath = path.join(fixtureRoot, "findings.json");
  const canvasDataPath = path.join(fixtureRoot, "canvas.json");
  const sourceTemplate = path.resolve(repoRoot, DEFAULT_CANVAS_TEMPLATE);
  try {
    await copyFile(sourceTemplate, canvasPath);
    await writeFile(findingsPath, `${JSON.stringify({ summary: DEFAULT_PREVIEW_REPORT.summary }, null, 2)}\n`, "utf8");
    await writeFile(canvasDataPath, `${JSON.stringify(DEFAULT_PREVIEW_CANVAS_DATA, null, 2)}\n`, "utf8");
  } catch (error) {
    await rm(fixtureRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    root: fixtureRoot,
    canvasPath,
    close: () => rm(fixtureRoot, { recursive: true, force: true }),
  };
}

export async function createCanvasPreviewServer({
  canvasPath,
  host = "127.0.0.1",
  port = 58575,
  watch: watchMode = false,
  open = false,
  sdkRoot,
  sdkMedia,
  env = process.env,
  repoRoot = defaultRepoRoot,
  candidateMediaDirs,
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  if (!canvasPath) throw new Error("Canvas file is required; pass a .canvas.tsx path or use the CLI default preview fixture");
  const resolvedCanvasPath = path.resolve(resolvedRepoRoot, canvasPath);
  assertReadableFile(resolvedCanvasPath, "Canvas file");

  const runtime = resolveCanvasRuntime({
    repoRoot: resolvedRepoRoot,
    sdkRoot,
    sdkMedia,
    env,
    candidateMediaDirs,
  });

  let cachedModule = null;
  let cachedModuleSignature = "";
  let watcher = null;
  let closed = false;

  function buildCanvasModule() {
    const source = readFileSync(resolvedCanvasPath, "utf8");
    return transformCanvasSource(source, {
      runtime,
      sourcefile: path.relative(resolvedRepoRoot, resolvedCanvasPath),
      sourcePath: resolvedCanvasPath,
    });
  }

  function getCanvasModule() {
    const stat = statSync(resolvedCanvasPath);
    const signature = `${stat.mtimeMs}:${stat.size}`;
    if (!cachedModule || cachedModuleSignature !== signature) {
      cachedModule = buildCanvasModule();
      cachedModuleSignature = signature;
    }
    return cachedModule;
  }

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const themeKind = url.searchParams.get("theme") === "light" ? "light" : "dark";
        return send(res, 200, "text/html; charset=utf-8", renderHtml(runtime.htmlTemplatePath, themeKind));
      }
      if (url.pathname === "/canvas-sdk.js") {
        return send(res, 200, "application/javascript; charset=utf-8", readFileSync(runtime.sdkPath));
      }
      if (url.pathname === "/canvas-sdk.js.map" && runtime.sdkMapPath) {
        return send(res, 200, "application/json; charset=utf-8", readFileSync(runtime.sdkMapPath));
      }
      if (url.pathname === "/canvas-module.js") {
        return send(res, 200, "application/javascript; charset=utf-8", getCanvasModule().code);
      }
      if (url.pathname === "/canvas-module.js.map") {
        return send(res, 200, "application/json; charset=utf-8", getCanvasModule().map);
      }
      if (url.pathname === "/health") {
        return send(res, 200, "text/plain; charset=utf-8", "ok");
      }
      if (url.pathname === "/favicon.ico") {
        return send(res, 204, "image/x-icon", "");
      }
      return send(res, 404, "text/plain; charset=utf-8", `Not found: ${url.pathname}`);
    } catch (error) {
      console.error("[canvas-preview] error:", error);
      return send(res, 500, "text/plain; charset=utf-8", String(error?.stack ?? error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  if (watchMode) {
    watcher = watch(resolvedCanvasPath, () => {
      cachedModule = null;
      cachedModuleSignature = "";
      console.log(`[canvas-preview] Rebuilt ${path.relative(resolvedRepoRoot, resolvedCanvasPath)}`);
    });
  }

  const url = formatServerUrl(server.address(), host);
  if (open) {
    openBrowser(url);
  }

  return {
    server,
    url,
    canvasPath: resolvedCanvasPath,
    runtime,
    close: async () => {
      if (closed) return;
      closed = true;
      watcher?.close();
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error?.code === "ERR_SERVER_NOT_RUNNING") {
            resolve();
            return;
          }
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const fixture = options.canvasPath ? null : await createDefaultCanvasPreviewFixture();
  const preview = await createCanvasPreviewServer({
    ...options,
    canvasPath: fixture?.canvasPath ?? options.canvasPath,
  });
  console.log(`[canvas-preview] Serving ${path.relative(defaultRepoRoot, preview.canvasPath)}`);
  console.log(`[canvas-preview] Canvas SDK ${preview.runtime.mediaDir ?? preview.runtime.sdkRoot}`);
  console.log(`[canvas-preview] ${preview.url}`);

  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await preview.close();
      await fixture?.close();
      process.exit(0);
    });
  }
}

if (isDirectModule(import.meta.url)) {
  main().catch((error) => {
    console.error("[canvas-preview] error:", error);
    process.exit(1);
  });
}
