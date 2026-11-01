import { createHash } from "node:crypto";

export const SKILL_PATTERN_RECORD_KIND = "session-skill-pattern-record";
export const SKILL_PATTERN_SCHEMA_VERSION = 2;

const RECORD_FIELDS = [
  "kind", "schemaVersion", "packetId", "packetHash", "resultHash", "recordedAt",
  "sourceKind", "benchmarkGenerated", "organicDemandEvidence", "replicaGroups",
  "workflowDemandId", "sourceEpisodeIds", "bindingHash",
  "episodeCount", "independentReplicaGroupCount", "patternCount",
  "crossEpisodePatternCount", "advisoryActions", "advisoryDecisions",
  "productionFindingEligible",
];
const ADVISORY_DECISION_FIELDS = [
  "candidateId", "action", "targetRef", "targetKind", "proposedName",
];
const RECOMMENDED_ACTIONS = new Set([
  "covered-observed",
  "try-platform-built-in",
  "try-configured-skill",
  "extend-skill",
  "create-skill",
  "not-a-skill",
  "needs-more-evidence",
]);
const PACKET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/u;
const HASH_RE = /^[a-f0-9]{16}$/u;
const PRIVATE_TEXT_RE = /(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b[A-Za-z0-9_]*(?:password|secret|token|api[_-]?key)\s*[:=]\s*(?!<redacted>)[^\s,;]+)/iu;
const POSIX_ABSOLUTE_PATH_RE = /(?:^|[\s"'`(<])\/(?!\/)[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~+@%-]+)+(?:$|[\s"'`)>.,;:])/u;
const WINDOWS_ABSOLUTE_PATH_RE = /(?:^|[\s"'`(<])(?:[A-Za-z]:\\|\\\\)[^\s"'`<>]+/u;
const FILE_URI_RE = /\bfile:\/\/(?:\/[A-Za-z0-9._~%-]+|[A-Za-z]:\/)[^\s"'`<>]*/iu;
const HOME_SHORTHAND_PATH_RE = /(?:^|[\s"'`(<])~[\\/][^\s"'`<>]+/u;

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

function meaningfulText(value, minimum = 4, maximum = Number.POSITIVE_INFINITY) {
  return typeof value === "string" && value.trim().length >= minimum && value.length <= maximum;
}

function uniqueStrings(value, { allowEmpty = false } = {}) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((entry) => typeof entry === "string" && entry.length > 0)
    && new Set(value).size === value.length;
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
    if (Array.isArray(entry)) entry.forEach((item, index) => visit(item, `${field}[${index}]`));
    else if (isObject(entry)) {
      for (const [key, item] of Object.entries(entry)) visit(item, `${field}.${key}`);
    }
  };
  visit(value, prefix);
  return errors;
}

function advisoryDecisionErrors(value, prefix) {
  const errors = exactFields(value, ADVISORY_DECISION_FIELDS, prefix);
  if (!isObject(value)) return errors;
  if (!/^CANDIDATE-[1-9][0-9]*$/u.test(value.candidateId ?? "")) {
    errors.push(`${prefix}.candidateId is invalid`);
  }
  if (!RECOMMENDED_ACTIONS.has(value.action)) errors.push(`${prefix}.action is invalid`);
  if (value.targetRef !== null && !meaningfulText(value.targetRef, 3, 128)) {
    errors.push(`${prefix}.targetRef must be null or a bounded ref`);
  }
  if (!meaningfulText(value.targetKind, 3, 32)) errors.push(`${prefix}.targetKind is invalid`);
  if (value.proposedName !== null && !meaningfulText(value.proposedName, 3, 64)) {
    errors.push(`${prefix}.proposedName must be null or a bounded name`);
  }
  if (value.action === "create-skill"
    && (value.targetRef !== null || value.targetKind !== "new-skill" || value.proposedName === null)) {
    errors.push(`${prefix} create-skill must bind a proposed new Skill name without an existing target`);
  }
  if (value.action === "extend-skill"
    && (value.targetRef === null || value.targetKind !== "skill" || value.proposedName !== null)) {
    errors.push(`${prefix} extend-skill must bind an existing Skill target`);
  }
  return errors;
}

export function skillPatternBindingHash(record) {
  return createHash("sha256").update(JSON.stringify({
    packetHash: record?.packetHash,
    resultHash: record?.resultHash,
    workflowDemandId: record?.workflowDemandId,
    sourceEpisodeIds: record?.sourceEpisodeIds,
  })).digest("hex").slice(0, 16);
}

export function validateSkillPatternRecord(record) {
  const errors = exactFields(record, RECORD_FIELDS, "record");
  if (!isObject(record)) return errors;
  if (record.kind !== SKILL_PATTERN_RECORD_KIND || record.schemaVersion !== SKILL_PATTERN_SCHEMA_VERSION) {
    errors.push("record identity is invalid");
  }
  if (!PACKET_ID_RE.test(record.packetId ?? "")) errors.push("record.packetId is invalid");
  if (!HASH_RE.test(record.packetHash ?? "")) errors.push("record.packetHash is invalid");
  if (!HASH_RE.test(record.resultHash ?? "")) errors.push("record.resultHash is invalid");
  if (Number.isNaN(Date.parse(String(record.recordedAt ?? "")))) errors.push("record.recordedAt is invalid");
  if (!meaningfulText(record.sourceKind, 3, 64)) errors.push("record.sourceKind is invalid");
  if (typeof record.benchmarkGenerated !== "boolean") errors.push("record.benchmarkGenerated must be boolean");
  if (typeof record.organicDemandEvidence !== "boolean") errors.push("record.organicDemandEvidence must be boolean");
  if (record.benchmarkGenerated === true && record.organicDemandEvidence === true) {
    errors.push("record benchmark-generated evidence cannot be organic");
  }
  if (!uniqueStrings(record.replicaGroups)) errors.push("record.replicaGroups must contain distinct groups");
  if (record.workflowDemandId !== null && !meaningfulText(record.workflowDemandId, 3, 128)) {
    errors.push("record.workflowDemandId must be null or a bounded id");
  }
  if (!uniqueStrings(record.sourceEpisodeIds, { allowEmpty: true })) {
    errors.push("record.sourceEpisodeIds must contain distinct ids");
  }
  if (!HASH_RE.test(record.bindingHash ?? "") || record.bindingHash !== skillPatternBindingHash(record)) {
    errors.push("record.bindingHash does not match packet, result, and workflow binding");
  }
  for (const [field, minimum, maximum] of [
    ["episodeCount", 1, Number.MAX_SAFE_INTEGER],
    ["independentReplicaGroupCount", 1, Number.MAX_SAFE_INTEGER],
    ["patternCount", 0, 3],
    ["crossEpisodePatternCount", 0, 3],
  ]) {
    if (!Number.isInteger(record[field]) || record[field] < minimum || record[field] > maximum) {
      errors.push(`record.${field} is invalid`);
    }
  }
  if (Array.isArray(record.replicaGroups)
    && record.independentReplicaGroupCount !== record.replicaGroups.length) {
    errors.push("record.independentReplicaGroupCount must match replicaGroups");
  }
  if (Number.isInteger(record.crossEpisodePatternCount)
    && Number.isInteger(record.patternCount)
    && record.crossEpisodePatternCount > record.patternCount) {
    errors.push("record.crossEpisodePatternCount cannot exceed patternCount");
  }
  if (!uniqueStrings(record.advisoryActions, { allowEmpty: true })
    || record.advisoryActions.some((action) => !RECOMMENDED_ACTIONS.has(action))) {
    errors.push("record.advisoryActions is invalid");
  }
  if (!Array.isArray(record.advisoryDecisions)) {
    errors.push("record.advisoryDecisions must be an array");
  } else {
    const candidateIds = new Set();
    for (const [index, decision] of record.advisoryDecisions.entries()) {
      errors.push(...advisoryDecisionErrors(decision, `record.advisoryDecisions[${index}]`));
      if (candidateIds.has(decision?.candidateId)) {
        errors.push(`record.advisoryDecisions[${index}].candidateId is duplicated`);
      }
      candidateIds.add(decision?.candidateId);
    }
    const derivedActions = [...new Set(record.advisoryDecisions
      .map((decision) => decision?.action)
      .filter((action) => RECOMMENDED_ACTIONS.has(action)))].sort();
    if (JSON.stringify(derivedActions) !== JSON.stringify(record.advisoryActions)) {
      errors.push("record.advisoryActions must match advisoryDecisions");
    }
    if (record.advisoryDecisions.length !== record.patternCount) {
      errors.push("record.advisoryDecisions must contain one decision per pattern");
    }
  }
  const expectedEligibility = record.sourceKind === "privacy-safe-session-episodes"
    && record.benchmarkGenerated === false
    && record.organicDemandEvidence === true
    && meaningfulText(record.workflowDemandId, 3, 128)
    && record.sourceEpisodeIds?.length >= 2
    && record.independentReplicaGroupCount >= 2
    && record.crossEpisodePatternCount > 0
    && record.advisoryDecisions?.some((decision) => ["create-skill", "extend-skill"].includes(decision?.action));
  if (typeof record.productionFindingEligible !== "boolean"
    || record.productionFindingEligible !== expectedEligibility) {
    errors.push("record.productionFindingEligible does not match provenance, recurrence, and advisory action");
  }
  errors.push(...privateTextErrors(record, "record"));
  return [...new Set(errors)];
}
