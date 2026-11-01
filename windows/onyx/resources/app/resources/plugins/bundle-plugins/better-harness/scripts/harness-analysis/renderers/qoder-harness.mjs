import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BETTER_HARNESS_AGENT_FLUENCY_DIMENSION_IDS, isAgentWorkLoopReport } from "../fluency-dimensions.mjs";
import { analyzeCanvasModuleBoundaries } from "../canvas-module-boundaries.mjs";
import {
  isFullTaskLoopFindings,
  validateTaskLoopCanvasSplit,
  validateTaskLoopFindings,
  validateTaskLoopUsagePair,
} from "../task-loop-report.mjs";

export const QODER_HARNESS_FINDINGS_FILE = "findings.json";
export const QODER_HARNESS_CANVAS_DATA_FILE = "canvas.json";
export const QODER_HARNESS_REPORT_FILE = "report.canvas.tsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QODER_HARNESS_TEMPLATE_FILE = path.resolve(__dirname, "../../../templates/canvas/qoder-harness-insights.canvas.tsx");

const QODER_HARNESS_DIMENSION_IDS = BETTER_HARNESS_AGENT_FLUENCY_DIMENSION_IDS;
const QODER_HARNESS_ALLOWED_IMPORTS = new Set([
  "qoder/canvas",
  `./${QODER_HARNESS_FINDINGS_FILE}`,
  `./${QODER_HARNESS_CANVAS_DATA_FILE}`,
]);
const DIMENSION_FIELDS = new Set(["id", "label", "score", "summary", "findingRefs"]);
const FINDING_FIELDS = new Set(["id", "title", "severity", "reason", "aiFixPrompt", "dimensionRefs"]);
const DIMENSION_SUMMARY_EXAMPLE_RE = /^(?:example|示例)\s*[:：]/i;

function check(id, errors = [], warnings = [], summary = {}) {
  return {
    id,
    status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    errors,
    warnings,
    summary,
  };
}

function parseJson(text, fileName) {
  try {
    return { value: JSON.parse(text), errors: [] };
  } catch (error) {
    return { value: null, errors: [`${fileName} is not valid JSON: ${error.message}`] };
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scorePercentageError(score) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) {
    return "score must be numeric";
  }
  if (numericScore < 0 || numericScore > 100) {
    return "score must be a 0-100 percentage";
  }
  if (Number.isInteger(numericScore) && numericScore > 0 && numericScore <= 5) {
    return "score must be a 0-100 percentage, not a 1-5 stage value";
  }
  return "";
}

function qoderHarnessFindingsErrors(findingsText, canvasText) {
  const { value: parsed, errors } = parseJson(findingsText, QODER_HARNESS_FINDINGS_FILE);
  if (errors.length > 0) return errors;
  if (!isObject(parsed)) return [`${QODER_HARNESS_FINDINGS_FILE} must be an object`];
  if (isAgentWorkLoopReport(parsed)) {
    if (!isFullTaskLoopFindings(parsed)) {
      const canvas = parseJson(canvasText ?? "", QODER_HARNESS_CANVAS_DATA_FILE);
      return [...canvas.errors, ...validateTaskLoopCanvasSplit(parsed, canvas.value)];
    }
    return [...validateTaskLoopFindings(parsed), ...validateTaskLoopUsagePair(parsed)];
  }

  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findingIds = new Set(findings.map((finding) => String(finding?.id ?? "")).filter(Boolean));
  const dimensions = parsed.summary?.dimensions;
  if (!Array.isArray(dimensions)) {
    errors.push("findings.json summary.dimensions must be an array");
    return errors;
  }

  const dimensionIds = new Set(dimensions.map((dimension) => String(dimension?.id ?? "")));
  for (const id of QODER_HARNESS_DIMENSION_IDS) {
    if (!dimensionIds.has(id)) {
      errors.push(`findings.json summary.dimensions missing Better Harness dimension: ${id}`);
    }
  }
  if (dimensionIds.size !== QODER_HARNESS_DIMENSION_IDS.length || dimensions.length !== QODER_HARNESS_DIMENSION_IDS.length) {
    errors.push(`findings.json summary.dimensions must contain exactly ${QODER_HARNESS_DIMENSION_IDS.length} Better Harness dimensions`);
  }

  for (const [index, dimension] of dimensions.entries()) {
    for (const field of Object.keys(dimension ?? {})) {
      if (!DIMENSION_FIELDS.has(field)) {
        errors.push(`summary.dimensions[${index}] has unsupported field: ${field}`);
      }
    }
    for (const field of ["id", "label", "summary"]) {
      if (typeof dimension?.[field] !== "string" || dimension[field].trim() === "") {
        errors.push(`summary.dimensions[${index}] missing ${field}`);
      }
    }
    if (typeof dimension?.summary === "string" && DIMENSION_SUMMARY_EXAMPLE_RE.test(dimension.summary.trim())) {
      errors.push(`summary.dimensions[${index}] summary must be project-specific, not an example placeholder`);
    }
    const scoreError = scorePercentageError(dimension?.score);
    if (scoreError) {
      errors.push(`summary.dimensions[${index}] ${scoreError}`);
    }
    if (!Array.isArray(dimension?.findingRefs)) {
      errors.push(`summary.dimensions[${index}] missing findingRefs`);
    } else {
      for (const ref of dimension.findingRefs) {
        if (!findingIds.has(String(ref))) {
          errors.push(`summary.dimensions[${index}] findingRefs contains unknown finding id: ${ref}`);
        }
      }
    }
  }

  for (const [index, finding] of findings.entries()) {
    for (const field of Object.keys(finding ?? {})) {
      if (!FINDING_FIELDS.has(field)) {
        errors.push(`findings[${index}] has unsupported field: ${field}`);
      }
    }
    if (!Array.isArray(finding?.dimensionRefs) || finding.dimensionRefs.length === 0) {
      errors.push(`findings[${index}] missing dimensionRefs`);
      continue;
    }
    for (const ref of finding.dimensionRefs) {
      if (!dimensionIds.has(String(ref))) {
        errors.push(`findings[${index}] dimensionRefs contains unknown dimension id: ${ref}`);
      }
    }
  }

  return errors;
}

function qoderHarnessReportErrors(reportText) {
  const errors = [];
  const moduleBoundary = analyzeCanvasModuleBoundaries(reportText);
  const findingsImport = moduleBoundary.imports.find((record) => record.source === `./${QODER_HARNESS_FINDINGS_FILE}`);
  const canvasDataImport = moduleBoundary.imports.find((record) => record.source === `./${QODER_HARNESS_CANVAS_DATA_FILE}`);
  if (moduleBoundary.syntaxError) {
    errors.push(`${QODER_HARNESS_REPORT_FILE} module syntax could not be parsed safely`);
  }
  if (!findingsImport?.defaultImport) {
    errors.push(`${QODER_HARNESS_REPORT_FILE} must import ./findings.json`);
  }
  if (!canvasDataImport?.defaultImport) {
    errors.push(`${QODER_HARNESS_REPORT_FILE} must import ./${QODER_HARNESS_CANVAS_DATA_FILE}`);
  }
  const forbiddenImports = moduleBoundary.staticSources.filter((source) => !QODER_HARNESS_ALLOWED_IMPORTS.has(source));
  if (forbiddenImports.length > 0) {
    errors.push(`${QODER_HARNESS_REPORT_FILE} has forbidden import source: ${forbiddenImports.join(", ")}`);
  }
  if (moduleBoundary.reexports.length > 0) {
    errors.push(`${QODER_HARNESS_REPORT_FILE} must not re-export modules`);
  }
  if (moduleBoundary.dynamicImport) {
    errors.push(`${QODER_HARNESS_REPORT_FILE} must not use dynamic imports`);
  }
  if (!/<SendToChatButton\b[^>]*\btext=\{row\.aiFixPrompt\}/.test(reportText)) {
    errors.push(`${QODER_HARNESS_REPORT_FILE} must bind SendToChatButton.text to row.aiFixPrompt`);
  }
  if (/\buseCanvasState\b/.test(reportText)) {
    errors.push(`${QODER_HARNESS_REPORT_FILE} must not use Canvas state`);
  }
  return errors;
}

export function evaluateQoderHarnessArtifacts({ findingsText, canvasText, reportText }) {
  return [
    check("qoder-harness-findings", qoderHarnessFindingsErrors(findingsText, canvasText)),
    check("qoder-harness-report", qoderHarnessReportErrors(reportText)),
  ];
}

export function renderQoderHarnessReportCanvas() {
  return readFileSync(QODER_HARNESS_TEMPLATE_FILE, "utf8");
}

export function renderQoderHarness() {
  return {
    [QODER_HARNESS_REPORT_FILE]: renderQoderHarnessReportCanvas(),
  };
}
