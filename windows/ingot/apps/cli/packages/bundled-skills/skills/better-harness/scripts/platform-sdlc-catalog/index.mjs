import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLATFORM_SDLC_CATALOG_SCHEMA_VERSION = 1;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const PLATFORM_SDLC_CATALOG_ROOT = path.resolve(moduleDir, "..", "..", "datasets", "platform-sdlc");

const REQUIRED_SECTIONS = Object.freeze([
  "platform",
  "sources",
  "sdlc-stages",
  "capabilities",
  "consistency-issues",
]);
const CANONICAL_PHASES = new Set(["plan", "design", "develop", "test", "deploy", "operate"]);
const SOURCE_TYPES = new Set(["repository", "runtime", "plugin", "package", "service"]);
const SOURCE_COVERAGE = new Set(["complete", "partial", "dynamic", "unknown"]);
const CAPABILITY_KINDS = new Set(["skill", "command", "agent", "tool"]);
const AVAILABILITY_VALUES = new Set([
  "built-in",
  "mode-restricted",
  "agent-private",
  "feature-gated",
  "runtime-advertised",
]);
const RECOMMENDATION_VALUES = new Set(["default", "runtime-context"]);
const ISSUE_SEVERITIES = new Set(["info", "warning", "error"]);
const PLATFORM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CAPABILITY_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const QODER_PRODUCT_RUNTIME_SOURCE_ID = "qoder-product-runtime";
const QODER_PRODUCT_RUNTIME_SKILL_ROOT = "chat/agents/tool/skill/builtin_skills/";

function normalizedHeading(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function stripCode(value) {
  const text = String(value ?? "").trim();
  return text.startsWith("`") && text.endsWith("`") && text.length >= 2
    ? text.slice(1, -1).trim()
    : text;
}

function splitList(value) {
  const text = stripCode(value);
  if (!text || text === "-") return [];
  return text.split(",").map((item) => stripCode(item)).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

export function splitMarkdownTableRow(line) {
  let text = String(line ?? "").trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  const cells = [];
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\" && text[index + 1] === "|") {
      current += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function markdownSections(markdown) {
  const sections = new Map();
  let current = null;
  for (const [index, line] of String(markdown ?? "").split(/\r?\n/u).entries()) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line);
    if (heading) {
      current = normalizedHeading(heading[1]);
      if (sections.has(current)) {
        throw new Error(`duplicate Markdown section: ${heading[1]}`);
      }
      sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push({ line, lineNumber: index + 1 });
  }
  return sections;
}

function isDelimiterRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
}

function parseTable(sections, sectionId) {
  const lines = sections.get(sectionId) ?? [];
  const headerIndex = lines.findIndex(({ line }) => line.trim().startsWith("|"));
  if (headerIndex < 0 || headerIndex + 1 >= lines.length) {
    throw new Error(`section ${sectionId} must contain a Markdown table`);
  }
  const headers = splitMarkdownTableRow(lines[headerIndex].line).map(normalizedHeading);
  const delimiter = splitMarkdownTableRow(lines[headerIndex + 1].line);
  if (headers.length === 0 || delimiter.length !== headers.length || !isDelimiterRow(delimiter)) {
    throw new Error(`section ${sectionId} has an invalid Markdown table header`);
  }
  const rows = [];
  for (const entry of lines.slice(headerIndex + 2)) {
    if (!entry.line.trim().startsWith("|")) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = splitMarkdownTableRow(entry.line);
    if (cells.length !== headers.length) {
      throw new Error(`section ${sectionId} line ${entry.lineNumber} has ${cells.length} cells; expected ${headers.length}`);
    }
    rows.push(Object.fromEntries(headers.map((header, index) => [header, stripCode(cells[index])] )));
  }
  return rows;
}

function requireColumns(rows, sectionId, columns) {
  const fields = new Set(Object.keys(rows[0] ?? {}));
  const missing = columns.filter((column) => !fields.has(column));
  if (missing.length > 0) {
    throw new Error(`section ${sectionId} is missing columns: ${missing.join(", ")}`);
  }
}

function parsePlatformMetadata(rows) {
  requireColumns(rows, "platform", ["field", "value"]);
  const metadata = new Map(rows.map((row) => [normalizedHeading(row.field).replaceAll("-", "_"), row.value]));
  return {
    schemaVersion: Number(metadata.get("schema_version")),
    platformId: metadata.get("platform_id") ?? "",
    displayName: metadata.get("display_name") ?? "",
    lifecycleModel: metadata.get("lifecycle_model") ?? "",
    sourceCompleteness: metadata.get("source_completeness") ?? "",
    sourceGaps: splitList(metadata.get("source_gaps")),
    canonicalPhases: splitList(metadata.get("canonical_phases")),
  };
}

function parseSources(rows) {
  requireColumns(rows, "sources", ["source-id", "type", "role", "revision", "coverage", "maintainer-input"]);
  return rows.map((row) => ({
    id: row["source-id"],
    type: row.type,
    role: row.role,
    revision: row.revision,
    coverage: row.coverage,
    maintainerInput: row["maintainer-input"],
  }));
}

function parseStages(rows) {
  requireColumns(rows, "sdlc-stages", ["stage-id", "label", "canonical-phase"]);
  return rows.map((row) => ({
    id: row["stage-id"],
    label: row.label,
    canonicalPhase: row["canonical-phase"],
  }));
}

function parseCapabilities(rows) {
  requireColumns(rows, "capabilities", [
    "id", "name", "kind", "source", "availability", "modes", "stage-refs",
    "disciplines", "workflow-intents", "recommendation", "source-path", "notes",
  ]);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    sourceId: row.source,
    availability: row.availability,
    modes: splitList(row.modes),
    stageRefs: splitList(row["stage-refs"]),
    disciplines: splitList(row.disciplines),
    workflowIntents: splitList(row["workflow-intents"]),
    recommendation: row.recommendation,
    sourcePath: row["source-path"] === "-" ? null : row["source-path"],
    notes: row.notes,
  }));
}

function parseConsistencyIssues(rows) {
  requireColumns(rows, "consistency-issues", ["issue-id", "severity", "source", "summary"]);
  return rows.map((row) => ({
    id: row["issue-id"],
    severity: row.severity,
    sourceId: row.source,
    summary: row.summary,
  }));
}

export function parsePlatformSdlcCatalog(markdown, options = {}) {
  const sections = markdownSections(markdown);
  const missingSections = REQUIRED_SECTIONS.filter((section) => !sections.has(section));
  if (missingSections.length > 0) {
    throw new Error(`platform SDLC catalog is missing sections: ${missingSections.join(", ")}`);
  }
  const platform = parsePlatformMetadata(parseTable(sections, "platform"));
  return {
    ...platform,
    datasetPath: options.datasetPath ?? null,
    sources: parseSources(parseTable(sections, "sources")),
    stages: parseStages(parseTable(sections, "sdlc-stages")),
    capabilities: parseCapabilities(parseTable(sections, "capabilities")),
    consistencyIssues: parseConsistencyIssues(parseTable(sections, "consistency-issues")),
  };
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function validateId(value, label, errors) {
  if (!CAPABILITY_ID_PATTERN.test(String(value ?? ""))) errors.push(`${label} must be a kebab-case id`);
}

export function validatePlatformSdlcCatalog(catalog) {
  const errors = [];
  if (catalog?.schemaVersion !== PLATFORM_SDLC_CATALOG_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${PLATFORM_SDLC_CATALOG_SCHEMA_VERSION}`);
  }
  if (!PLATFORM_ID_PATTERN.test(String(catalog?.platformId ?? ""))) errors.push("platformId must be a kebab-case id");
  if (!String(catalog?.displayName ?? "").trim()) errors.push("displayName must be non-empty");
  if (!String(catalog?.lifecycleModel ?? "").trim()) errors.push("lifecycleModel must be non-empty");
  if (!SOURCE_COVERAGE.has(catalog?.sourceCompleteness)) errors.push("sourceCompleteness must be complete, partial, dynamic, or unknown");

  const canonicalPhases = catalog?.canonicalPhases ?? [];
  for (const phase of canonicalPhases) {
    if (!CANONICAL_PHASES.has(phase)) errors.push(`unsupported canonical phase: ${phase}`);
  }
  if (canonicalPhases.length === 0) errors.push("canonicalPhases must not be empty");
  for (const phase of duplicateValues(canonicalPhases)) errors.push(`duplicate canonical phase: ${phase}`);

  const sources = catalog?.sources ?? [];
  const sourceIds = new Set(sources.map((source) => source.id));
  for (const id of duplicateValues(sources.map((source) => source.id))) errors.push(`duplicate source id: ${id}`);
  for (const source of sources) {
    validateId(source.id, `source ${source.id || "<missing>"}`, errors);
    if (!SOURCE_TYPES.has(source.type)) errors.push(`source ${source.id} has unsupported type: ${source.type}`);
    if (!String(source.role ?? "").trim()) errors.push(`source ${source.id} role must be non-empty`);
    if (!String(source.revision ?? "").trim()) errors.push(`source ${source.id} revision must be non-empty`);
    if (!SOURCE_COVERAGE.has(source.coverage)) errors.push(`source ${source.id} has unsupported coverage: ${source.coverage}`);
  }

  const stages = catalog?.stages ?? [];
  const stageIds = new Set(stages.map((stage) => stage.id));
  for (const id of duplicateValues(stages.map((stage) => stage.id))) errors.push(`duplicate stage id: ${id}`);
  for (const stage of stages) {
    validateId(stage.id, `stage ${stage.id || "<missing>"}`, errors);
    if (!stage.id.startsWith(`${catalog.platformId}-`)) errors.push(`stage ${stage.id} must belong to platform ${catalog.platformId}`);
    if (!String(stage.label ?? "").trim()) errors.push(`stage ${stage.id} label must be non-empty`);
    if (!canonicalPhases.includes(stage.canonicalPhase)) {
      errors.push(`stage ${stage.id} references unknown canonical phase: ${stage.canonicalPhase}`);
    }
  }

  const capabilities = catalog?.capabilities ?? [];
  for (const id of duplicateValues(capabilities.map((capability) => capability.id))) errors.push(`duplicate capability id: ${id}`);
  for (const capability of capabilities) {
    validateId(capability.id, `capability ${capability.id || "<missing>"}`, errors);
    if (!capability.id.startsWith(`${catalog.platformId}-`)) {
      errors.push(`capability ${capability.id} must belong to platform ${catalog.platformId}`);
    }
    if (!String(capability.name ?? "").trim()) errors.push(`capability ${capability.id} name must be non-empty`);
    if (!CAPABILITY_KINDS.has(capability.kind)) errors.push(`capability ${capability.id} has unsupported kind: ${capability.kind}`);
    if (!sourceIds.has(capability.sourceId)) errors.push(`capability ${capability.id} references unknown source: ${capability.sourceId}`);
    if (!AVAILABILITY_VALUES.has(capability.availability)) {
      errors.push(`capability ${capability.id} has unsupported availability: ${capability.availability}`);
    }
    if (capability.modes.length === 0) errors.push(`capability ${capability.id} modes must not be empty`);
    if (capability.stageRefs.length === 0) errors.push(`capability ${capability.id} stageRefs must not be empty`);
    for (const stageRef of capability.stageRefs) {
      if (!stageIds.has(stageRef)) errors.push(`capability ${capability.id} references unknown stage: ${stageRef}`);
    }
    if (capability.disciplines.length === 0) errors.push(`capability ${capability.id} disciplines must not be empty`);
    if (!RECOMMENDATION_VALUES.has(capability.recommendation)) {
      errors.push(`capability ${capability.id} has unsupported recommendation: ${capability.recommendation}`);
    }
    if (!capability.sourcePath && sources.find((source) => source.id === capability.sourceId)?.type === "repository") {
      errors.push(`capability ${capability.id} must include a repository source path`);
    }
    if (capability.sourcePath && (path.isAbsolute(capability.sourcePath) || capability.sourcePath.split(/[\\/]/u).includes(".."))) {
      errors.push(`capability ${capability.id} sourcePath must be repository-relative`);
    }
  }

  for (const issue of catalog?.consistencyIssues ?? []) {
    validateId(issue.id, `consistency issue ${issue.id || "<missing>"}`, errors);
    if (!ISSUE_SEVERITIES.has(issue.severity)) errors.push(`consistency issue ${issue.id} has unsupported severity: ${issue.severity}`);
    if (!sourceIds.has(issue.sourceId)) errors.push(`consistency issue ${issue.id} references unknown source: ${issue.sourceId}`);
    if (!String(issue.summary ?? "").trim()) errors.push(`consistency issue ${issue.id} summary must be non-empty`);
  }
  for (const id of duplicateValues((catalog?.consistencyIssues ?? []).map((issue) => issue.id))) {
    errors.push(`duplicate consistency issue id: ${id}`);
  }
  return unique(errors);
}

export function assertValidPlatformSdlcCatalog(catalog) {
  const errors = validatePlatformSdlcCatalog(catalog);
  if (errors.length > 0) {
    throw new Error(`invalid platform SDLC catalog:\n- ${errors.join("\n- ")}`);
  }
  return catalog;
}

export function platformSdlcCatalogPath(platformId) {
  if (!PLATFORM_ID_PATTERN.test(String(platformId ?? ""))) {
    throw new Error(`invalid platform id: ${platformId}`);
  }
  return path.join(PLATFORM_SDLC_CATALOG_ROOT, `${platformId}.md`);
}

export function loadPlatformSdlcCatalog(platformId, options = {}) {
  const catalogPath = path.resolve(options.catalogPath ?? platformSdlcCatalogPath(platformId));
  const datasetPath = options.datasetPath
    ?? path.relative(path.resolve(PLATFORM_SDLC_CATALOG_ROOT, "..", ".."), catalogPath).split(path.sep).join("/");
  const catalog = parsePlatformSdlcCatalog(readFileSync(catalogPath, "utf8"), { datasetPath });
  if (catalog.platformId !== platformId) {
    throw new Error(`catalog ${datasetPath} declares platform ${catalog.platformId}; expected ${platformId}`);
  }
  return assertValidPlatformSdlcCatalog(catalog);
}

export function loadPackagedPlatformSdlcCatalogs() {
  return readdirSync(PLATFORM_SDLC_CATALOG_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.slice(0, -3))
    .sort()
    .map((platformId) => loadPlatformSdlcCatalog(platformId));
}

function runtimeCapabilityEvidenceMap(value) {
  if (value === undefined) return new Map();
  if (!Array.isArray(value)) {
    throw new TypeError("runtimeCapabilityEvidence must be an array of structured evidence records");
  }
  const evidenceByCapability = new Map();
  for (const [index, row] of value.entries()) {
    const prefix = `runtimeCapabilityEvidence[${index}]`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new TypeError(`${prefix} must be an object`);
    }
    const capabilityId = String(row.capabilityId ?? "").trim().toLowerCase();
    if (!capabilityId) throw new TypeError(`${prefix}.capabilityId must be non-empty`);
    const provenance = String(row.provenance ?? "").trim();
    if (!provenance) throw new TypeError(`${prefix}.provenance must be non-empty`);
    if (!Array.isArray(row.evidenceRefs) || row.evidenceRefs.length === 0) {
      throw new TypeError(`${prefix}.evidenceRefs must be a non-empty array`);
    }
    const evidenceRefs = row.evidenceRefs.map((reference, referenceIndex) => {
      const kind = String(reference?.kind ?? "").trim();
      const id = String(reference?.id ?? "").trim();
      if (!kind || !id) {
        throw new TypeError(`${prefix}.evidenceRefs[${referenceIndex}] must contain non-empty kind and id`);
      }
      return { kind, id };
    });
    if (evidenceByCapability.has(capabilityId)) {
      throw new TypeError(`${prefix}.capabilityId duplicates runtime evidence for ${capabilityId}`);
    }
    const optionalContext = {};
    for (const field of ["surface", "mode"]) {
      if (row[field] === undefined) continue;
      const normalized = String(row[field]).trim();
      if (!normalized) throw new TypeError(`${prefix}.${field} must be non-empty when supplied`);
      optionalContext[field] = normalized;
    }
    evidenceByCapability.set(capabilityId, {
      capabilityId,
      provenance,
      evidenceRefs,
      ...optionalContext,
    });
  }
  return evidenceByCapability;
}

export function projectWorkflowDemandCapabilities(catalogs, options = {}) {
  if (options.runtimeAvailableCapabilityIds !== undefined) {
    throw new TypeError("runtimeAvailableCapabilityIds is not accepted; use structured runtimeCapabilityEvidence");
  }
  const catalogRows = Array.isArray(catalogs) ? catalogs : [catalogs];
  const runtimeEvidence = runtimeCapabilityEvidenceMap(options.runtimeCapabilityEvidence);
  const knownCapabilityIds = new Set(catalogRows.flatMap((catalog) =>
    catalog.capabilities.map((capability) => capability.id.toLowerCase())));
  for (const capabilityId of runtimeEvidence.keys()) {
    if (!knownCapabilityIds.has(capabilityId)) {
      throw new TypeError(`runtimeCapabilityEvidence references unknown capability id: ${capabilityId}`);
    }
  }
  return catalogRows.flatMap((catalog) =>
    catalog.capabilities.flatMap((capability) => {
      const runtimeContext = runtimeEvidence.get(capability.id.toLowerCase());
      if (capability.recommendation !== "default" && !runtimeContext) return [];
      if (capability.workflowIntents.length === 0) return [];
      const catalogEvidenceRef = { kind: "repository-file", id: catalog.datasetPath };
      return [{
        id: capability.id,
        name: capability.name,
        kind: capability.kind,
        host: catalog.platformId,
        workflowIntents: [...capability.workflowIntents],
        routingState: runtimeContext ? "runtime-context-candidate" : "catalog-default-candidate",
        routingEvidenceState: runtimeContext ? "runtime-context-evidence" : "catalog-metadata-only",
        evidenceRefs: runtimeContext
          ? [catalogEvidenceRef, ...runtimeContext.evidenceRefs]
          : [catalogEvidenceRef],
        ...(runtimeContext ? {
          runtimeContextEvidence: {
            provenance: runtimeContext.provenance,
            evidenceRefs: runtimeContext.evidenceRefs,
            ...(runtimeContext.surface ? { surface: runtimeContext.surface } : {}),
            ...(runtimeContext.mode ? { mode: runtimeContext.mode } : {}),
          },
        } : {}),
      }];
    }));
}

function markdownNames(values) {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join("<br>") : "—";
}

export function renderPlatformSdlcMatrix(catalog) {
  const lines = [
    `# ${catalog.displayName} SDLC Capability Matrix`,
    "",
    `Catalog completeness: **${catalog.sourceCompleteness}**. Catalogued does not mean used or effective.`,
    "",
    "| Platform stage | Canonical phase | Catalogued capabilities | Default workflow trials | Runtime-context capabilities |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const stage of catalog.stages) {
    const capabilities = catalog.capabilities.filter((capability) => capability.stageRefs.includes(stage.id));
    const defaults = capabilities.filter((capability) => capability.recommendation === "default");
    const context = capabilities.filter((capability) => capability.recommendation === "runtime-context");
    lines.push(`| ${stage.label} | ${stage.canonicalPhase} | ${markdownNames(capabilities.map((row) => row.name))} | ${markdownNames(defaults.map((row) => row.name))} | ${markdownNames(context.map((row) => row.name))} |`);
  }
  return `${lines.join("\n")}\n`;
}

function normalizeGitPath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function compareQoderProductSourceSnapshot(catalog, snapshot) {
  const errors = [];
  const productSource = catalog.sources.find((source) => source.id === QODER_PRODUCT_RUNTIME_SOURCE_ID);
  if (!productSource) return [`catalog has no ${QODER_PRODUCT_RUNTIME_SOURCE_ID} source`];
  if (snapshot?.revision !== productSource.revision) {
    errors.push(`product source revision ${snapshot?.revision ?? "<missing>"} does not match catalog ${productSource.revision}`);
  }
  const catalogSkills = catalog.capabilities
    .filter((capability) => capability.sourceId === QODER_PRODUCT_RUNTIME_SOURCE_ID
      && capability.kind === "skill"
      && capability.sourcePath?.startsWith(QODER_PRODUCT_RUNTIME_SKILL_ROOT))
    .map((capability) => ({ path: normalizeGitPath(capability.sourcePath), name: capability.name }));
  const snapshotSkills = (snapshot?.skills ?? []).map((skill) => ({ path: normalizeGitPath(skill.path), name: skill.name }));
  const catalogByPath = new Map(catalogSkills.map((skill) => [skill.path, skill]));
  const snapshotByPath = new Map(snapshotSkills.map((skill) => [skill.path, skill]));
  for (const [skillPath, skill] of catalogByPath) {
    if (!snapshotByPath.has(skillPath)) errors.push(`catalogued embedded Skill is missing from the product source: ${skillPath}`);
    else if (snapshotByPath.get(skillPath).name !== skill.name) {
      errors.push(`product source Skill ${skillPath} declares name ${snapshotByPath.get(skillPath).name}; catalog has ${skill.name}`);
    }
  }
  for (const skillPath of snapshotByPath.keys()) {
    if (!catalogByPath.has(skillPath)) errors.push(`uncatalogued product source Skill: ${skillPath}`);
  }
  return errors.sort();
}

function frontmatterName(markdown, sourcePath) {
  const match = /^name:\s*["']?([^\n"']+?)["']?\s*$/mu.exec(markdown);
  if (!match) throw new Error(`could not read frontmatter name from ${sourcePath}`);
  return match[1].trim();
}

export function readQoderProductSourceSnapshot(sourceRoot) {
  const root = path.resolve(sourceRoot);
  const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const stdout = execFileSync(
    "git",
    ["-C", root, "ls-files", "-z", "--", `${QODER_PRODUCT_RUNTIME_SKILL_ROOT}*/SKILL.md`],
    { encoding: "utf8" },
  );
  const files = stdout.split("\0").map(normalizeGitPath).filter(Boolean).sort();
  return {
    revision,
    skills: files.map((sourcePath) => ({
      path: sourcePath,
      name: frontmatterName(readFileSync(path.join(root, ...sourcePath.split("/")), "utf8"), sourcePath),
    })),
  };
}
