import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SKILL_PATTERN_RECORD_KIND,
  SKILL_PATTERN_SCHEMA_VERSION,
  skillPatternBindingHash,
  validateSkillPatternRecord,
} from "./skill-pattern-record.mjs";

export {
  SKILL_PATTERN_RECORD_KIND,
  SKILL_PATTERN_SCHEMA_VERSION,
  validateSkillPatternRecord,
} from "./skill-pattern-record.mjs";

export const SKILL_PATTERN_CASES_KIND = "session-skill-pattern-cases";
export const SKILL_PATTERN_DISCOVERY_PACKET_KIND = "session-skill-pattern-discovery-packet";
export const SKILL_PATTERN_DISCOVERY_RESULT_KIND = "session-skill-pattern-discovery";
export const SKILL_PATTERN_FREEZE_KIND = "session-skill-pattern-freeze-receipt";
export const SKILL_PATTERN_PACKET_KIND = "session-skill-pattern-packet";
export const SKILL_PATTERN_RESULT_KIND = "session-skill-pattern-analysis";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SKILL_PATTERN_CASES_FILE = path.resolve(
  MODULE_DIR,
  "../../benchmark/session-evidence-jsonl/v1/skill-pattern-cases.json",
);

const CASE_FIELDS = ["caseId", "sourceKind", "replicaGroup", "replayFiles", "inspection", "capabilityInventory", "ownerArtifacts", "omissions"];
const SYNTHETIC_CASE_FIELDS = ["caseId", "sourceKind", "metamorphicGroup", "episodes", "inspection", "capabilityInventory", "ownerArtifacts", "omissions"];
const MATERIAL_PACKET_FIELDS = ["kind", "schemaVersion", "packetId", "episodes", "provenance", "inspection", "capabilityInventory", "ownerArtifacts", "omissions", "availableEvidenceRefs"];
const PACKET_FIELDS = [...MATERIAL_PACKET_FIELDS, "patternFreeze"];
const DISCOVERY_PACKET_FIELDS = ["kind", "schemaVersion", "packetId", "episodes", "provenance", "availableEvidenceRefs"];
const PATTERN_FREEZE_FIELDS = ["kind", "packetId", "discoveryPacketHash", "discoveryResultHash", "result"];
const PACKET_PROVENANCE_FIELDS = ["sourceKind", "benchmarkGenerated", "organicDemandEvidence", "workflowDemandId", "inputs"];
const INPUT_PROVENANCE_FIELDS = ["ref", "kind", "provider", "replicaGroup", "sourceEpisodeId", "sourceLocator", "contentHash", "derivation"];
const INSPECTION_FIELDS = ["ref", "capabilityInventory", "ownerChain"];
const EPISODE_FIELDS = ["ref", "inputRef", "turns"];
const TURN_FIELDS = ["ref", "userPrompt", "assistantResponse", "responseTruncated", "toolCategories"];
const RAW_EPISODE_FIELDS = ["replicaGroup", "turns"];
const RAW_TURN_FIELDS = ["userPrompt", "assistantResponse", "toolCategories"];
const CAPABILITY_FIELDS = ["ref", "kind", "name", "description", "actualInstructions", "catalogMetadata", "availability", "modes", "gating", "availabilityContext", "sourceCompleteness", "contextEvidenceRefs", "useEvidenceRefs", "provenance"];
const AVAILABILITY_CONTEXT_FIELDS = ["runtimeSurface", "currentMode", "agentScope", "discoveryState", "visibility", "invocationPermission", "invocation"];
const OWNER_FIELDS = ["ref", "kind", "name", "excerpt", "provenance"];
const OMISSION_FIELDS = ["ref", "scope", "status", "relatedRefs", "reason"];
const SOURCE_PROVENANCE_FIELDS = ["sourceKind", "sourceLocator", "revision"];
const ARTIFACT_PROVENANCE_FIELDS = [...SOURCE_PROVENANCE_FIELDS, "materialHash"];
const RESULT_FIELDS = ["kind", "schemaVersion", "packetId", "patterns", "rejectedClusters", "noPatternReason"];
const PATTERN_FIELDS = ["candidateId", "pattern", "support", "capabilityAssessments", "ownerAssessment", "confidence", "assumptions", "uncertainties", "summary"];
const DISCOVERY_PATTERN_FIELDS = ["candidateId", "pattern", "support", "confidence", "assumptions", "uncertainties", "summary"];
const WORKFLOW_FIELDS = ["trigger", "context", "procedure", "output", "validation", "failureBoundary"];
const SUPPORT_FIELDS = ["episodeRefs", "evidenceRefs", "recurrence"];
const CAPABILITY_ASSESSMENT_FIELDS = ["capabilityRef", "relationship", "evidenceRefs", "rationale"];
const OWNER_ASSESSMENT_FIELDS = ["recommendedAction", "targetRef", "targetKind", "proposedName", "rationale"];
const REJECTED_CLUSTER_FIELDS = ["clusterId", "episodeRefs", "evidenceRefs", "reason"];

const CAPABILITY_KINDS = new Set(["configured-skill", "observed-skill", "platform-capability"]);
const CAPABILITY_AVAILABILITY = new Set(["observed", "configured", "built-in", "mode-restricted", "feature-gated", "agent-private", "unknown"]);
const CAPABILITY_GATING = new Set(["not-required", "satisfied", "unsatisfied", "unknown"]);
const RUNTIME_SURFACES = new Set(["ide", "cli", "sdk", "unknown"]);
const AGENT_SCOPES = new Set(["global", "ide-agent", "coding-agent", "knowledge-agent", "subagent", "session-agent", "unknown"]);
const DISCOVERY_STATES = new Set(["discovered", "not-discovered", "not-inspected", "unknown"]);
const VISIBILITY_STATES = new Set(["visible", "name-only", "user-invocable-only", "hidden", "disabled", "not-inspected", "unknown"]);
const INVOCATION_PERMISSIONS = new Set(["allowed", "denied", "not-inspected", "unknown"]);
const INVOCATION_STATES = new Set(["observed", "not-observed", "not-inspected", "unknown"]);
const SOURCE_COMPLETENESS = new Set(["complete", "partial", "unknown"]);
const OWNER_KINDS = new Set(["documentation", "script", "test", "configuration", "runtime", "policy", "product-code"]);
const OMISSION_SCOPES = new Set(["platform-catalog", "capability-content", "runtime-context", "capability-use", "session-evidence", "other"]);
const OMISSION_STATUSES = new Set(["partial", "unavailable", "unknown", "not-observed"]);
const INSPECTION_STATES = new Set(["complete", "partial", "unavailable"]);
const INPUT_KINDS = new Set(["sanitized-replay", "synthetic-fixture", "privacy-safe-task-episode"]);
const ORGANIC_INPUT_KIND = "privacy-safe-task-episode";
const ORGANIC_DERIVATION = "task-episode-semantic-projection-v1";
const RECOMMENDED_ACTIONS = new Set([
  "covered-observed",
  "try-platform-built-in",
  "try-configured-skill",
  "extend-skill",
  "create-skill",
  "not-a-skill",
  "needs-more-evidence",
]);
const CAPABILITY_RELATIONSHIPS = new Set(["complete", "partial", "adjacent", "irrelevant", "unknown"]);
const RECURRENCE_STATES = new Set(["single-episode", "cross-episode", "replica-only", "uncertain"]);
const TARGET_KINDS = new Set(["skill", "platform-capability", "owner-artifact", "new-skill", "unresolved"]);
const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);
const PACKET_FORBIDDEN_KEYS = new Set([
  "taskFamily",
  "workflowPattern",
  "coverage",
  "owns",
  "missing",
  "comparableEpisodes",
  "recurrenceSupported",
  "semanticSimilarity",
  "smallestOwner",
  "ownerDecision",
  "ownerAssessment",
  "recommendedAction",
]);
const PRIVATE_KEYS = new Set([
  "sessionId",
  "workspace",
  "home",
  "providerHome",
  "sourceRevision",
  "sourceRepository",
  "modelHash",
  "stableSessionId",
  "rawTranscript",
  "transcript",
  "reasoning",
  "reasoningContent",
  "promptHash",
  "outputHash",
  "requestId",
  "responseId",
  "toolInput",
  "toolOutput",
  "toolBodies",
  "providerPayload",
  "providerWrapper",
  "commandText",
  "absolutePath",
]);
const PRIVATE_TEXT_RE = /(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b[A-Za-z0-9_]*(?:password|secret|token|api[_-]?key)\s*[:=]\s*(?!<redacted>)[^\s,;]+)/iu;
const POSIX_ABSOLUTE_PATH_RE = /(?:^|[\s"'`(<])\/(?!\/)[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~+@%-]+)+(?:$|[\s"'`)>.,;:])/u;
const WINDOWS_ABSOLUTE_PATH_RE = /(?:^|[\s"'`(<])(?:[A-Za-z]:\\|\\\\)[^\s"'`<>]+/u;
const FILE_URI_RE = /\bfile:\/\/(?:\/[A-Za-z0-9._~%-]+|[A-Za-z]:\/)[^\s"'`<>]*/iu;
const HOME_SHORTHAND_PATH_RE = /(?:^|[\s"'`(<])~[\\/][^\s"'`<>]+/u;
const REF_RE = /^[A-Z][A-Z0-9-]{2,63}$/u;
const HASH_RE = /^[a-f0-9]{16}$/u;
const CASE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PACKET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/u;
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value, fields, prefix) {
  if (!isObject(value)) return [`${prefix} must be an object`];
  const errors = [];
  for (const field of fields) {
    if (!(field in value)) errors.push(`${prefix}.${field} is required`);
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) errors.push(`${prefix}.${field} is not supported`);
  }
  return errors;
}

function uniqueStrings(value, { allowEmpty = false } = {}) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((entry) => typeof entry === "string" && entry.length > 0)
    && new Set(value).size === value.length;
}

function meaningfulText(value, minimum = 4, maximum = Number.POSITIVE_INFINITY) {
  return typeof value === "string" && value.trim().length >= minimum && value.length <= maximum;
}

function clone(value) {
  return structuredClone(value);
}

function contentHash(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function publicCaseId(evalCase) {
  return `ssp-${contentHash(`session-skill-pattern:${evalCase.caseId}`).slice(0, 12)}`;
}

function opaqueReplicaGroup(value) {
  return `replica-${contentHash(`session-skill-replica:${value}`)}`;
}

function safeRelativeLocator(value) {
  if (!meaningfulText(value, 1, 240)) return false;
  const normalized = value.replaceAll("\\", "/");
  return !path.isAbsolute(value)
    && !path.win32.isAbsolute(value)
    && !normalized.split("/").includes("..");
}

function recursiveKeyErrors(value, prefix, { packet = false } = {}) {
  if (!value || typeof value !== "object") return [];
  const errors = [];
  for (const [key, entry] of Object.entries(value)) {
    const field = `${prefix}.${key}`;
    if (PRIVATE_KEYS.has(key)) errors.push(`${field} is private`);
    if (packet && (PACKET_FORBIDDEN_KEYS.has(key) || key.toLowerCase().startsWith("expected"))) {
      errors.push(`${field} is a semantic label and is forbidden in a pattern packet`);
    }
    if (entry && typeof entry === "object") errors.push(...recursiveKeyErrors(entry, field, { packet }));
  }
  return errors;
}

function privateTextErrors(value, prefix) {
  const errors = [];
  const visit = (entry, field) => {
    if (typeof entry === "string") {
      if (PRIVATE_TEXT_RE.test(entry)
        || POSIX_ABSOLUTE_PATH_RE.test(entry)
        || WINDOWS_ABSOLUTE_PATH_RE.test(entry)
        || FILE_URI_RE.test(entry)
        || HOME_SHORTHAND_PATH_RE.test(entry)) {
        errors.push(`${field} contains private evidence`);
      }
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${field}[${index}]`));
      return;
    }
    if (isObject(entry)) {
      for (const [key, item] of Object.entries(entry)) visit(item, `${field}.${key}`);
    }
  };
  visit(value, prefix);
  return errors;
}

function sourceProvenanceErrors(value, prefix, { material = false } = {}) {
  const errors = exactFields(value, material ? ARTIFACT_PROVENANCE_FIELDS : SOURCE_PROVENANCE_FIELDS, prefix);
  if (!isObject(value)) return errors;
  if (!meaningfulText(value.sourceKind, 3, 64)) errors.push(`${prefix}.sourceKind is invalid`);
  if (!safeRelativeLocator(value.sourceLocator)) errors.push(`${prefix}.sourceLocator must be a safe relative locator`);
  if (value.revision !== null && !meaningfulText(value.revision, 7, 64)) errors.push(`${prefix}.revision is invalid`);
  if (material && !HASH_RE.test(value.materialHash ?? "")) errors.push(`${prefix}.materialHash is invalid`);
  return errors;
}

function capabilityErrors(value, prefix, { material = false } = {}) {
  const errors = exactFields(value, CAPABILITY_FIELDS, prefix);
  if (!isObject(value)) return errors;
  if (!REF_RE.test(value.ref ?? "")) errors.push(`${prefix}.ref is invalid`);
  if (!CAPABILITY_KINDS.has(value.kind)) errors.push(`${prefix}.kind is invalid`);
  if (!meaningfulText(value.name, 2, 96)) errors.push(`${prefix}.name is invalid`);
  if (value.description !== null && !meaningfulText(value.description, 4, 800)) errors.push(`${prefix}.description is invalid`);
  if (value.actualInstructions !== null && !meaningfulText(value.actualInstructions, 4, 2000)) errors.push(`${prefix}.actualInstructions is invalid`);
  if (value.catalogMetadata !== null && !meaningfulText(value.catalogMetadata, 4, 2000)) errors.push(`${prefix}.catalogMetadata is invalid`);
  if (value.actualInstructions === null && value.catalogMetadata === null) errors.push(`${prefix} must expose actual instructions or catalog metadata`);
  if (!CAPABILITY_AVAILABILITY.has(value.availability)) errors.push(`${prefix}.availability is invalid`);
  if (!uniqueStrings(value.modes, { allowEmpty: true })) errors.push(`${prefix}.modes must be unique strings`);
  if (!CAPABILITY_GATING.has(value.gating)) errors.push(`${prefix}.gating is invalid`);
  errors.push(...exactFields(value.availabilityContext, AVAILABILITY_CONTEXT_FIELDS, `${prefix}.availabilityContext`));
  if (isObject(value.availabilityContext)) {
    if (!RUNTIME_SURFACES.has(value.availabilityContext.runtimeSurface)) errors.push(`${prefix}.availabilityContext.runtimeSurface is invalid`);
    if (value.availabilityContext.currentMode !== null && !meaningfulText(value.availabilityContext.currentMode, 2, 48)) errors.push(`${prefix}.availabilityContext.currentMode is invalid`);
    if (!AGENT_SCOPES.has(value.availabilityContext.agentScope)) errors.push(`${prefix}.availabilityContext.agentScope is invalid`);
    if (!DISCOVERY_STATES.has(value.availabilityContext.discoveryState)) errors.push(`${prefix}.availabilityContext.discoveryState is invalid`);
    if (!VISIBILITY_STATES.has(value.availabilityContext.visibility)) errors.push(`${prefix}.availabilityContext.visibility is invalid`);
    if (!INVOCATION_PERMISSIONS.has(value.availabilityContext.invocationPermission)) errors.push(`${prefix}.availabilityContext.invocationPermission is invalid`);
    if (!INVOCATION_STATES.has(value.availabilityContext.invocation)) errors.push(`${prefix}.availabilityContext.invocation is invalid`);
  }
  if (!SOURCE_COMPLETENESS.has(value.sourceCompleteness)) errors.push(`${prefix}.sourceCompleteness is invalid`);
  if (!uniqueStrings(value.contextEvidenceRefs, { allowEmpty: true })) errors.push(`${prefix}.contextEvidenceRefs must be unique refs`);
  if (!uniqueStrings(value.useEvidenceRefs, { allowEmpty: true })) errors.push(`${prefix}.useEvidenceRefs must be unique refs`);
  errors.push(...sourceProvenanceErrors(value.provenance, `${prefix}.provenance`, { material }));
  if (material && value.provenance?.materialHash !== contentHash(capabilityMaterial(value))) {
    errors.push(`${prefix}.provenance.materialHash does not match the visible capability material`);
  }
  return errors;
}

function capabilityMaterial(value) {
  return Object.fromEntries(CAPABILITY_FIELDS
    .filter((field) => !["ref", "provenance"].includes(field))
    .map((field) => [field, value[field]]));
}

function ownerArtifactErrors(value, prefix, { material = false } = {}) {
  const errors = exactFields(value, OWNER_FIELDS, prefix);
  if (!isObject(value)) return errors;
  if (!REF_RE.test(value.ref ?? "")) errors.push(`${prefix}.ref is invalid`);
  if (!OWNER_KINDS.has(value.kind)) errors.push(`${prefix}.kind is invalid`);
  if (!meaningfulText(value.name, 2, 120)) errors.push(`${prefix}.name is invalid`);
  if (!meaningfulText(value.excerpt, 4, 2000)) errors.push(`${prefix}.excerpt is invalid`);
  errors.push(...sourceProvenanceErrors(value.provenance, `${prefix}.provenance`, { material }));
  if (material && value.provenance?.materialHash !== contentHash(value.excerpt)) {
    errors.push(`${prefix}.provenance.materialHash does not match the visible owner excerpt`);
  }
  return errors;
}

function omissionErrors(value, prefix) {
  const errors = exactFields(value, OMISSION_FIELDS, prefix);
  if (!isObject(value)) return errors;
  if (!REF_RE.test(value.ref ?? "")) errors.push(`${prefix}.ref is invalid`);
  if (!OMISSION_SCOPES.has(value.scope)) errors.push(`${prefix}.scope is invalid`);
  if (!OMISSION_STATUSES.has(value.status)) errors.push(`${prefix}.status is invalid`);
  if (!uniqueStrings(value.relatedRefs, { allowEmpty: true })) errors.push(`${prefix}.relatedRefs must be unique refs`);
  if (!meaningfulText(value.reason, 12, 800)) errors.push(`${prefix}.reason is invalid`);
  return errors;
}

function rawEpisodeErrors(value, prefix) {
  const errors = exactFields(value, RAW_EPISODE_FIELDS, prefix);
  if (!isObject(value)) return errors;
  if (!meaningfulText(value.replicaGroup, 3, 96)) errors.push(`${prefix}.replicaGroup is invalid`);
  if (!Array.isArray(value.turns) || value.turns.length === 0) {
    errors.push(`${prefix}.turns must be a non-empty array`);
    return errors;
  }
  for (const [index, turn] of value.turns.entries()) {
    const turnPrefix = `${prefix}.turns[${index}]`;
    errors.push(...exactFields(turn, RAW_TURN_FIELDS, turnPrefix));
    if (!meaningfulText(turn?.userPrompt, 1, 4000)) errors.push(`${turnPrefix}.userPrompt is invalid`);
    if (turn?.assistantResponse !== null && !meaningfulText(turn?.assistantResponse, 1, 8001)) {
      errors.push(`${turnPrefix}.assistantResponse is invalid`);
    }
    if (!uniqueStrings(turn?.toolCategories, { allowEmpty: true })) errors.push(`${turnPrefix}.toolCategories must be unique strings`);
  }
  return errors;
}

function caseCorpusErrors(corpus) {
  const errors = exactFields(corpus, ["kind", "schemaVersion", "cases"], "cases");
  if (!isObject(corpus)) return errors;
  if (corpus.kind !== SKILL_PATTERN_CASES_KIND || corpus.schemaVersion !== SKILL_PATTERN_SCHEMA_VERSION) {
    errors.push("case corpus identity is invalid");
  }
  if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) {
    errors.push("cases.cases must be a non-empty array");
    return errors;
  }
  const ids = new Set();
  for (const [index, evalCase] of corpus.cases.entries()) {
    const prefix = `cases.cases[${index}]`;
    const fields = evalCase?.sourceKind === "synthetic-metamorphic" ? SYNTHETIC_CASE_FIELDS : CASE_FIELDS;
    errors.push(...exactFields(evalCase, fields, prefix));
    if (!isObject(evalCase)) continue;
    if (!CASE_ID_RE.test(evalCase.caseId ?? "")) errors.push(`${prefix}.caseId is invalid`);
    if (ids.has(evalCase.caseId)) errors.push(`${prefix}.caseId is duplicated`);
    ids.add(evalCase.caseId);
    if (!Array.isArray(evalCase.capabilityInventory)) errors.push(`${prefix}.capabilityInventory must be an array`);
    if (!Array.isArray(evalCase.ownerArtifacts)) errors.push(`${prefix}.ownerArtifacts must be an array`);
    if (!Array.isArray(evalCase.omissions)) errors.push(`${prefix}.omissions must be an array`);
    errors.push(...exactFields(evalCase.inspection, INSPECTION_FIELDS, `${prefix}.inspection`));
    if (isObject(evalCase.inspection)) {
      if (!REF_RE.test(evalCase.inspection.ref ?? "")) errors.push(`${prefix}.inspection.ref is invalid`);
      if (!INSPECTION_STATES.has(evalCase.inspection.capabilityInventory)) errors.push(`${prefix}.inspection.capabilityInventory is invalid`);
      if (!INSPECTION_STATES.has(evalCase.inspection.ownerChain)) errors.push(`${prefix}.inspection.ownerChain is invalid`);
    }
    for (const [itemIndex, item] of (evalCase.capabilityInventory ?? []).entries()) {
      errors.push(...capabilityErrors(item, `${prefix}.capabilityInventory[${itemIndex}]`));
    }
    for (const [itemIndex, item] of (evalCase.ownerArtifacts ?? []).entries()) {
      errors.push(...ownerArtifactErrors(item, `${prefix}.ownerArtifacts[${itemIndex}]`));
    }
    const caseRefs = new Set([
      ...(evalCase.capabilityInventory ?? []).map((item) => item.ref),
      ...(evalCase.ownerArtifacts ?? []).map((item) => item.ref),
    ]);
    for (const [itemIndex, item] of (evalCase.omissions ?? []).entries()) {
      const omissionPrefix = `${prefix}.omissions[${itemIndex}]`;
      errors.push(...omissionErrors(item, omissionPrefix));
      for (const ref of item?.relatedRefs ?? []) {
        if (!caseRefs.has(ref)) errors.push(`${omissionPrefix}.relatedRefs contains unavailable case ref: ${ref}`);
      }
    }
    if (evalCase.sourceKind === "sanitized-replay-pair") {
      if (!meaningfulText(evalCase.replicaGroup, 3, 96)) errors.push(`${prefix}.replicaGroup is invalid`);
      if (!uniqueStrings(evalCase.replayFiles) || evalCase.replayFiles.length !== 2) {
        errors.push(`${prefix}.replayFiles must contain exactly two unique replay locators`);
      }
      for (const locator of evalCase.replayFiles ?? []) {
        if (!safeRelativeLocator(locator) || !locator.endsWith(".jsonl")) errors.push(`${prefix}.replayFiles contains an unsafe locator`);
      }
    } else if (evalCase.sourceKind === "synthetic-metamorphic") {
      if (!meaningfulText(evalCase.metamorphicGroup, 3, 96)) errors.push(`${prefix}.metamorphicGroup is invalid`);
      if (!Array.isArray(evalCase.episodes) || evalCase.episodes.length === 0) errors.push(`${prefix}.episodes must be a non-empty array`);
      for (const [episodeIndex, episode] of (evalCase.episodes ?? []).entries()) {
        errors.push(...rawEpisodeErrors(episode, `${prefix}.episodes[${episodeIndex}]`));
      }
    } else {
      errors.push(`${prefix}.sourceKind is invalid`);
    }
  }
  errors.push(...recursiveKeyErrors(corpus, "cases", { packet: true }));
  errors.push(...privateTextErrors(corpus, "case corpus"));
  return [...new Set(errors)];
}

function materializeCapability(value) {
  const capability = clone(value);
  capability.provenance.materialHash = contentHash(capabilityMaterial(capability));
  return capability;
}

function materializeOwnerArtifact(value) {
  const artifact = clone(value);
  artifact.provenance.materialHash = contentHash(artifact.excerpt);
  return artifact;
}

async function readJsonl(filePath, readText) {
  return (await readText(filePath, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Replay line is not JSON: ${path.basename(filePath)}:${index + 1}`);
      }
    });
}

function replayProjection(rows, locator, index, replicaGroup) {
  if (!Array.isArray(rows) || rows.length < 3) throw new Error(`Replay is incomplete: ${locator}`);
  const metadata = rows[0];
  const boundary = rows.at(-1);
  const turns = rows.slice(1, -1);
  if (metadata?.kind !== "session-evidence-pilot-replay"
    || typeof metadata?.provider !== "string"
    || metadata?.benchmarkGenerated !== true
    || metadata?.organicDemandAdmitted !== false
    || !meaningfulText(metadata?.derivation, 3, 120)) {
    throw new Error(`Replay metadata is not an eligible benchmark projection: ${locator}`);
  }
  if (boundary?.kind !== "boundary"
    || boundary?.rawTranscriptPersisted !== false
    || boundary?.reasoningPersisted !== false
    || boundary?.toolBodiesPersisted !== false
    || boundary?.stableSessionIdPersisted !== false
    || boundary?.absolutePathPersisted !== false
    || boundary?.coverageOraclePersisted !== false
    || boundary?.independentReviewerInputEligible !== true
    || boundary?.humanReviewRequired !== true) {
    throw new Error(`Replay boundary is not eligible for independent pattern review: ${locator}`);
  }
  const inputRef = `INPUT-${index + 1}`;
  const episodeRef = `EPISODE-${index + 1}`;
  const projectedTurns = turns.map((turn, turnIndex) => {
    if (turn?.kind !== "turn"
      || !meaningfulText(turn?.userPrompt, 1, 4000)
      || !meaningfulText(turn?.assistantResponse, 1, 8001)
      || typeof turn?.responseTruncated !== "boolean"
      || !uniqueStrings(turn?.toolCategories, { allowEmpty: true })) {
      throw new Error(`Replay turn is invalid: ${locator}:${turnIndex + 1}`);
    }
    return {
      ref: `TURN-${index + 1}-${turnIndex + 1}`,
      userPrompt: turn.userPrompt,
      assistantResponse: turn.assistantResponse,
      responseTruncated: turn.responseTruncated,
      toolCategories: [...turn.toolCategories],
    };
  });
  return {
    input: {
      ref: inputRef,
      kind: "sanitized-replay",
      provider: metadata.provider,
      replicaGroup: opaqueReplicaGroup(replicaGroup),
      sourceEpisodeId: null,
      sourceLocator: locator.replaceAll("\\", "/"),
      contentHash: contentHash(rows),
      derivation: metadata.derivation,
    },
    episode: {
      ref: episodeRef,
      inputRef,
      turns: projectedTurns,
    },
  };
}

function syntheticProjections(evalCase) {
  const opaqueCaseId = publicCaseId(evalCase);
  return evalCase.episodes.map((episode, index) => {
    const inputRef = `INPUT-${index + 1}`;
    return {
      input: {
        ref: inputRef,
        kind: "synthetic-fixture",
        provider: null,
        replicaGroup: opaqueReplicaGroup(episode.replicaGroup),
        sourceEpisodeId: null,
        sourceLocator: `inline/${opaqueCaseId}/episode-${index + 1}`,
        contentHash: contentHash(episode),
        derivation: "inline-synthetic-metamorphic-case",
      },
      episode: {
        ref: `EPISODE-${index + 1}`,
        inputRef,
        turns: episode.turns.map((turn, turnIndex) => ({
          ref: `TURN-${index + 1}-${turnIndex + 1}`,
          userPrompt: turn.userPrompt,
          assistantResponse: turn.assistantResponse,
          responseTruncated: false,
          toolCategories: [...turn.toolCategories],
        })),
      },
    };
  });
}

function packetEvidenceRefs(packet) {
  return [
    ...(packet.provenance?.inputs ?? []).map((input) => input.ref),
    ...(packet.inspection?.ref ? [packet.inspection.ref] : []),
    ...(packet.episodes ?? []).map((episode) => episode.ref),
    ...(packet.episodes ?? []).flatMap((episode) => (episode.turns ?? []).map((turn) => turn.ref)),
    ...(packet.capabilityInventory ?? []).map((capability) => capability.ref),
    ...(packet.ownerArtifacts ?? []).map((artifact) => artifact.ref),
    ...(packet.omissions ?? []).map((omission) => omission.ref),
  ];
}

function discoveryPacketEvidenceRefs(packet) {
  return [
    ...(packet.provenance?.inputs ?? []).map((input) => input.ref),
    ...(packet.episodes ?? []).map((episode) => episode.ref),
    ...(packet.episodes ?? []).flatMap((episode) => (episode.turns ?? []).map((turn) => turn.ref)),
  ];
}

function projectSkillPatternDiscoveryPacket(materialPacket) {
  const packet = {
    kind: SKILL_PATTERN_DISCOVERY_PACKET_KIND,
    schemaVersion: SKILL_PATTERN_SCHEMA_VERSION,
    packetId: materialPacket.packetId,
    episodes: clone(materialPacket.episodes),
    provenance: clone(materialPacket.provenance),
    availableEvidenceRefs: [],
  };
  packet.availableEvidenceRefs = discoveryPacketEvidenceRefs(packet);
  return packet;
}

export function buildSkillPatternDiscoveryPacket(materialPacket) {
  const materialErrors = validateSkillPatternPacketInternal(materialPacket, { requireFreeze: false });
  if (materialErrors.length > 0) {
    throw new Error(`Cannot build discovery packet from invalid material: ${materialErrors.join(", ")}`);
  }
  const packet = projectSkillPatternDiscoveryPacket(materialPacket);
  const errors = validateSkillPatternDiscoveryPacket(packet);
  if (errors.length > 0) throw new Error(`Cannot build invalid discovery packet: ${errors.join(", ")}`);
  return packet;
}

export function validateSkillPatternDiscoveryPacket(packet) {
  const errors = exactFields(packet, DISCOVERY_PACKET_FIELDS, "discoveryPacket");
  if (!isObject(packet)) return errors;
  if (packet.kind !== SKILL_PATTERN_DISCOVERY_PACKET_KIND
    || packet.schemaVersion !== SKILL_PATTERN_SCHEMA_VERSION) {
    errors.push("discoveryPacket identity is invalid");
  }
  if (!PACKET_ID_RE.test(packet.packetId ?? "")) errors.push("discoveryPacket.packetId is invalid");
  const derivedRefs = discoveryPacketEvidenceRefs(packet);
  if (!uniqueStrings(packet.availableEvidenceRefs)
    || packet.availableEvidenceRefs.length !== derivedRefs.length
    || derivedRefs.some((ref) => !packet.availableEvidenceRefs.includes(ref))) {
    errors.push("discoveryPacket.availableEvidenceRefs must contain exactly the Episode-phase refs");
  }

  // Reuse the production provenance, Episode, recurrence-group, and privacy checks
  // without exposing capability or owner material to the discovery phase.
  const boundaryRef = "DISCOVERY-BOUNDARY";
  const materialView = {
    kind: SKILL_PATTERN_PACKET_KIND,
    schemaVersion: packet.schemaVersion,
    packetId: packet.packetId,
    episodes: clone(packet.episodes),
    provenance: clone(packet.provenance),
    inspection: {
      ref: boundaryRef,
      capabilityInventory: "unavailable",
      ownerChain: "unavailable",
    },
    capabilityInventory: [],
    ownerArtifacts: [],
    omissions: [],
    availableEvidenceRefs: [...derivedRefs, boundaryRef],
  };
  errors.push(...validateSkillPatternPacketInternal(materialView, { requireFreeze: false })
    .map((error) => error.replaceAll("packet.", "discoveryPacket.")));
  errors.push(...skillPatternPacketPrivacyErrors(packet));
  return [...new Set(errors)];
}

export function validateSkillPatternDiscoveryResult(result, packet) {
  const errors = exactFields(result, RESULT_FIELDS, "discoveryResult");
  if (!isObject(result)) return errors;
  if (result.kind !== SKILL_PATTERN_DISCOVERY_RESULT_KIND
    || result.schemaVersion !== SKILL_PATTERN_SCHEMA_VERSION) {
    errors.push("discoveryResult identity is invalid");
  }
  if (result.packetId !== packet?.packetId) {
    errors.push("discoveryResult.packetId must copy discoveryPacket.packetId");
  }
  if (!Array.isArray(result.patterns) || result.patterns.length > 3) {
    errors.push("discoveryResult.patterns must contain zero to three patterns");
  }
  if (!Array.isArray(result.rejectedClusters) || result.rejectedClusters.length > 16) {
    errors.push("discoveryResult.rejectedClusters must contain zero to sixteen clusters");
  }
  if ((result.patterns ?? []).length === 0) {
    if (!meaningfulText(result.noPatternReason, 12, 800)) {
      errors.push("discoveryResult.noPatternReason is required when no patterns are returned");
    }
  } else if (result.noPatternReason !== null) {
    errors.push("discoveryResult.noPatternReason must be null when patterns are returned");
  }

  const availableRefs = new Set(packet?.availableEvidenceRefs ?? []);
  const episodes = new Map((packet?.episodes ?? []).map((episode) => [episode.ref, episode]));
  const inputs = new Map((packet?.provenance?.inputs ?? []).map((input) => [input.ref, input]));
  const candidateIds = new Set();
  for (const [index, pattern] of (result.patterns ?? []).entries()) {
    const prefix = `discoveryResult.patterns[${index}]`;
    errors.push(...exactFields(pattern, DISCOVERY_PATTERN_FIELDS, prefix));
    if (!/^CANDIDATE-[1-9][0-9]*$/u.test(pattern?.candidateId ?? "")) {
      errors.push(`${prefix}.candidateId is invalid`);
    }
    if (candidateIds.has(pattern?.candidateId)) errors.push(`${prefix}.candidateId is duplicated`);
    candidateIds.add(pattern?.candidateId);
    errors.push(...workflowErrors(pattern?.pattern, `${prefix}.pattern`));
    errors.push(...exactFields(pattern?.support, SUPPORT_FIELDS, `${prefix}.support`));
    const support = pattern?.support;
    errors.push(...resultRefErrors(support?.episodeRefs, `${prefix}.support.episodeRefs`, new Set(episodes.keys())));
    errors.push(...resultRefErrors(support?.evidenceRefs, `${prefix}.support.evidenceRefs`, availableRefs));
    for (const episodeRef of support?.episodeRefs ?? []) {
      if (!(support?.evidenceRefs ?? []).includes(episodeRef)) {
        errors.push(`${prefix}.support.evidenceRefs must cite ${episodeRef}`);
      }
    }
    if (!RECURRENCE_STATES.has(support?.recurrence)) errors.push(`${prefix}.support.recurrence is invalid`);
    const replicaGroups = new Set((support?.episodeRefs ?? []).map((episodeRef) => {
      const episode = episodes.get(episodeRef);
      return inputs.get(episode?.inputRef)?.replicaGroup;
    }).filter(Boolean));
    if (support?.recurrence === "single-episode" && support?.episodeRefs?.length !== 1) {
      errors.push(`${prefix}.support single-episode requires exactly one Episode`);
    }
    if (support?.recurrence === "cross-episode"
      && (support?.episodeRefs?.length < 2 || replicaGroups.size < 2)) {
      errors.push(`${prefix}.support cross-episode requires at least two Episodes from different replica groups`);
    }
    if (support?.recurrence === "replica-only"
      && (support?.episodeRefs?.length < 2 || replicaGroups.size !== 1)) {
      errors.push(`${prefix}.support replica-only requires at least two Episodes from one replica group`);
    }
    if (!CONFIDENCE_LEVELS.has(pattern?.confidence)) errors.push(`${prefix}.confidence is invalid`);
    errors.push(...resultTextListErrors(pattern?.assumptions, `${prefix}.assumptions`));
    errors.push(...resultTextListErrors(pattern?.uncertainties, `${prefix}.uncertainties`));
    if (!meaningfulText(pattern?.summary, 12, 800)) errors.push(`${prefix}.summary is invalid`);
  }

  const clusterIds = new Set();
  for (const [index, cluster] of (result.rejectedClusters ?? []).entries()) {
    const prefix = `discoveryResult.rejectedClusters[${index}]`;
    errors.push(...exactFields(cluster, REJECTED_CLUSTER_FIELDS, prefix));
    if (!/^CLUSTER-[1-9][0-9]*$/u.test(cluster?.clusterId ?? "")) errors.push(`${prefix}.clusterId is invalid`);
    if (clusterIds.has(cluster?.clusterId)) errors.push(`${prefix}.clusterId is duplicated`);
    clusterIds.add(cluster?.clusterId);
    errors.push(...resultRefErrors(cluster?.episodeRefs, `${prefix}.episodeRefs`, new Set(episodes.keys())));
    errors.push(...resultRefErrors(cluster?.evidenceRefs, `${prefix}.evidenceRefs`, availableRefs));
    for (const episodeRef of cluster?.episodeRefs ?? []) {
      if (!(cluster?.evidenceRefs ?? []).includes(episodeRef)) errors.push(`${prefix}.evidenceRefs must cite ${episodeRef}`);
    }
    if (!meaningfulText(cluster?.reason, 12, 800)) errors.push(`${prefix}.reason is invalid`);
  }
  errors.push(...resultPrivacyErrors(result));
  return [...new Set(errors)];
}

export function validateSkillPatternFreezeReceipt(freeze, discoveryPacket) {
  const errors = exactFields(freeze, PATTERN_FREEZE_FIELDS, "patternFreeze");
  if (!isObject(freeze)) return errors;
  if (freeze.kind !== SKILL_PATTERN_FREEZE_KIND) errors.push("patternFreeze.kind is invalid");
  if (freeze.packetId !== discoveryPacket?.packetId) {
    errors.push("patternFreeze.packetId must copy the actual discovery packet id");
  }
  const discoveryPacketHash = contentHash(discoveryPacket);
  if (!HASH_RE.test(freeze.discoveryPacketHash ?? "")
    || freeze.discoveryPacketHash !== discoveryPacketHash) {
    errors.push("patternFreeze.discoveryPacketHash does not match the Episode-only packet actually supplied to Phase 1");
  }
  errors.push(...validateSkillPatternDiscoveryResult(freeze.result, discoveryPacket));
  if (!HASH_RE.test(freeze.discoveryResultHash ?? "")
    || freeze.discoveryResultHash !== contentHash(freeze.result)) {
    errors.push("patternFreeze.discoveryResultHash does not match the frozen discovery result");
  }
  return [...new Set(errors)];
}

export function buildSkillPatternFreezeReceipt(discoveryPacket, discoveryResult) {
  const errors = [
    ...validateSkillPatternDiscoveryPacket(discoveryPacket),
    ...validateSkillPatternDiscoveryResult(discoveryResult, discoveryPacket),
  ];
  if (errors.length > 0) {
    throw new Error(`Cannot freeze invalid discovery packet or result: ${[...new Set(errors)].join(", ")}`);
  }
  return {
    kind: SKILL_PATTERN_FREEZE_KIND,
    packetId: discoveryPacket.packetId,
    discoveryPacketHash: contentHash(discoveryPacket),
    discoveryResultHash: contentHash(discoveryResult),
    result: clone(discoveryResult),
  };
}

function patternFreezeErrors(packet) {
  const discoveryPacket = projectSkillPatternDiscoveryPacket(packet);
  return validateSkillPatternFreezeReceipt(packet?.patternFreeze, discoveryPacket)
    .map((error) => error.replace(/^patternFreeze/u, "packet.patternFreeze"));
}

export function buildSkillPatternOwnerPacket(materialPacket, patternFreeze) {
  const materialErrors = validateSkillPatternPacketInternal(materialPacket, { requireFreeze: false });
  if (materialErrors.length > 0) {
    throw new Error(`Cannot build owner packet from invalid material: ${materialErrors.join(", ")}`);
  }
  const discoveryPacket = buildSkillPatternDiscoveryPacket(materialPacket);
  const freezeErrors = validateSkillPatternFreezeReceipt(patternFreeze, discoveryPacket);
  if (freezeErrors.length > 0) {
    throw new Error(`Cannot build owner packet from a freeze receipt that does not bind the supplied material: ${freezeErrors.join(", ")}`);
  }
  const packet = {
    ...clone(materialPacket),
    patternFreeze: clone(patternFreeze),
  };
  const errors = validateSkillPatternPacket(packet);
  if (errors.length > 0) throw new Error(`Cannot build invalid owner packet: ${errors.join(", ")}`);
  return packet;
}

function relatedOmissions(packet, capabilityRef, scope, statuses = null) {
  return (packet?.omissions ?? []).filter((omission) => omission.scope === scope
    && omission.relatedRefs.includes(capabilityRef)
    && (statuses === null || statuses.includes(omission.status)));
}

export function skillPatternPacketPrivacyErrors(packet) {
  return [...new Set([
    ...recursiveKeyErrors(packet, "packet", { packet: true }),
    ...privateTextErrors(packet, "packet"),
  ])];
}

function validateSkillPatternPacketInternal(packet, { requireFreeze = true } = {}) {
  const errors = exactFields(packet, requireFreeze ? PACKET_FIELDS : MATERIAL_PACKET_FIELDS, "packet");
  if (!isObject(packet)) return errors;
  if (packet.kind !== SKILL_PATTERN_PACKET_KIND || packet.schemaVersion !== SKILL_PATTERN_SCHEMA_VERSION) {
    errors.push("packet identity is invalid");
  }
  if (!PACKET_ID_RE.test(packet.packetId ?? "")) errors.push("packet.packetId is invalid");
  errors.push(...exactFields(packet.provenance, PACKET_PROVENANCE_FIELDS, "packet.provenance"));
  if (isObject(packet.provenance)) {
    if (!meaningfulText(packet.provenance.sourceKind, 3, 64)) errors.push("packet.provenance.sourceKind is invalid");
    if (typeof packet.provenance.benchmarkGenerated !== "boolean") errors.push("packet.provenance.benchmarkGenerated must be boolean");
    if (typeof packet.provenance.organicDemandEvidence !== "boolean") errors.push("packet.provenance.organicDemandEvidence must be boolean");
    if (packet.provenance.benchmarkGenerated === true && packet.provenance.organicDemandEvidence === true) {
      errors.push("benchmark-generated packets cannot be admitted as organic demand evidence");
    }
    if (packet.provenance.workflowDemandId !== null
      && !meaningfulText(packet.provenance.workflowDemandId, 3, 128)) {
      errors.push("packet.provenance.workflowDemandId must be null or a bounded id");
    }
    if (!Array.isArray(packet.provenance.inputs) || packet.provenance.inputs.length === 0) {
      errors.push("packet.provenance.inputs must be a non-empty array");
    }
    for (const [index, input] of (packet.provenance.inputs ?? []).entries()) {
      const prefix = `packet.provenance.inputs[${index}]`;
      errors.push(...exactFields(input, INPUT_PROVENANCE_FIELDS, prefix));
      if (!REF_RE.test(input?.ref ?? "")) errors.push(`${prefix}.ref is invalid`);
      if (!meaningfulText(input?.kind, 3, 64)) errors.push(`${prefix}.kind is invalid`);
      else if (!INPUT_KINDS.has(input.kind)) errors.push(`${prefix}.kind is unsupported`);
      if (input?.provider !== null && !meaningfulText(input?.provider, 2, 48)) errors.push(`${prefix}.provider is invalid`);
      if (!meaningfulText(input?.replicaGroup, 3, 96)) errors.push(`${prefix}.replicaGroup is invalid`);
      if (input?.sourceEpisodeId !== null && !meaningfulText(input?.sourceEpisodeId, 3, 128)) {
        errors.push(`${prefix}.sourceEpisodeId must be null or a bounded id`);
      }
      if (!safeRelativeLocator(input?.sourceLocator)) errors.push(`${prefix}.sourceLocator must be a safe relative locator`);
      if (!HASH_RE.test(input?.contentHash ?? "")) errors.push(`${prefix}.contentHash is invalid`);
      if (!meaningfulText(input?.derivation, 3, 120)) errors.push(`${prefix}.derivation is invalid`);
    }
    if (packet.provenance.organicDemandEvidence === true) {
      if (!meaningfulText(packet.provenance.workflowDemandId, 3, 128)) {
        errors.push("organic Skill pattern packets require workflowDemandId");
      }
      if ((packet.provenance.inputs ?? []).some((input) => !meaningfulText(input?.sourceEpisodeId, 3, 128))) {
        errors.push("organic Skill pattern packets require every input to bind one sourceEpisodeId");
      }
      if ((packet.provenance.inputs ?? []).some((input) => input?.kind !== ORGANIC_INPUT_KIND
        || input?.derivation !== ORGANIC_DERIVATION)) {
        errors.push("organic Skill pattern packets require task-Episode projections from the trusted session evidence adapter");
      }
    }
    if (packet.provenance.benchmarkGenerated === true
      && (packet.provenance.workflowDemandId !== null
        || (packet.provenance.inputs ?? []).some((input) => input?.sourceEpisodeId !== null))) {
      errors.push("benchmark-generated packets cannot claim production workflow or Episode bindings");
    }
    if (packet.provenance.benchmarkGenerated === true
      && (packet.provenance.inputs ?? []).some((input) => input?.kind === ORGANIC_INPUT_KIND
        || input?.derivation === ORGANIC_DERIVATION)) {
      errors.push("benchmark-generated packets cannot claim trusted task-Episode projection provenance");
    }
    if (packet.provenance.sourceKind === "sanitized-replay-pair") {
      if (packet.provenance.inputs?.length !== 2 || packet.episodes?.length !== 2) errors.push("a replay-pair packet must contain exactly two inputs and two episodes");
      if (packet.provenance.organicDemandEvidence !== false) errors.push("provider replicas cannot be admitted as organic demand evidence");
      const providers = (packet.provenance.inputs ?? []).map((input) => input.provider);
      if (providers.some((provider) => provider === null) || new Set(providers).size !== providers.length) errors.push("replay-pair providers must be present and distinct");
      const replicaGroups = new Set((packet.provenance.inputs ?? []).map((input) => input.replicaGroup));
      if (replicaGroups.size !== 1) errors.push("a replay-pair packet must keep both inputs in one replicaGroup");
    }
  }
  errors.push(...exactFields(packet.inspection, INSPECTION_FIELDS, "packet.inspection"));
  if (isObject(packet.inspection)) {
    if (!REF_RE.test(packet.inspection.ref ?? "")) errors.push("packet.inspection.ref is invalid");
    if (!INSPECTION_STATES.has(packet.inspection.capabilityInventory)) errors.push("packet.inspection.capabilityInventory is invalid");
    if (!INSPECTION_STATES.has(packet.inspection.ownerChain)) errors.push("packet.inspection.ownerChain is invalid");
    if (packet.inspection.ownerChain === "complete" && (packet.ownerArtifacts ?? []).length === 0) {
      errors.push("packet.inspection.ownerChain complete requires bounded owner artifacts");
    }
  }
  if (!Array.isArray(packet.episodes) || packet.episodes.length === 0) errors.push("packet.episodes must be a non-empty array");
  const inputRefs = new Set((packet.provenance?.inputs ?? []).map((input) => input.ref));
  for (const [index, episode] of (packet.episodes ?? []).entries()) {
    const prefix = `packet.episodes[${index}]`;
    errors.push(...exactFields(episode, EPISODE_FIELDS, prefix));
    if (!REF_RE.test(episode?.ref ?? "")) errors.push(`${prefix}.ref is invalid`);
    if (!inputRefs.has(episode?.inputRef)) errors.push(`${prefix}.inputRef is unavailable`);
    if (!Array.isArray(episode?.turns) || episode.turns.length === 0) errors.push(`${prefix}.turns must be a non-empty array`);
    for (const [turnIndex, turn] of (episode?.turns ?? []).entries()) {
      const turnPrefix = `${prefix}.turns[${turnIndex}]`;
      errors.push(...exactFields(turn, TURN_FIELDS, turnPrefix));
      if (!REF_RE.test(turn?.ref ?? "")) errors.push(`${turnPrefix}.ref is invalid`);
      if (!meaningfulText(turn?.userPrompt, 1, 4000)) errors.push(`${turnPrefix}.userPrompt is invalid`);
      if (turn?.assistantResponse !== null && !meaningfulText(turn?.assistantResponse, 1, 8001)) errors.push(`${turnPrefix}.assistantResponse is invalid`);
      if (typeof turn?.responseTruncated !== "boolean") errors.push(`${turnPrefix}.responseTruncated must be boolean`);
      if (!uniqueStrings(turn?.toolCategories, { allowEmpty: true })) errors.push(`${turnPrefix}.toolCategories must be unique strings`);
    }
  }
  if (!Array.isArray(packet.capabilityInventory)) errors.push("packet.capabilityInventory must be an array");
  for (const [index, capability] of (packet.capabilityInventory ?? []).entries()) {
    errors.push(...capabilityErrors(capability, `packet.capabilityInventory[${index}]`, { material: true }));
  }
  if (!Array.isArray(packet.ownerArtifacts)) errors.push("packet.ownerArtifacts must be an array");
  for (const [index, artifact] of (packet.ownerArtifacts ?? []).entries()) {
    errors.push(...ownerArtifactErrors(artifact, `packet.ownerArtifacts[${index}]`, { material: true }));
  }
  if (!Array.isArray(packet.omissions)) errors.push("packet.omissions must be an array");
  for (const [index, omission] of (packet.omissions ?? []).entries()) {
    errors.push(...omissionErrors(omission, `packet.omissions[${index}]`));
  }
  const derivedRefs = packetEvidenceRefs(packet);
  const baseRefs = new Set(derivedRefs.filter((ref) => !(packet.omissions ?? []).some((omission) => omission.ref === ref)));
  const allRefs = new Set(derivedRefs);
  for (const [index, omission] of (packet.omissions ?? []).entries()) {
    for (const ref of omission.relatedRefs ?? []) {
      if (!baseRefs.has(ref)) errors.push(`packet.omissions[${index}].relatedRefs contains unavailable ref: ${ref}`);
    }
  }
  for (const [index, capability] of (packet.capabilityInventory ?? []).entries()) {
    const prefix = `packet.capabilityInventory[${index}]`;
    for (const ref of [...(capability.contextEvidenceRefs ?? []), ...(capability.useEvidenceRefs ?? [])]) {
      if (!allRefs.has(ref)) errors.push(`${prefix} contains unavailable context or use evidence ref: ${ref}`);
    }
    const contextSensitive = ["mode-restricted", "feature-gated", "agent-private"].includes(capability.availability);
    const availabilityContext = capability.availabilityContext ?? {};
    const runtimeStateClaimed = ["discovered", "not-discovered"].includes(availabilityContext.discoveryState)
      || ["visible", "hidden", "disabled"].includes(availabilityContext.visibility)
      || ["allowed", "denied"].includes(availabilityContext.invocationPermission)
      || ["satisfied", "unsatisfied"].includes(capability.gating);
    if (capability.kind === "platform-capability" && runtimeStateClaimed
      && (capability.contextEvidenceRefs ?? []).length === 0) {
      errors.push(`${prefix}.contextEvidenceRefs is required for observed runtime availability state`);
    }
    if (contextSensitive && capability.gating === "satisfied" && (capability.contextEvidenceRefs ?? []).length === 0) {
      errors.push(`${prefix}.contextEvidenceRefs is required when context-sensitive gating is satisfied`);
    }
    if (capability.kind === "platform-capability" && capability.gating === "satisfied"
      && (availabilityContext.runtimeSurface === "unknown"
        || availabilityContext.agentScope === "unknown"
        || availabilityContext.discoveryState !== "discovered"
        || availabilityContext.visibility !== "visible"
        || ((capability.modes ?? []).length > 0 && !capability.modes.includes(availabilityContext.currentMode)))) {
      errors.push(`${prefix} satisfied gating conflicts with runtime surface, mode, discovery, visibility, or agent scope`);
    }
    if (contextSensitive && capability.gating === "unsatisfied"
      && ((capability.contextEvidenceRefs ?? []).length === 0
        || (availabilityContext.discoveryState !== "not-discovered"
          && !["hidden", "disabled"].includes(availabilityContext.visibility)))) {
      errors.push(`${prefix} with observed unsatisfied gating requires negative discovery or visibility evidence`);
    }
    if (capability.actualInstructions === null
      && relatedOmissions(packet, capability.ref, "capability-content", ["unavailable", "unknown"]).length === 0) {
      errors.push(`${prefix} without actual instructions requires a capability-content omission`);
    }
    const runtimeContextUninspected = ["not-inspected", "unknown"].includes(availabilityContext.discoveryState)
      || ["not-inspected", "unknown"].includes(availabilityContext.visibility)
      || ["not-inspected", "unknown"].includes(availabilityContext.invocationPermission);
    if (contextSensitive && (capability.gating === "unknown" || runtimeContextUninspected)
      && relatedOmissions(packet, capability.ref, "runtime-context", ["unavailable", "unknown"]).length === 0) {
      errors.push(`${prefix} with unresolved gating requires a runtime-context omission`);
    }
    if (["partial", "unknown"].includes(capability.sourceCompleteness)
      && relatedOmissions(packet, capability.ref, "platform-catalog", ["partial", "unavailable", "unknown"]).length === 0
      && relatedOmissions(packet, capability.ref, "capability-content", ["partial", "unavailable", "unknown"]).length === 0) {
      errors.push(`${prefix} with incomplete source coverage requires a related omission`);
    }
    if ((capability.kind === "observed-skill" || capability.availability === "observed")
      && (capability.useEvidenceRefs ?? []).length === 0) {
      errors.push(`${prefix}.useEvidenceRefs is required for observed capability status`);
    }
    if (availabilityContext.invocation === "observed" && (capability.useEvidenceRefs ?? []).length === 0) {
      errors.push(`${prefix}.useEvidenceRefs is required for observed invocation`);
    }
    if (availabilityContext.invocation === "not-observed" && (capability.contextEvidenceRefs ?? []).length === 0) {
      errors.push(`${prefix}.contextEvidenceRefs is required for observed non-invocation state`);
    }
    if (["not-observed", "not-inspected", "unknown"].includes(availabilityContext.invocation)
      && (capability.useEvidenceRefs ?? []).length > 0) {
      errors.push(`${prefix}.useEvidenceRefs requires observed invocation`);
    }
  }
  if (!uniqueStrings(derivedRefs)) errors.push("packet evidence refs must be globally unique");
  if (!uniqueStrings(packet.availableEvidenceRefs)
    || packet.availableEvidenceRefs.length !== derivedRefs.length
    || derivedRefs.some((ref) => !packet.availableEvidenceRefs.includes(ref))) {
    errors.push("packet.availableEvidenceRefs must contain exactly the mechanically available refs");
  }
  if (requireFreeze) errors.push(...patternFreezeErrors(packet));
  errors.push(...skillPatternPacketPrivacyErrors(packet));
  return [...new Set(errors)];
}

export function validateSkillPatternPacket(packet) {
  return validateSkillPatternPacketInternal(packet, { requireFreeze: true });
}

export async function loadSkillPatternCases(filePath = DEFAULT_SKILL_PATTERN_CASES_FILE, dependencies = {}) {
  const readText = dependencies.readFile ?? readFile;
  const corpus = JSON.parse(await readText(path.resolve(filePath), "utf8"));
  const errors = caseCorpusErrors(corpus);
  if (errors.length > 0) throw new Error(`Skill pattern cases are invalid: ${errors.join(", ")}`);
  return corpus;
}

export function listSkillPatternCases(corpus) {
  const errors = caseCorpusErrors(corpus);
  if (errors.length > 0) throw new Error(`Skill pattern cases are invalid: ${errors.join(", ")}`);
  return {
    kind: "session-skill-pattern-list",
    schemaVersion: SKILL_PATTERN_SCHEMA_VERSION,
    cases: corpus.cases.map((evalCase) => ({
      caseId: evalCase.caseId,
      publicCaseId: publicCaseId(evalCase),
      sourceKind: evalCase.sourceKind,
      replicaGroup: evalCase.replicaGroup ?? null,
      metamorphicGroup: evalCase.metamorphicGroup ?? null,
      organicDemandEvidence: false,
      sourceCount: evalCase.sourceKind === "sanitized-replay-pair" ? evalCase.replayFiles.length : evalCase.episodes.length,
    })),
  };
}

export function selectSkillPatternCases(corpus, options = {}) {
  const errors = caseCorpusErrors(corpus);
  if (errors.length > 0) throw new Error(`Skill pattern cases are invalid: ${errors.join(", ")}`);
  if (options.all === true) return [...corpus.cases];
  const ids = options.caseId ? [options.caseId] : options.caseIds;
  if (!Array.isArray(ids) || ids.length === 0) throw new Error("Select one or more case ids, or set all: true");
  const byId = new Map(corpus.cases.map((evalCase) => [evalCase.caseId, evalCase]));
  return [...new Map(ids.map((id) => {
    const evalCase = byId.get(id);
    if (!evalCase) throw new Error(`Unknown Skill pattern case: ${id}`);
    return [id, evalCase];
  })).values()];
}

export async function extractSkillPatternMaterials(evalCase, options = {}, dependencies = {}) {
  const syntheticCorpus = {
    kind: SKILL_PATTERN_CASES_KIND,
    schemaVersion: SKILL_PATTERN_SCHEMA_VERSION,
    cases: [evalCase],
  };
  const caseErrors = caseCorpusErrors(syntheticCorpus);
  if (caseErrors.length > 0) throw new Error(`Skill pattern case is invalid: ${caseErrors.join(", ")}`);
  const readText = dependencies.readFile ?? readFile;
  const baseDir = path.resolve(options.baseDir ?? path.dirname(DEFAULT_SKILL_PATTERN_CASES_FILE));
  let projections;
  if (evalCase.sourceKind === "sanitized-replay-pair") {
    projections = [];
    for (const [index, locator] of evalCase.replayFiles.entries()) {
      const replayPath = path.resolve(baseDir, locator);
      if (replayPath !== baseDir && !replayPath.startsWith(`${baseDir}${path.sep}`)) {
        throw new Error(`Replay locator escapes the benchmark directory: ${locator}`);
      }
      const rows = await readJsonl(replayPath, readText);
      projections.push(replayProjection(rows, locator, index, evalCase.replicaGroup));
    }
  } else {
    projections = syntheticProjections(evalCase);
  }
  const materialPacket = {
    kind: SKILL_PATTERN_PACKET_KIND,
    schemaVersion: SKILL_PATTERN_SCHEMA_VERSION,
    packetId: publicCaseId(evalCase),
    episodes: projections.map((projection) => projection.episode),
    provenance: {
      sourceKind: evalCase.sourceKind,
      benchmarkGenerated: true,
      organicDemandEvidence: false,
      workflowDemandId: null,
      inputs: projections.map((projection) => projection.input),
    },
    inspection: clone(evalCase.inspection),
    capabilityInventory: evalCase.capabilityInventory.map(materializeCapability),
    ownerArtifacts: evalCase.ownerArtifacts.map(materializeOwnerArtifact),
    omissions: clone(evalCase.omissions),
    availableEvidenceRefs: [],
  };
  materialPacket.availableEvidenceRefs = packetEvidenceRefs(materialPacket);
  const errors = validateSkillPatternPacketInternal(materialPacket, { requireFreeze: false });
  if (errors.length > 0) throw new Error(`Skill pattern material is invalid: ${errors.join(", ")}`);
  return materialPacket;
}

function workflowErrors(value, prefix) {
  const errors = exactFields(value, WORKFLOW_FIELDS, prefix);
  if (!isObject(value)) return errors;
  for (const field of WORKFLOW_FIELDS) {
    if (value[field] !== null && !meaningfulText(value[field], 4, field === "procedure" ? 1000 : 500)) {
      errors.push(`${prefix}.${field} must be null or meaningful text`);
    }
  }
  return errors;
}

function resultPrivacyErrors(result) {
  return [...recursiveKeyErrors(result, "result"), ...privateTextErrors(result, "result")];
}

function resultRefErrors(refs, prefix, availableRefs, { allowEmpty = false } = {}) {
  const errors = [];
  if (!uniqueStrings(refs, { allowEmpty })) return [`${prefix} must be unique evidence refs`];
  for (const ref of refs) {
    if (!availableRefs.has(ref)) errors.push(`${prefix} contains unavailable ref: ${ref}`);
  }
  return errors;
}

function resultTextListErrors(value, prefix) {
  if (!uniqueStrings(value, { allowEmpty: true }) || value.some((entry) => !meaningfulText(entry, 4, 320))) {
    return [`${prefix} must be unique meaningful strings`];
  }
  return [];
}

export function validateSkillPatternResult(result, packet) {
  const errors = exactFields(result, RESULT_FIELDS, "result");
  if (!isObject(result)) return errors;
  if (result.kind !== SKILL_PATTERN_RESULT_KIND || result.schemaVersion !== SKILL_PATTERN_SCHEMA_VERSION) {
    errors.push("result identity is invalid");
  }
  if (result.packetId !== packet?.packetId) errors.push("result.packetId must copy packet.packetId");
  if (!Array.isArray(result.patterns) || result.patterns.length > 3) errors.push("result.patterns must contain zero to three patterns");
  if (!Array.isArray(result.rejectedClusters) || result.rejectedClusters.length > 16) {
    errors.push("result.rejectedClusters must contain zero to sixteen clusters");
  }
  if ((result.patterns ?? []).length === 0) {
    if (!meaningfulText(result.noPatternReason, 12, 800)) errors.push("result.noPatternReason is required when no patterns are returned");
  } else if (result.noPatternReason !== null) {
    errors.push("result.noPatternReason must be null when patterns are returned");
  }
  const frozenResult = packet?.patternFreeze?.result;
  if (!isObject(frozenResult)) {
    errors.push("result requires a validated Episode-only pattern freeze receipt");
  } else {
    if (JSON.stringify(result.noPatternReason) !== JSON.stringify(frozenResult.noPatternReason)
      || JSON.stringify(result.rejectedClusters) !== JSON.stringify(frozenResult.rejectedClusters)) {
      errors.push("result must preserve the frozen no-pattern and rejected-cluster decisions");
    }
    const frozenPatterns = frozenResult.patterns ?? [];
    if ((result.patterns ?? []).length !== frozenPatterns.length) {
      errors.push("result.patterns must contain exactly the frozen discovery candidates");
    }
    for (const [index, pattern] of (result.patterns ?? []).entries()) {
      const frozen = frozenPatterns[index];
      const prefix = `result.patterns[${index}]`;
      if (!frozen || pattern?.candidateId !== frozen.candidateId) {
        errors.push(`${prefix}.candidateId must preserve the frozen candidate order`);
        continue;
      }
      for (const field of ["pattern", "confidence", "assumptions", "uncertainties", "summary"]) {
        if (JSON.stringify(pattern?.[field]) !== JSON.stringify(frozen[field])) {
          errors.push(`${prefix}.${field} must preserve the Episode-only discovery result`);
        }
      }
      if (JSON.stringify(pattern?.support?.episodeRefs) !== JSON.stringify(frozen.support?.episodeRefs)
        || pattern?.support?.recurrence !== frozen.support?.recurrence) {
        errors.push(`${prefix}.support must preserve frozen Episode refs and recurrence`);
      }
      if (!(frozen.support?.evidenceRefs ?? []).every((ref) => pattern?.support?.evidenceRefs?.includes(ref))) {
        errors.push(`${prefix}.support.evidenceRefs must retain every frozen discovery ref`);
      }
    }
  }
  const availableRefs = new Set(packet?.availableEvidenceRefs ?? []);
  const capabilityRefs = new Map((packet?.capabilityInventory ?? []).map((entry) => [entry.ref, entry]));
  const ownerRefs = new Set((packet?.ownerArtifacts ?? []).map((entry) => entry.ref));
  const omissions = packet?.omissions ?? [];
  const blockingInventoryOmissions = omissions.filter((omission) => ["platform-catalog", "capability-content"].includes(omission.scope)
    && ["partial", "unavailable", "unknown"].includes(omission.status));
  const episodes = new Map((packet?.episodes ?? []).map((episode) => [episode.ref, episode]));
  const inputs = new Map((packet?.provenance?.inputs ?? []).map((input) => [input.ref, input]));
  const candidateIds = new Set();
  for (const [index, pattern] of (result.patterns ?? []).entries()) {
    const prefix = `result.patterns[${index}]`;
    errors.push(...exactFields(pattern, PATTERN_FIELDS, prefix));
    if (!/^CANDIDATE-[1-9][0-9]*$/u.test(pattern?.candidateId ?? "")) errors.push(`${prefix}.candidateId is invalid`);
    if (candidateIds.has(pattern?.candidateId)) errors.push(`${prefix}.candidateId is duplicated`);
    candidateIds.add(pattern?.candidateId);
    errors.push(...workflowErrors(pattern?.pattern, `${prefix}.pattern`));

    errors.push(...exactFields(pattern?.support, SUPPORT_FIELDS, `${prefix}.support`));
    const support = pattern?.support;
    errors.push(...resultRefErrors(support?.episodeRefs, `${prefix}.support.episodeRefs`, new Set(episodes.keys())));
    errors.push(...resultRefErrors(support?.evidenceRefs, `${prefix}.support.evidenceRefs`, availableRefs));
    for (const episodeRef of support?.episodeRefs ?? []) {
      if (!(support?.evidenceRefs ?? []).includes(episodeRef)) errors.push(`${prefix}.support.evidenceRefs must cite ${episodeRef}`);
    }
    if (!RECURRENCE_STATES.has(support?.recurrence)) errors.push(`${prefix}.support.recurrence is invalid`);
    const replicaGroups = new Set((support?.episodeRefs ?? []).map((episodeRef) => {
      const episode = episodes.get(episodeRef);
      return inputs.get(episode?.inputRef)?.replicaGroup;
    }).filter(Boolean));
    if (support?.recurrence === "single-episode" && support?.episodeRefs?.length !== 1) {
      errors.push(`${prefix}.support single-episode requires exactly one Episode`);
    }
    if (support?.recurrence === "cross-episode"
      && (support?.episodeRefs?.length < 2 || replicaGroups.size < 2)) {
      errors.push(`${prefix}.support cross-episode requires at least two Episodes from different replica groups`);
    }
    if (support?.recurrence === "replica-only"
      && (support?.episodeRefs?.length < 2 || replicaGroups.size !== 1)) {
      errors.push(`${prefix}.support replica-only requires at least two Episodes from one replica group`);
    }

    if (!Array.isArray(pattern?.capabilityAssessments)) errors.push(`${prefix}.capabilityAssessments must be an array`);
    const assessedCapabilities = new Map();
    for (const [assessmentIndex, assessment] of (pattern?.capabilityAssessments ?? []).entries()) {
      const assessmentPrefix = `${prefix}.capabilityAssessments[${assessmentIndex}]`;
      errors.push(...exactFields(assessment, CAPABILITY_ASSESSMENT_FIELDS, assessmentPrefix));
      if (!capabilityRefs.has(assessment?.capabilityRef)) errors.push(`${assessmentPrefix}.capabilityRef is unavailable`);
      if (assessedCapabilities.has(assessment?.capabilityRef)) errors.push(`${assessmentPrefix}.capabilityRef is duplicated`);
      assessedCapabilities.set(assessment?.capabilityRef, assessment);
      if (!CAPABILITY_RELATIONSHIPS.has(assessment?.relationship)) errors.push(`${assessmentPrefix}.relationship is invalid`);
      errors.push(...resultRefErrors(assessment?.evidenceRefs, `${assessmentPrefix}.evidenceRefs`, availableRefs));
      if (!(assessment?.evidenceRefs ?? []).includes(assessment?.capabilityRef)) {
        errors.push(`${assessmentPrefix}.evidenceRefs must cite the assessed capability`);
      }
      const assessedCapability = capabilityRefs.get(assessment?.capabilityRef);
      const unresolvedContentOrGating = assessedCapability?.actualInstructions === null
        || assessedCapability?.gating === "unknown";
      if (unresolvedContentOrGating && assessment?.relationship !== "unknown") {
        errors.push(`${assessmentPrefix}.relationship must be unknown when actual instructions or gating are unresolved`);
      }
      if (assessment?.relationship === "unknown") {
        const boundaryRefs = omissions
          .filter((omission) => omission.relatedRefs.includes(assessment?.capabilityRef)
            && ["capability-content", "runtime-context", "platform-catalog"].includes(omission.scope))
          .map((omission) => omission.ref);
        if (boundaryRefs.length > 0 && !boundaryRefs.some((ref) => assessment?.evidenceRefs?.includes(ref))) {
          errors.push(`${assessmentPrefix}.evidenceRefs must cite a supplied capability boundary omission`);
        }
      }
      if (!meaningfulText(assessment?.rationale, 12, 800)) errors.push(`${assessmentPrefix}.rationale is invalid`);
    }

    errors.push(...exactFields(pattern?.ownerAssessment, OWNER_ASSESSMENT_FIELDS, `${prefix}.ownerAssessment`));
    const ownerAssessment = pattern?.ownerAssessment;
    const action = ownerAssessment?.recommendedAction;
    if (!RECOMMENDED_ACTIONS.has(action)) errors.push(`${prefix}.ownerAssessment.recommendedAction is invalid`);
    if (ownerAssessment?.targetRef !== null && !REF_RE.test(ownerAssessment?.targetRef ?? "")) errors.push(`${prefix}.ownerAssessment.targetRef is invalid`);
    if (!TARGET_KINDS.has(ownerAssessment?.targetKind)) errors.push(`${prefix}.ownerAssessment.targetKind is invalid`);
    if (ownerAssessment?.proposedName !== null
      && (!SKILL_NAME_RE.test(ownerAssessment?.proposedName ?? "") || ownerAssessment.proposedName.length > 64)) {
      errors.push(`${prefix}.ownerAssessment.proposedName is invalid`);
    }
    if (!meaningfulText(ownerAssessment?.rationale, 12, 800)) errors.push(`${prefix}.ownerAssessment.rationale is invalid`);
    const targetCapability = capabilityRefs.get(ownerAssessment?.targetRef);
    const targetAssessment = assessedCapabilities.get(ownerAssessment?.targetRef);
    if (action === "covered-observed") {
      if (targetCapability?.kind !== "observed-skill" || ownerAssessment.targetKind !== "skill" || ownerAssessment.proposedName !== null) {
        errors.push(`${prefix}.ownerAssessment covered-observed must target an observed Skill`);
      }
      if (targetAssessment?.relationship !== "complete") errors.push(`${prefix}.ownerAssessment covered-observed requires a complete capability assessment`);
      if (targetCapability?.availabilityContext?.invocation !== "observed"
        || (targetCapability?.useEvidenceRefs ?? []).length === 0) {
        errors.push(`${prefix}.ownerAssessment covered-observed requires task-linked invocation evidence`);
      }
    } else if (action === "try-platform-built-in") {
      if (targetCapability?.kind !== "platform-capability" || ownerAssessment.targetKind !== "platform-capability" || ownerAssessment.proposedName !== null) {
        errors.push(`${prefix}.ownerAssessment try-platform-built-in must target a platform capability`);
      }
      if (targetAssessment?.relationship !== "complete") errors.push(`${prefix}.ownerAssessment try-platform-built-in requires a complete capability assessment`);
      if (!meaningfulText(targetCapability?.actualInstructions, 4, 2000)) {
        errors.push(`${prefix}.ownerAssessment try-platform-built-in requires actual bounded instructions, not catalog metadata alone`);
      }
      if (!["not-required", "satisfied"].includes(targetCapability?.gating)) {
        errors.push(`${prefix}.ownerAssessment try-platform-built-in requires satisfied availability gating`);
      }
      if (targetCapability?.availabilityContext?.runtimeSurface === "unknown"
        || targetCapability?.availabilityContext?.agentScope === "unknown"
        || targetCapability?.availabilityContext?.discoveryState !== "discovered"
        || targetCapability?.availabilityContext?.visibility !== "visible"
        || targetCapability?.availabilityContext?.invocationPermission !== "allowed"
        || (targetCapability?.contextEvidenceRefs ?? []).length === 0) {
        errors.push(`${prefix}.ownerAssessment try-platform-built-in requires current runtime surface, agent scope, discovery, visibility, and invocation permission evidence`);
      }
      if ((targetCapability?.modes ?? []).length > 0
        && (!targetCapability.modes.includes(targetCapability?.availabilityContext?.currentMode))) {
        errors.push(`${prefix}.ownerAssessment try-platform-built-in requires a supported current mode`);
      }
      const blockingTargetOmissions = omissions.filter((omission) => omission.relatedRefs.includes(targetCapability?.ref)
        && ["capability-content", "runtime-context"].includes(omission.scope)
        && ["unavailable", "unknown"].includes(omission.status));
      if (blockingTargetOmissions.length > 0) {
        errors.push(`${prefix}.ownerAssessment try-platform-built-in conflicts with unavailable capability or runtime context`);
      }
      if (targetCapability?.sourceCompleteness !== "complete") {
        const sourceBoundaryRefs = omissions
          .filter((omission) => omission.relatedRefs.includes(targetCapability?.ref)
            && ["platform-catalog", "capability-content"].includes(omission.scope)
            && ["partial", "unavailable", "unknown"].includes(omission.status))
          .map((omission) => omission.ref);
        if (sourceBoundaryRefs.length === 0
          || !sourceBoundaryRefs.some((ref) => targetAssessment?.evidenceRefs?.includes(ref))
          || !sourceBoundaryRefs.some((ref) => support?.evidenceRefs?.includes(ref))) {
          errors.push(`${prefix}.ownerAssessment try-platform-built-in must preserve incomplete-source omissions in its evidence`);
        }
      }
    } else if (action === "try-configured-skill") {
      if (targetCapability?.kind !== "configured-skill" || ownerAssessment.targetKind !== "skill" || ownerAssessment.proposedName !== null) {
        errors.push(`${prefix}.ownerAssessment try-configured-skill must target a configured Skill`);
      }
      if (targetAssessment?.relationship !== "complete") errors.push(`${prefix}.ownerAssessment try-configured-skill requires a complete capability assessment`);
    } else if (action === "extend-skill") {
      if (!targetCapability?.kind?.endsWith("-skill") || ownerAssessment.targetKind !== "skill" || ownerAssessment.proposedName !== null) {
        errors.push(`${prefix}.ownerAssessment extend-skill must target an inventoried Skill`);
      }
      if (targetAssessment?.relationship !== "partial") errors.push(`${prefix}.ownerAssessment extend-skill requires a partial capability assessment`);
    } else if (action === "create-skill") {
      if (ownerAssessment.targetRef !== null || ownerAssessment.targetKind !== "new-skill" || ownerAssessment.proposedName === null) {
        errors.push(`${prefix}.ownerAssessment create-skill must propose a new Skill without claiming an existing target`);
      }
      if (packet?.provenance?.benchmarkGenerated === true
        || packet?.provenance?.organicDemandEvidence !== true) {
        errors.push(`${prefix}.ownerAssessment generated or non-organic evidence cannot support create-skill`);
      }
    } else if (action === "not-a-skill") {
      if (!ownerRefs.has(ownerAssessment.targetRef) || ownerAssessment.targetKind !== "owner-artifact" || ownerAssessment.proposedName !== null) {
        errors.push(`${prefix}.ownerAssessment not-a-skill must target an owner artifact from the packet`);
      }
    } else if (action === "needs-more-evidence") {
      if (ownerAssessment.targetRef !== null || ownerAssessment.targetKind !== "unresolved" || ownerAssessment.proposedName !== null) {
        errors.push(`${prefix}.ownerAssessment needs-more-evidence must keep the target unresolved`);
      }
    }
    if (["create-skill", "extend-skill"].includes(action)
      && !WORKFLOW_FIELDS.every((field) => meaningfulText(pattern?.pattern?.[field], 4))) {
      errors.push(`${prefix}.ownerAssessment ${action} requires all six pattern fields`);
    }
    if (["create-skill", "extend-skill"].includes(action)
      && support?.recurrence !== "cross-episode") {
      errors.push(`${prefix}.ownerAssessment ${action} requires independent cross-episode recurrence`);
    }
    if (["create-skill", "extend-skill"].includes(action)) {
      if (packet?.inspection?.capabilityInventory !== "complete"
        || packet?.inspection?.ownerChain !== "complete") {
        errors.push(`${prefix}.ownerAssessment ${action} requires complete capability-inventory and owner-chain inspection`);
      }
      if ((packet?.ownerArtifacts ?? []).length === 0
        || ![...ownerRefs].some((ref) => support?.evidenceRefs?.includes(ref))) {
        errors.push(`${prefix}.ownerAssessment ${action} requires cited bounded non-Skill owner evidence`);
      }
      if (!support?.evidenceRefs?.includes(packet?.inspection?.ref)) {
        errors.push(`${prefix}.ownerAssessment ${action} requires the inspection receipt ref`);
      }
    }
    if (["create-skill", "extend-skill", "not-a-skill"].includes(action)) {
      if (assessedCapabilities.size !== capabilityRefs.size
        || [...assessedCapabilities.values()].some((assessment) => assessment.relationship === "unknown")) {
        errors.push(`${prefix}.ownerAssessment ${action} cannot rely on unknown or uninspected capabilities`);
      }
      if (blockingInventoryOmissions.length > 0) {
        errors.push(`${prefix}.ownerAssessment ${action} cannot treat partial or unavailable capability inventory as a gap`);
      }
    }
    if (["create-skill", "not-a-skill"].includes(action)
      && [...assessedCapabilities.values()].some((assessment) => ["complete", "partial"].includes(assessment.relationship))) {
      errors.push(`${prefix}.ownerAssessment ${action} conflicts with complete or partial capability coverage`);
    }
    if (ownerAssessment?.targetRef !== null && !(support?.evidenceRefs ?? []).includes(ownerAssessment.targetRef)) {
      errors.push(`${prefix}.support.evidenceRefs must cite the owner target`);
    }
    if (!CONFIDENCE_LEVELS.has(pattern?.confidence)) errors.push(`${prefix}.confidence is invalid`);
    errors.push(...resultTextListErrors(pattern?.assumptions, `${prefix}.assumptions`));
    errors.push(...resultTextListErrors(pattern?.uncertainties, `${prefix}.uncertainties`));
    if (!meaningfulText(pattern?.summary, 12, 800)) errors.push(`${prefix}.summary is invalid`);
  }

  const clusterIds = new Set();
  for (const [index, cluster] of (result.rejectedClusters ?? []).entries()) {
    const prefix = `result.rejectedClusters[${index}]`;
    errors.push(...exactFields(cluster, REJECTED_CLUSTER_FIELDS, prefix));
    if (!/^CLUSTER-[1-9][0-9]*$/u.test(cluster?.clusterId ?? "")) errors.push(`${prefix}.clusterId is invalid`);
    if (clusterIds.has(cluster?.clusterId)) errors.push(`${prefix}.clusterId is duplicated`);
    clusterIds.add(cluster?.clusterId);
    errors.push(...resultRefErrors(cluster?.episodeRefs, `${prefix}.episodeRefs`, new Set(episodes.keys())));
    errors.push(...resultRefErrors(cluster?.evidenceRefs, `${prefix}.evidenceRefs`, availableRefs));
    for (const episodeRef of cluster?.episodeRefs ?? []) {
      if (!(cluster?.evidenceRefs ?? []).includes(episodeRef)) errors.push(`${prefix}.evidenceRefs must cite ${episodeRef}`);
    }
    if (!meaningfulText(cluster?.reason, 12, 800)) errors.push(`${prefix}.reason is invalid`);
  }
  errors.push(...resultPrivacyErrors(result));
  return [...new Set(errors)];
}

export function buildSkillPatternRecord(packet, result, options = {}) {
  const packetErrors = validateSkillPatternPacket(packet);
  if (packetErrors.length > 0) throw new Error(`Cannot record invalid Skill pattern packet: ${packetErrors.join(", ")}`);
  const resultErrors = validateSkillPatternResult(result, packet);
  if (resultErrors.length > 0) throw new Error(`Cannot record invalid Skill pattern result: ${resultErrors.join(", ")}`);
  const recordedAtValue = options.recordedAt ?? new Date().toISOString();
  const recordedAt = new Date(recordedAtValue);
  if (Number.isNaN(recordedAt.getTime())) throw new Error("recordedAt must be a valid date-time");
  const replicaGroups = [...new Set(packet.provenance.inputs.map((input) => input.replicaGroup))].sort();
  const crossEpisodePatternCount = result.patterns.filter((pattern) => pattern?.support?.recurrence === "cross-episode").length;
  const advisoryActions = [...new Set(result.patterns
    .map((pattern) => pattern?.ownerAssessment?.recommendedAction)
    .filter((action) => RECOMMENDED_ACTIONS.has(action)))].sort();
  const advisoryDecisions = result.patterns.map((pattern) => ({
    candidateId: pattern.candidateId,
    action: pattern.ownerAssessment.recommendedAction,
    targetRef: pattern.ownerAssessment.targetRef,
    targetKind: pattern.ownerAssessment.targetKind,
    proposedName: pattern.ownerAssessment.proposedName,
  }));
  const productionFindingEligible = packet.provenance.sourceKind === "privacy-safe-session-episodes"
    && packet.provenance.benchmarkGenerated === false
    && packet.provenance.organicDemandEvidence === true
    && meaningfulText(packet.provenance.workflowDemandId, 3, 128)
    && new Set(packet.provenance.inputs.map((input) => input.sourceEpisodeId).filter(Boolean)).size >= 2
    && packet.inspection.capabilityInventory === "complete"
    && packet.inspection.ownerChain === "complete"
    && replicaGroups.length >= 2
    && crossEpisodePatternCount > 0
    && advisoryActions.some((action) => ["create-skill", "extend-skill"].includes(action));
  const packetHash = contentHash(packet);
  const resultHash = contentHash(result);
  const workflowDemandId = packet.provenance.workflowDemandId;
  const sourceEpisodeIds = [...new Set(packet.provenance.inputs
    .map((input) => input.sourceEpisodeId)
    .filter(Boolean))].sort();
  const record = {
    kind: SKILL_PATTERN_RECORD_KIND,
    schemaVersion: SKILL_PATTERN_SCHEMA_VERSION,
    packetId: packet.packetId,
    packetHash,
    resultHash,
    recordedAt: recordedAt.toISOString(),
    sourceKind: packet.provenance.sourceKind,
    benchmarkGenerated: packet.provenance.benchmarkGenerated,
    organicDemandEvidence: packet.provenance.organicDemandEvidence,
    replicaGroups,
    workflowDemandId,
    sourceEpisodeIds,
    bindingHash: "",
    episodeCount: packet.episodes.length,
    independentReplicaGroupCount: replicaGroups.length,
    patternCount: result.patterns.length,
    crossEpisodePatternCount,
    advisoryActions,
    advisoryDecisions,
    productionFindingEligible,
  };
  record.bindingHash = skillPatternBindingHash(record);
  const recordErrors = validateSkillPatternRecord(record);
  if (recordErrors.length > 0) throw new Error(`Cannot build invalid Skill pattern record: ${recordErrors.join(", ")}`);
  return record;
}
