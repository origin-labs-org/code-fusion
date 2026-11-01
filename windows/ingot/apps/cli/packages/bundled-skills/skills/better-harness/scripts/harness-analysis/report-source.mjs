import { createHash } from "node:crypto";

import { validateSemanticFacets } from "../session-analysis/semantic-facets.mjs";
import { validateCheckupReportEvidence } from "../coding-agent-practices/checkup/contract.mjs";
import { validateInterventionLedger } from "./intervention-ledger.mjs";
import {
  LEARNING_LOOP_CHECK_IDS,
  learningLoopStateErrors,
  projectLaterValidationState,
} from "./learning-loop-contract.mjs";
import { validateLearningLoopReview } from "./learning-loop-candidates.mjs";
import { validateLearningCaptureEvidence } from "./learning-capture-evidence.mjs";
import { validateWorkflowDemandDiagnostics } from "./workflow-demand-diagnostics.mjs";
import { buildSkillPatternRecord } from "./session-skill-pattern.mjs";
import { validateSkillPatternRecord } from "./skill-pattern-record.mjs";

export const HARNESS_REPORT_SOURCE_SCHEMA_VERSION = 3;
export const LEARNING_CAPTURE_INTERVENTION_FINDING_ID = "learning-capture-follow-up";
export const LEARNING_CAPTURE_FINDING_POLICY = "best-practice-fallback-v1";
export const AGENT4_SKILL_PATTERN_ANALYSIS_REF_KIND = "agent4-skill-pattern-analysis";
export const LEAD_SKILL_OWNER_ADJUDICATION_REF_KIND = "lead-skill-owner-adjudication";
export const FINDING_OUTPUT_ARTIFACTS = Object.freeze([
  "Code", "Document", "Rule", "Memory", "Skill", "Hook", "Gate", "Script",
  "Test", "Eval", "Workflow", "Agent", "Command", "Config", "MCP", "Runbook",
]);

export const DELIVERY_EVIDENCE_LEVELS = Object.freeze([
  "self-reported-completion",
  "local-command-passed",
  "relevant-focused-checks-passed",
  "ci-accepted",
  "review-or-merge-accepted",
  "deployment-outcome-observed",
  "approval-decision-observed",
  "recovery-outcome-observed",
]);
const DELIVERY_EVIDENCE_PROVIDERS = new Set([
  "codex-host", "qoder-host", "github", "gitlab", "npm", "vercel",
  "kubernetes", "git", "manual",
]);
const DELIVERY_EVIDENCE_KINDS = new Set([
  "validation", "acceptance", "approval", "release", "deployment", "recovery",
]);
const DELIVERY_LEVELS_BY_KIND = new Map([
  ["validation", new Set(["self-reported-completion", "local-command-passed", "relevant-focused-checks-passed"])],
  ["acceptance", new Set(["ci-accepted", "review-or-merge-accepted"])],
  ["approval", new Set(["approval-decision-observed"])],
  ["release", new Set(["review-or-merge-accepted", "deployment-outcome-observed"])],
  ["deployment", new Set(["deployment-outcome-observed"])],
  ["recovery", new Set(["recovery-outcome-observed"])],
]);

const REPORT_SOURCE_FIELDS = Object.freeze([
  "schemaVersion",
  "kind",
  "manifest",
  "repositoryEvidence",
  "sessionEvents",
  "taskEpisodes",
  "deliveryEvidence",
  "semanticFacets",
  "interventionLedger",
  "evidenceRefs",
  "assessmentDecisions",
]);

const RAW_CONTENT_FIELD_RE = /(?:^|_)(?:raw_?)?(?:prompt|command|content|transcript|user_?text|assistant_?text)$/i;
const DIAGNOSTIC_COVERAGE_STATUSES = new Set(["review-required", "covered", "confirmed-gap", "unverified", "not-applicable"]);
const DIAGNOSTIC_COVERAGE_FIELDS = new Set([
  "id", "status", "affectedScope", "summary", "evidenceRefs", "title",
  "missingSegment", "impact", "expectedOutcome", "severity",
  "expectedFileChanges", "expectedArtifact", "expectedOutput", "aiFixPrompt",
]);
const LEARNING_CAPTURE_CHECK_ID_SET = new Set(LEARNING_LOOP_CHECK_IDS);
const LIFECYCLE_REPEAT_DETECTION_STATES = new Set(["Present", "Wired", "Exercised", "Missing", "Unobserved"]);
const LOOP_ENGINEERING_STATES = new Set(["Present", "Wired", "Exercised", "Missing", "Unobserved", "Not applicable"]);
const LATER_VALIDATION_STATES = new Set(["Present", "Wired", "Exercised", "Outcome-supported", "Missing", "Unobserved", "Not applicable"]);
const LEARNING_CAPTURE_MECHANISMS = new Set(["memory", "repository-knowledge", "rule", "skill", "hook", "gate", "command", "mcp", "agent", "workflow", "eval", "test", "spec", "tool"]);
const SUPPORTED_FRICTION_PATTERN_IDS = new Set([
  "repeated-rediscovery",
  "recurring-correction",
  "present-but-not-routed",
  "routed-but-not-applied",
  "stale-or-conflicting-asset",
  "stale-or-conflicting-memory",
  "cross-asset-duplication-or-contradiction",
  "correction-not-promoted",
  "context-or-skill-regression",
  "memory-skill-duplication",
]);
const SUCCESSFUL_PROCEDURE_PATTERN_ID = "successful-procedure-not-reused";
const POSITIVE_RESULT_STATES = new Set([
  "accepted", "closed", "complete", "completed", "delivered", "improving",
  "outcome-supported", "passed", "success", "succeeded", "unchanged",
]);
const LEARNING_CAPTURE_DIAGNOSTIC_FIELDS = new Set([
  "signals", "learningCaptureSchemaVersion", "episodeRecords", "recurringIssueCandidates", "coverage",
]);
const LEARNING_CAPTURE_SIGNAL_FIELDS = new Set(["observedSkills", "unscopedObservedSkills", "apparentSkillReads", "configuredSkills", "memories", "memoryActivity", "memoryScan", "frictionSignals", "priorInterventionCount"]);
const MEMORY_SCAN_FIELDS = new Set(["status", "provider", "candidateCount", "contentPolicy"]);
const MEMORY_SCAN_STATUSES = new Set(["scanned-present", "scanned-empty", "not-scanned"]);
const LEARNING_CAPTURE_REVIEWED_CHECK_FIELDS = new Set([
  "id", "status", "state", "summary", "evidenceRefs", "findingRefs", "mechanisms",
  "candidateOwner", "ownerSelectionEvidenceRefs", "currentValidationEvidenceRefs",
]);
const READER_OVERVIEW_FIELDS = new Set(["text", "evidenceRefs"]);
const GLOBAL_PERMISSION_SUMMARY_FIELDS = new Set([
  "observed", "routineAllowed", "prompted", "denied", "escalated", "protectedActions",
]);
const EPISODE_PERMISSION_SUMMARY_FIELDS = new Set([
  "prompted", "denied", "escalated", "protectedActions", "evidenceRefs",
]);
const READER_OVERVIEW_MAX_LENGTH = Object.freeze({ en: 160, "zh-CN": 80 });
const GENERIC_OVERVIEW_PREFIX_RE = /^(?:The project has a usable foundation|The first improvement is|项目已有可用基础|当前首要改进是)/iu;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

const SKILL_OWNER_ACTION_KINDS = new Set(["repair-existing", "create-skill", "extend-skill"]);
const SKILL_RECEIPT_ACTIONS = new Set(["create-skill", "extend-skill"]);
const SKILL_OWNER_ADJUDICATION_STATUSES = new Set(["accepted", "accepted-alternative"]);
const SKILL_OWNER_ADJUDICATION_SUBJECT_KINDS = new Set(["finding", "intervention"]);
const SKILL_OWNER_ADJUDICATION_FIELDS = Object.freeze([
  "kind", "schemaVersion", "id", "analysisResultHash", "analysisBindingHash",
  "workflowDemandId", "sourceEpisodeIds", "selectedCandidateId", "advisoryAction",
  "subjectKind", "subjectId", "status", "selectedAction", "selectedTarget",
  "adjudicationHash",
]);
const SAFE_SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SAFE_SKILL_TARGET_REF_RE = /^(?:[A-Z][A-Z0-9-]{2,63}|skill:[a-z0-9]+(?:-[a-z0-9]+)*)$/u;

function hasExactFields(value, fields) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function normalizedReferenceIds(value) {
  return rows(value).map(String).filter(Boolean).sort();
}

function shortHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function normalizedSkillTarget(value) {
  return {
    targetRef: value?.targetRef ?? null,
    targetKind: value?.targetKind ?? null,
    proposedName: value?.proposedName ?? null,
  };
}

function validSkillTarget(action, target) {
  if (!hasExactFields(target, ["targetRef", "targetKind", "proposedName"])) return false;
  if (action === "create-skill") {
    return target.targetRef === null
      && target.targetKind === "new-skill"
      && SAFE_SKILL_NAME_RE.test(target.proposedName ?? "")
      && target.proposedName.length >= 3
      && target.proposedName.length <= 64;
  }
  return action === "extend-skill"
    && SAFE_SKILL_TARGET_REF_RE.test(target.targetRef ?? "")
    && target.targetRef.length <= 128
    && target.targetKind === "skill"
    && target.proposedName === null;
}

function skillOwnerAdjudicationPayload(value) {
  return {
    analysisResultHash: value?.analysisResultHash,
    analysisBindingHash: value?.analysisBindingHash,
    workflowDemandId: value?.workflowDemandId,
    sourceEpisodeIds: normalizedReferenceIds(value?.sourceEpisodeIds),
    selectedCandidateId: value?.selectedCandidateId,
    advisoryAction: value?.advisoryAction,
    subjectKind: value?.subjectKind,
    subjectId: value?.subjectId,
    status: value?.status,
    selectedAction: value?.selectedAction,
    selectedTarget: normalizedSkillTarget(value?.selectedTarget),
  };
}

function skillOwnerAdjudicationHash(value) {
  return shortHash(skillOwnerAdjudicationPayload(value));
}

function skillOwnerAdjudicationRecordBinding(receipt, skillPatternRecords) {
  if (!hasExactFields(receipt, SKILL_OWNER_ADJUDICATION_FIELDS)) return null;
  if (receipt.kind !== LEAD_SKILL_OWNER_ADJUDICATION_REF_KIND
    || receipt.schemaVersion !== 1
    || !SKILL_OWNER_ADJUDICATION_STATUSES.has(receipt.status)
    || !SKILL_OWNER_ADJUDICATION_SUBJECT_KINDS.has(receipt.subjectKind)
    || typeof receipt.subjectId !== "string"
    || !receipt.subjectId.trim()
    || !SKILL_RECEIPT_ACTIONS.has(receipt.selectedAction)
    || !validSkillTarget(receipt.selectedAction, receipt.selectedTarget)) return null;
  const hash = skillOwnerAdjudicationHash(receipt);
  if (receipt.adjudicationHash !== hash || receipt.id !== `skill-owner:${hash}`) return null;
  const matches = rows(skillPatternRecords)
    .filter((record) => record?.resultHash === receipt.analysisResultHash);
  if (matches.length !== 1) return null;
  const record = matches[0];
  if (validateSkillPatternRecord(record).length > 0
    || record.productionFindingEligible !== true
    || record.bindingHash !== receipt.analysisBindingHash
    || record.workflowDemandId !== receipt.workflowDemandId
    || JSON.stringify(normalizedReferenceIds(record.sourceEpisodeIds))
      !== JSON.stringify(normalizedReferenceIds(receipt.sourceEpisodeIds))) return null;
  const decisions = rows(record.advisoryDecisions)
    .filter((decision) => decision?.candidateId === receipt.selectedCandidateId);
  if (decisions.length !== 1 || !SKILL_RECEIPT_ACTIONS.has(decisions[0].action)) return null;
  const advisoryDecision = decisions[0];
  if (receipt.advisoryAction !== advisoryDecision.action) return null;
  if (receipt.status === "accepted"
    && (receipt.selectedAction !== advisoryDecision.action
      || JSON.stringify(receipt.selectedTarget) !== JSON.stringify(normalizedSkillTarget(advisoryDecision)))) return null;
  let finalDecision = advisoryDecision;
  if (receipt.status === "accepted-alternative") {
    const alternatives = rows(record.advisoryDecisions).filter((decision) =>
      decision?.candidateId !== receipt.selectedCandidateId
      && SKILL_RECEIPT_ACTIONS.has(decision?.action)
      && decision.action === receipt.selectedAction
      && JSON.stringify(normalizedSkillTarget(decision)) === JSON.stringify(receipt.selectedTarget));
    if (alternatives.length !== 1) return null;
    finalDecision = alternatives[0];
  }
  return { record, advisoryDecision, finalDecision };
}

function skillPatternLead(source, workflowDemandId) {
  const diagnostics = source?.repositoryEvidence?.workflowDemandDiagnostics;
  return [...rows(diagnostics?.currentHandoffs), ...rows(diagnostics?.repeatedCandidates)]
    .find((lead) => String(lead?.id ?? "") === workflowDemandId) ?? null;
}

function skillReceiptBinding(source, finding) {
  const workflowRefs = rows(finding?.staticEvidence)
    .filter((reference) => reference?.kind === "workflow-demand");
  if (workflowRefs.length !== 1 || !hasExactFields(workflowRefs[0], ["kind", "id"])) return null;
  const workflowDemandId = String(workflowRefs[0].id ?? "").trim();
  const lead = skillPatternLead(source, workflowDemandId);
  if (!lead) return null;
  return independentSkillDecisionRefs(
    finding.staticEvidence,
    source?.repositoryEvidence?.skillPatternRecords,
    source?.repositoryEvidence?.skillOwnerAdjudications,
    {
      workflowDemandId,
      sourceEpisodeIds: lead.sourceEpisodes,
      ownerAction: finding.ownerAction,
      subjectKind: "finding",
      subjectId: String(finding?.id ?? ""),
    },
  );
}

export function independentSkillDecisionRefs(refs, skillPatternRecords, skillOwnerAdjudications, {
  workflowDemandId,
  sourceEpisodeIds,
  ownerAction,
  subjectKind,
  subjectId,
} = {}) {
  const analyses = rows(refs).filter((reference) => reference?.kind === AGENT4_SKILL_PATTERN_ANALYSIS_REF_KIND);
  const adjudications = rows(refs).filter((reference) => reference?.kind === LEAD_SKILL_OWNER_ADJUDICATION_REF_KIND);
  if (analyses.length !== 1 || adjudications.length !== 1) return null;
  const analysis = analyses[0];
  const adjudication = adjudications[0];
  if (!hasExactFields(analysis, ["kind", "id"])
    || !hasExactFields(adjudication, ["kind", "id"])) return null;
  if (!Array.isArray(skillPatternRecords)) return null;
  const matches = skillPatternRecords.filter((record) => record?.resultHash === analysis.id);
  if (matches.length !== 1) return null;
  const record = matches[0];
  if (validateSkillPatternRecord(record).length > 0 || record.productionFindingEligible !== true) return null;
  if (typeof workflowDemandId !== "string" || !workflowDemandId.trim()
    || record.workflowDemandId !== workflowDemandId.trim()) return null;
  if (sourceEpisodeIds !== undefined
    && JSON.stringify(normalizedReferenceIds(record.sourceEpisodeIds))
      !== JSON.stringify(normalizedReferenceIds(sourceEpisodeIds))) return null;
  const receiptMatches = rows(skillOwnerAdjudications)
    .filter((receipt) => receipt?.id === adjudication.id);
  if (receiptMatches.length !== 1) return null;
  const receipt = receiptMatches[0];
  const binding = skillOwnerAdjudicationRecordBinding(receipt, skillPatternRecords);
  if (!binding || binding.record !== record) return null;
  const decision = {
    candidateId: receipt.selectedCandidateId,
    action: receipt.selectedAction,
    ...receipt.selectedTarget,
  };
  const ownerTargetRef = ownerAction?.targetRef ?? null;
  if (!SKILL_RECEIPT_ACTIONS.has(ownerAction?.kind)
    || receipt.analysisResultHash !== record.resultHash
    || receipt.subjectKind !== subjectKind
    || receipt.subjectId !== String(subjectId ?? "").trim()
    || receipt.selectedAction !== ownerAction.kind
    || receipt.selectedTarget.targetRef !== ownerTargetRef) return null;
  return {
    analysis,
    adjudication,
    receipt,
    record,
    advisoryDecision: binding.advisoryDecision,
    decision,
  };
}

function sameReference(left, right) {
  return left?.kind === right?.kind && left?.id === right?.id;
}

function softwareFluencyCapabilityFindings(capability) {
  return [
    ...rows(capability?.findings),
    ...(capability?.finding === undefined ? [] : [capability.finding]),
  ];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function permissionCountErrors(value, fields, prefix) {
  const errors = [];
  for (const field of fields) {
    if (!Number.isInteger(value?.[field]) || value[field] < 0) {
      errors.push(`${prefix}.${field} must be a non-negative integer`);
    }
  }
  return errors;
}

function permissionSummaryErrors(source) {
  if (!Number.isInteger(source?.schemaVersion) || source.schemaVersion < 3) return [];
  const errors = [];
  const global = source?.sessionEvents?.permissionSummary;
  const episodeTotals = {
    prompted: 0,
    denied: 0,
    escalated: 0,
    protectedActions: 0,
  };

  if (global !== undefined) {
    const prefix = "report source sessionEvents.permissionSummary";
    if (!isObject(global)) {
      errors.push(`${prefix} must be an object`);
    } else {
      for (const field of Object.keys(global)) {
        if (!GLOBAL_PERMISSION_SUMMARY_FIELDS.has(field)) errors.push(`${prefix} has unsupported field: ${field}`);
      }
      errors.push(...permissionCountErrors(global, GLOBAL_PERMISSION_SUMMARY_FIELDS, prefix));
      if (Number.isInteger(global.observed) && Number.isInteger(global.routineAllowed)
        && Number.isInteger(global.protectedActions)
        && global.observed !== global.routineAllowed + global.protectedActions) {
        errors.push(`${prefix}.observed must equal routineAllowed plus protectedActions`);
      }
      for (const field of ["prompted", "denied", "escalated"]) {
        if (Number.isInteger(global[field]) && Number.isInteger(global.protectedActions)
          && global[field] > global.protectedActions) {
          errors.push(`${prefix}.${field} must not exceed protectedActions`);
        }
      }
    }
  }

  for (const [index, episode] of rows(source?.taskEpisodes).entries()) {
    const prefix = `report source taskEpisodes[${index}]`;
    if (episode?.permissionDecisions !== undefined) {
      errors.push(`${prefix}.permissionDecisions is retired in source schema v3`);
    }
    const summary = episode?.permissionSummary;
    if (summary === undefined) continue;
    const summaryPrefix = `${prefix}.permissionSummary`;
    if (!isObject(summary)) {
      errors.push(`${summaryPrefix} must be an object`);
      continue;
    }
    for (const field of Object.keys(summary)) {
      if (!EPISODE_PERMISSION_SUMMARY_FIELDS.has(field)) errors.push(`${summaryPrefix} has unsupported field: ${field}`);
    }
    errors.push(...permissionCountErrors(summary, ["prompted", "denied", "escalated", "protectedActions"], summaryPrefix));
    if (Number.isInteger(summary.protectedActions) && summary.protectedActions < 1) {
      errors.push(`${summaryPrefix}.protectedActions must be positive when the summary is present`);
    }
    for (const field of ["prompted", "denied", "escalated"]) {
      if (Number.isInteger(summary[field]) && Number.isInteger(summary.protectedActions)
        && summary[field] > summary.protectedActions) {
        errors.push(`${summaryPrefix}.${field} must not exceed protectedActions`);
      }
    }
    if (!Array.isArray(summary.evidenceRefs)) {
      errors.push(`${summaryPrefix}.evidenceRefs must be an array`);
    } else {
      if (summary.evidenceRefs.length > 3) errors.push(`${summaryPrefix}.evidenceRefs must contain at most three references`);
      for (const reference of summary.evidenceRefs) {
        if (!isObject(reference) || !String(reference.kind ?? "").trim() || !String(reference.id ?? "").trim()) {
          errors.push(`${summaryPrefix}.evidenceRefs must contain public kind and id references`);
          break;
        }
      }
    }
    for (const field of Object.keys(episodeTotals)) {
      if (Number.isInteger(summary[field])) episodeTotals[field] += summary[field];
    }
  }

  if (episodeTotals.protectedActions > 0 && !isObject(global)) {
    errors.push("report source boundary permission summaries require sessionEvents.permissionSummary");
  }
  if (isObject(global)) {
    for (const field of Object.keys(episodeTotals)) {
      if (Number.isInteger(global[field]) && global[field] !== episodeTotals[field]) {
        errors.push(`report source sessionEvents.permissionSummary.${field} must match retained Episode summaries`);
      }
    }
  }
  return errors;
}

function isSafeRelativeScope(value) {
  const candidate = String(value ?? "").trim().replaceAll("\\", "/");
  return candidate.length > 0
    && candidate.length <= 240
    && !candidate.startsWith("/")
    && !/^[A-Za-z]:\//.test(candidate)
    && !candidate.split("/").includes("..");
}

export function findingOutputContractErrors(finding, prefix = "finding") {
  const errors = [];
  if (typeof finding?.expectedArtifact !== "string" || !finding.expectedArtifact.trim()) {
    errors.push(`${prefix}.expectedArtifact must be a non-empty string`);
  } else if (!FINDING_OUTPUT_ARTIFACTS.includes(finding.expectedArtifact)) {
    errors.push(`${prefix}.expectedArtifact must be one of: ${FINDING_OUTPUT_ARTIFACTS.join(", ")}`);
  }
  if (!Array.isArray(finding?.expectedOutput) || finding.expectedOutput.length < 1) {
    errors.push(`${prefix}.expectedOutput must contain non-empty strings`);
  } else if (finding.expectedOutput.some((output) => typeof output !== "string" || !output.trim())) {
    errors.push(`${prefix}.expectedOutput must contain only non-empty strings`);
  }
  return errors;
}

export function readerOverviewTextErrors(value, locale = "en", prefix = "reader overview") {
  const text = typeof value === "string" ? value.trim() : "";
  const maxLength = READER_OVERVIEW_MAX_LENGTH[locale] ?? READER_OVERVIEW_MAX_LENGTH.en;
  const errors = [];
  if (!text) errors.push(`${prefix}.text must be a non-empty string`);
  else {
    if (text.length > maxLength) errors.push(`${prefix}.text must contain at most ${maxLength} characters for ${locale}`);
    if (/\r|\n/u.test(text)) errors.push(`${prefix}.text must be one line`);
    if (/[。！？!?]|\.(?=\s|$)/u.test(text.replace(/[。！？.!?]$/u, ""))) errors.push(`${prefix}.text must be one sentence`);
    if (GENERIC_OVERVIEW_PREFIX_RE.test(text)) errors.push(`${prefix}.text must not use the shared foundation or first-improvement template`);
  }
  return errors;
}

export function validateReaderOverview(value, locale = "en", prefix = "report source repositoryEvidence.readerOverview") {
  if (value === undefined) return [];
  if (!isObject(value)) return [`${prefix} must be an object`];
  const errors = [];
  for (const field of Object.keys(value)) {
    if (!READER_OVERVIEW_FIELDS.has(field)) errors.push(`${prefix} has unsupported field: ${field}`);
  }
  errors.push(...readerOverviewTextErrors(value.text, locale, prefix));
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0) {
    errors.push(`${prefix}.evidenceRefs must contain reviewed evidence`);
  }
  return errors;
}

export function validateDiagnosticCoverageReviews(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ["report source repositoryEvidence.diagnosticCoverageReviews must be an array"];
  const errors = [];
  const ids = new Set();
  for (const [index, review] of value.entries()) {
    const prefix = `report source repositoryEvidence.diagnosticCoverageReviews[${index}]`;
    if (!isObject(review)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    for (const field of Object.keys(review)) {
      if (!DIAGNOSTIC_COVERAGE_FIELDS.has(field)) errors.push(`${prefix} has unsupported field: ${field}`);
    }
    const id = String(review.id ?? "").trim();
    if (!id) errors.push(`${prefix} missing id`);
    else if (ids.has(id)) errors.push(`${prefix} duplicates id: ${id}`);
    else ids.add(id);
    if (!DIAGNOSTIC_COVERAGE_STATUSES.has(review.status)) errors.push(`${prefix} has unsupported status: ${review.status}`);
    if (!isSafeRelativeScope(review.affectedScope)) errors.push(`${prefix}.affectedScope must be a bounded relative scope`);
    if (typeof review.summary !== "string" || !review.summary.trim()) errors.push(`${prefix} missing summary`);
    if (review.status === "covered" && /(?:^\s*Review\b|\breview-required\b|\bno\b.{0,80}\bfound\b|\bnot found\b|\bnot confirmed\b|\bunverified\b|未发现|无法确认|尚未确认)/iu.test(String(review.summary ?? ""))) {
      errors.push(`${prefix} covered status conflicts with unresolved summary`);
    }
    if (!Array.isArray(review.evidenceRefs)) errors.push(`${prefix}.evidenceRefs must be an array`);
    if (review.status !== "review-required" && Array.isArray(review.evidenceRefs) && review.evidenceRefs.length === 0) {
      errors.push(`${prefix} resolved status requires bounded evidenceRefs`);
    }
    if (review.status === "confirmed-gap") {
      if (review.affectedScope === "repository-wide") errors.push(`${prefix} confirmed-gap must name a bounded affected chain`);
      for (const field of ["title", "missingSegment", "impact", "expectedOutcome"]) {
        if (typeof review[field] !== "string" || !review[field].trim()) errors.push(`${prefix} confirmed-gap missing ${field}`);
      }
      if (!new Set(["High", "Medium"]).has(review.severity)) errors.push(`${prefix} confirmed-gap severity must be High or Medium`);
      errors.push(...findingOutputContractErrors(review, prefix));
    }
  }
  return errors;
}

function safeCapabilityPath(value, { requireMarkdown = false } = {}) {
  const candidate = String(value ?? "").trim().replaceAll("\\", "/");
  const safe = candidate.startsWith("~/") || isSafeRelativeScope(candidate);
  if (!safe) return false;
  if (!requireMarkdown) return true;
  return /\.md$/iu.test(candidate);
}

function validateSignalRows(value, location) {
  if (!Array.isArray(value)) return [`${location} must be an array`];
  const errors = [];
  for (const [index, row] of value.entries()) {
    const prefix = `${location}[${index}]`;
    if (!isObject(row)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    for (const field of Object.keys(row)) {
      if (!["name", "count"].includes(field)) errors.push(`${prefix} has unsupported field: ${field}`);
    }
    if (typeof row.name !== "string" || !row.name.trim()) errors.push(`${prefix}.name must be a non-empty string`);
    if (!Number.isInteger(row.count) || row.count < 0) errors.push(`${prefix}.count must be a non-negative integer`);
  }
  return errors;
}

function validateStringArray(value, location) {
  if (!Array.isArray(value)) return [`${location} must be an array`];
  return value.some((item) => typeof item !== "string" || !item.trim())
    ? [`${location} must contain only non-empty strings`]
    : [];
}

export function validateLearningCaptureDiagnostics(value) {
  if (value === undefined) return [];
  if (!isObject(value)) return ["report source repositoryEvidence.learningCaptureDiagnostics must be an object"];
  const prefix = "report source repositoryEvidence.learningCaptureDiagnostics";
  const errors = [];
  for (const field of Object.keys(value)) {
    if (!LEARNING_CAPTURE_DIAGNOSTIC_FIELDS.has(field)) errors.push(`${prefix} has unsupported field: ${field}`);
  }
  if (!isObject(value.signals)) {
    errors.push(`${prefix}.signals must be an object`);
  } else {
    for (const field of Object.keys(value.signals)) {
      if (!LEARNING_CAPTURE_SIGNAL_FIELDS.has(field)) errors.push(`${prefix}.signals has unsupported field: ${field}`);
    }
    errors.push(...validateSignalRows(value.signals.observedSkills ?? [], `${prefix}.signals.observedSkills`));
    errors.push(...validateSignalRows(value.signals.unscopedObservedSkills ?? [], `${prefix}.signals.unscopedObservedSkills`));
    errors.push(...validateSignalRows(value.signals.apparentSkillReads ?? [], `${prefix}.signals.apparentSkillReads`));
    if (value.signals.memoryActivity !== undefined) {
      errors.push(...validateSignalRows(value.signals.memoryActivity, `${prefix}.signals.memoryActivity`));
      if (Array.isArray(value.signals.memoryActivity)
        && value.signals.memoryActivity.some((row) => !["retrieve", "write"].includes(row?.name))) {
        errors.push(`${prefix}.signals.memoryActivity contains an unsupported activity`);
      }
    }
    if (value.signals.memoryScan !== undefined) {
      const scan = value.signals.memoryScan;
      if (!isObject(scan)) errors.push(`${prefix}.signals.memoryScan must be an object`);
      else {
        for (const field of Object.keys(scan)) {
          if (!MEMORY_SCAN_FIELDS.has(field)) errors.push(`${prefix}.signals.memoryScan has unsupported field: ${field}`);
        }
        if (!MEMORY_SCAN_STATUSES.has(scan.status)) errors.push(`${prefix}.signals.memoryScan.status is invalid`);
        if (typeof scan.provider !== "string" || !scan.provider.trim()) errors.push(`${prefix}.signals.memoryScan.provider must be a non-empty string`);
        if (!Number.isInteger(scan.candidateCount) || scan.candidateCount < 0) errors.push(`${prefix}.signals.memoryScan.candidateCount must be a non-negative integer`);
        if (scan.contentPolicy !== "metadata-only") errors.push(`${prefix}.signals.memoryScan.contentPolicy must be metadata-only`);
      }
    }
    errors.push(...validateSignalRows(value.signals.frictionSignals ?? [], `${prefix}.signals.frictionSignals`));
    for (const field of ["configuredSkills", "memories"]) {
      errors.push(...validateStringArray(value.signals[field] ?? [], `${prefix}.signals.${field}`));
      const requireMarkdown = field === "memories";
      if (Array.isArray(value.signals[field]) && value.signals[field].some((item) => !safeCapabilityPath(item, { requireMarkdown }))) {
        errors.push(`${prefix}.signals.${field} must contain only project-relative or home-relative paths${requireMarkdown ? " to .md files" : ""}`);
      }
    }
    if (!Number.isInteger(value.signals.priorInterventionCount) || value.signals.priorInterventionCount < 0) {
      errors.push(`${prefix}.signals.priorInterventionCount must be a non-negative integer`);
    }
  }
  errors.push(...validateLearningLoopReview({
    schemaVersion: value.learningCaptureSchemaVersion,
    status: "candidate",
    episodeRecords: value.episodeRecords,
    candidates: value.recurringIssueCandidates,
    coverage: value.coverage,
  }).map((error) => `${prefix}.${error}`));
  return errors;
}

function repositoryReviewDecision(source) {
  return (source?.assessmentDecisions ?? []).find((decision) => decision?.kind === "repository-review");
}

function learningCaptureReviewedChecks(source) {
  const review = repositoryReviewDecision(source);
  return new Map((review?.reviewedChecks ?? [])
    .filter((check) => LEARNING_CAPTURE_CHECK_ID_SET.has(check?.id))
    .map((check) => [check.id, check]));
}

function validateLearningCaptureReviewedCheck(value, id, states) {
  const location = `report source repository-review reviewedChecks.${id}`;
  if (!isObject(value)) return [`${location} must be an object`];
  const errors = [];
  for (const field of Object.keys(value)) {
    if (!LEARNING_CAPTURE_REVIEWED_CHECK_FIELDS.has(field)) errors.push(`${location} has unsupported field: ${field}`);
  }
  if (value.id !== id) errors.push(`${location}.id must be ${id}`);
  if (value.status !== "reviewed") errors.push(`${location}.status must be reviewed`);
  if (!states.has(value.state)) errors.push(`${location}.state is invalid`);
  if (typeof value.summary !== "string" || !value.summary.trim()) errors.push(`${location}.summary must be a non-empty string`);
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0) errors.push(`${location}.evidenceRefs must contain reviewed evidence`);
  if (!Array.isArray(value.findingRefs)) errors.push(`${location}.findingRefs must be an array`);
  if (id === "loop-engineering") {
    if (!Array.isArray(value.mechanisms)) errors.push(`${location}.mechanisms must be an array`);
    else if (value.mechanisms.some((item) => !LEARNING_CAPTURE_MECHANISMS.has(item))) errors.push(`${location}.mechanisms contains an unsupported durable owner`);
    else if (["Present", "Wired", "Exercised"].includes(value.state) && value.mechanisms.length === 0) {
      errors.push(`${location}.mechanisms must name an inspected durable owner for ${value.state}`);
    }
    if (value.candidateOwner !== undefined && !LEARNING_CAPTURE_MECHANISMS.has(value.candidateOwner)) {
      errors.push(`${location}.candidateOwner must name a supported durable owner`);
    }
    if (value.ownerSelectionEvidenceRefs !== undefined
      && (!Array.isArray(value.ownerSelectionEvidenceRefs) || value.ownerSelectionEvidenceRefs.length === 0)) {
      errors.push(`${location}.ownerSelectionEvidenceRefs must contain reviewed owner-selection evidence`);
    }
    if ((value.candidateOwner === undefined) !== (value.ownerSelectionEvidenceRefs === undefined)) {
      errors.push(`${location}.candidateOwner and ownerSelectionEvidenceRefs must be supplied together`);
    }
    if (["Present", "Wired", "Exercised"].includes(value.state)) {
      if (value.candidateOwner === undefined || value.ownerSelectionEvidenceRefs === undefined) {
        errors.push(`${location} ${value.state} requires candidateOwner and ownerSelectionEvidenceRefs`);
      } else if (!rows(value.mechanisms).includes(value.candidateOwner)) {
        errors.push(`${location}.mechanisms must include candidateOwner for ${value.state}`);
      }
    }
    if (value.state === "Not applicable"
      && (rows(value.mechanisms).length > 0 || value.candidateOwner !== undefined || value.ownerSelectionEvidenceRefs !== undefined)) {
      errors.push(`${location} Not applicable must not name a durable owner`);
    }
    if (value.state === "Exercised") {
      if (!Array.isArray(value.currentValidationEvidenceRefs) || value.currentValidationEvidenceRefs.length === 0) {
        errors.push(`${location} Exercised requires non-empty currentValidationEvidenceRefs`);
      }
    } else if (value.currentValidationEvidenceRefs !== undefined) {
      errors.push(`${location}.currentValidationEvidenceRefs is supported only for Exercised`);
    }
  } else if (value.mechanisms !== undefined) {
    errors.push(`${location}.mechanisms is not supported`);
  } else if (value.candidateOwner !== undefined || value.ownerSelectionEvidenceRefs !== undefined) {
    errors.push(`${location}.candidateOwner and ownerSelectionEvidenceRefs are not supported`);
  } else if (value.currentValidationEvidenceRefs !== undefined) {
    errors.push(`${location}.currentValidationEvidenceRefs is not supported`);
  }
  if (id === "lifecycle-repeat-detection" && value.state === "Exercised") {
    const episodeIds = new Set((Array.isArray(value.evidenceRefs) ? value.evidenceRefs : [])
      .filter((reference) => reference?.kind === "task-episode" && typeof reference?.id === "string" && reference.id.trim())
      .map((reference) => reference.id));
    if (episodeIds.size < 2) errors.push(`${location} Exercised state requires two distinct task-episode evidence refs`);
  }
  return errors;
}

function validateLearningCaptureReviewedChecks(source) {
  const review = repositoryReviewDecision(source);
  if (!review || review.status !== "reviewed") return [];
  const checks = learningCaptureReviewedChecks(source);
  const errors = [
    ...validateLearningCaptureReviewedCheck(checks.get("lifecycle-repeat-detection"), "lifecycle-repeat-detection", LIFECYCLE_REPEAT_DETECTION_STATES),
    ...validateLearningCaptureReviewedCheck(checks.get("loop-engineering"), "loop-engineering", LOOP_ENGINEERING_STATES),
    ...validateLearningCaptureReviewedCheck(checks.get("later-validation"), "later-validation", LATER_VALIDATION_STATES),
  ];
  if (errors.length === 0) {
    errors.push(...learningLoopStateErrors(LEARNING_LOOP_CHECK_IDS.map((id) => checks.get(id)), {
      interventionLedger: rows(source?.interventionLedger),
    })
      .map((error) => `report source repository-review reviewedChecks: ${error}`));
  }
  return errors;
}

function learningCaptureEpisodeKeys(episode) {
  return new Set([
    ...(typeof episode?.taskRoute === "string" && episode.taskRoute.trim()
      ? [`route:${episode.taskRoute.trim()}`]
      : []),
    ...(Array.isArray(episode?.lifecycleSignals)
      ? episode.lifecycleSignals
        .map((signal) => String(signal?.intent ?? "").trim())
        .filter(Boolean)
        .map((intent) => `workflow:${intent}`)
      : []),
    ...(Array.isArray(episode?.targetKeys)
      ? episode.targetKeys
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => `target:${value.trim()}`)
      : []),
  ]);
}

function successfulProcedureHasResultEvidence(source, candidate) {
  const records = new Map(rows(source?.repositoryEvidence?.learningCaptureDiagnostics?.episodeRecords)
    .map((record) => [String(record?.episodeId ?? ""), record]));
  return rows(candidate?.sourceEpisodes).every((episodeId) => rows(records.get(String(episodeId))?.signals)
    .some((signal) => signal?.patternId === SUCCESSFUL_PROCEDURE_PATTERN_ID
      && signal?.normalizedSignature === candidate?.normalizedSignature
      && rows(signal?.evidenceRefs).length > 0
      && (POSITIVE_RESULT_STATES.has(signal?.validationResult)
        || POSITIVE_RESULT_STATES.has(signal?.deliveryResult))));
}

function supportedLearningLoopCandidate(source, episodeIds) {
  const required = new Set(rows(episodeIds).map(String).filter(Boolean));
  if (required.size < 2) return null;
  return rows(source?.repositoryEvidence?.learningCaptureDiagnostics?.recurringIssueCandidates)
    .find((candidate) => {
      const candidateEpisodes = new Set(rows(candidate?.sourceEpisodes).map(String).filter(Boolean));
      const supportedPattern = SUPPORTED_FRICTION_PATTERN_IDS.has(candidate?.patternId)
        || candidate?.patternId === SUCCESSFUL_PROCEDURE_PATTERN_ID;
      return supportedPattern
        && candidateEpisodes.size >= 2
        && required.size <= candidateEpisodes.size
        && [...required].every((id) => candidateEpisodes.has(id))
        && rows(candidate?.evidenceRefs).length > 0
        && (candidate?.patternId !== SUCCESSFUL_PROCEDURE_PATTERN_ID
          || successfulProcedureHasResultEvidence(source, candidate));
    }) ?? null;
}

function supportedLearningLoopCandidates(source) {
  return rows(source?.repositoryEvidence?.learningCaptureDiagnostics?.recurringIssueCandidates)
    .filter((candidate) => supportedLearningLoopCandidate(source, candidate?.sourceEpisodes)?.id === candidate?.id);
}

function lifecycleSignalEpisodeIds(source) {
  return rows(source?.taskEpisodes)
    .filter((episode) => rows(episode?.lifecycleSignals).some((signal) => typeof signal?.intent === "string" && signal.intent.trim()))
    .map((episode) => String(episode?.id ?? ""))
    .filter(Boolean);
}

export function isAdequateLearningLoopNoCandidateWindow(source) {
  const diagnostics = source?.repositoryEvidence?.workflowDemandDiagnostics;
  if (!diagnostics) return false;
  if (validateWorkflowDemandDiagnostics(diagnostics, workflowDemandValidationInputs(source)).length > 0) return false;
  const selection = source?.manifest?.selection ?? {};
  return Number(selection.eligibleCount ?? 0) >= 2
    && Number(selection.analyzedCount ?? 0) >= 2
    && rows(source?.taskEpisodes).length >= 2
    && new Set(lifecycleSignalEpisodeIds(source)).size >= 2
    && rows(diagnostics.repeatedCandidates).length === 0
    && diagnostics?.coverage?.demandSignals === "candidate-found"
    && diagnostics?.coverage?.recurrence === "insufficient-recurrence"
    && supportedLearningLoopCandidates(source).length === 0;
}

function reviewedTaskEpisodeIds(check) {
  return [...new Set(rows(check?.evidenceRefs)
    .filter((reference) => reference?.kind === "task-episode" && typeof reference?.id === "string" && reference.id.trim())
    .map((reference) => reference.id.trim()))];
}

function learningCaptureSourceIntegrityErrors(source) {
  const review = repositoryReviewDecision(source);
  if (review?.status !== "reviewed") return [];
  const checks = learningCaptureReviewedChecks(source);
  const detection = checks.get("lifecycle-repeat-detection");
  const engineering = checks.get("loop-engineering");
  const later = checks.get("later-validation");
  const prefix = "report source repository-review reviewedChecks";
  const errors = [];
  const diagnostics = source?.repositoryEvidence?.learningCaptureDiagnostics;
  if (diagnostics) {
    errors.push(...validateLearningLoopReview({
      schemaVersion: diagnostics.learningCaptureSchemaVersion,
      status: "candidate",
      episodeRecords: diagnostics.episodeRecords,
      candidates: diagnostics.recurringIssueCandidates,
      coverage: diagnostics.coverage,
    }, {
      episodeIds: (source.taskEpisodes ?? []).map((episode) => String(episode?.id ?? "")),
    }).map((error) => `report source repositoryEvidence.learningCaptureDiagnostics.${error}`));
  }
  const workflowDiagnostics = source?.repositoryEvidence?.workflowDemandDiagnostics;
  const workflowErrors = workflowDiagnostics
    ? validateWorkflowDemandDiagnostics(workflowDiagnostics, workflowDemandValidationInputs(source))
    : ["workflow demand diagnostics are missing"];
  if (detection?.state === "Present" && (!diagnostics || !workflowDiagnostics)) {
    errors.push(`${prefix}.lifecycle-repeat-detection Present requires generated learning and workflow diagnostics`);
  }
  if (detection?.state === "Wired") {
    if (workflowErrors.length > 0 || lifecycleSignalEpisodeIds(source).length === 0) {
      errors.push(`${prefix}.lifecycle-repeat-detection Wired requires validated generated diagnostics connected to a user-originated lifecycle signal`);
    }
  }
  const supportedCandidates = supportedLearningLoopCandidates(source);
  let acceptedCandidates = [];
  if (detection?.state === "Exercised") {
    const episodeById = new Map((source.taskEpisodes ?? []).map((episode) => [String(episode?.id ?? ""), episode]));
    const episodeIds = reviewedTaskEpisodeIds(detection);
    const reviewedEpisodeIds = new Set(episodeIds);
    const missingIds = episodeIds.filter((id) => !episodeById.has(id));
    if (missingIds.length > 0) errors.push(`${prefix}.lifecycle-repeat-detection references unknown task episodes: ${missingIds.join(", ")}`);
    acceptedCandidates = supportedCandidates.filter((candidate) => {
      const candidateEpisodeIds = [...new Set(rows(candidate?.sourceEpisodes).map(String).filter(Boolean))];
      return candidateEpisodeIds.length >= 2
        && candidateEpisodeIds.every((id) => reviewedEpisodeIds.has(id));
    });
    if (acceptedCandidates.length > 0) {
      for (const candidate of acceptedCandidates) {
        const episodes = rows(candidate?.sourceEpisodes).map((id) => episodeById.get(String(id))).filter(Boolean);
        const keySets = episodes.map(learningCaptureEpisodeKeys);
        const shared = keySets.length >= 2
          && [...keySets[0]].some((key) => keySets.slice(1).every((keys) => keys.has(key)));
        if (!shared) errors.push(`${prefix}.lifecycle-repeat-detection candidate episodes must share a reviewed task route or redacted target key`);
      }
    } else if (!isAdequateLearningLoopNoCandidateWindow(source)) {
      errors.push(`${prefix}.lifecycle-repeat-detection Exercised requires a supported repeated friction or successful-procedure candidate, or an adequate explicit no-candidate window`);
    }
  }
  const adequateNoCandidate = isAdequateLearningLoopNoCandidateWindow(source);
  if (["Present", "Wired", "Exercised"].includes(engineering?.state)) {
    if (detection?.state !== "Exercised" || acceptedCandidates.length === 0) {
      errors.push(`${prefix}.loop-engineering ${engineering.state} requires an accepted supported candidate from lifecycle-repeat-detection`);
    }
  }
  if (engineering?.state === "Not applicable") {
    if (detection?.state !== "Exercised" || !adequateNoCandidate || supportedCandidates.length > 0) {
      errors.push(`${prefix}.loop-engineering Not applicable requires an exercised adequate window with no supported candidate`);
    }
  } else if (adequateNoCandidate && detection?.state === "Exercised" && supportedCandidates.length === 0) {
    errors.push(`${prefix}.loop-engineering must be Not applicable after an exercised adequate no-candidate window`);
  }
  const ledger = rows(source?.interventionLedger);
  const projectedLaterState = projectLaterValidationState(ledger, {
    loopEngineeringState: engineering?.state,
  });
  if (ledger.length > 0 && later?.state !== projectedLaterState) {
    errors.push(`${prefix}.later-validation must be ${projectedLaterState} for the current Loop Engineering state and retained intervention ledger`);
  }
  return errors;
}

function isProjectedCheckupFinding(finding) {
  if (finding?.capabilityRecommendation) return false;
  if (finding?.status === "candidate") return true;
  if (finding?.kind !== "hook") return false;
  const codes = new Set(rows(finding?.evidence).map((item) => item?.code));
  return codes.has("hook-group-p95-over-budget")
    || codes.has("hook-count-over-recommended-limit")
    || codes.has("static-hook-review");
}

function projectedCheckupFindingIds(source) {
  const repositoryEvidence = source?.repositoryEvidence ?? {};
  const findings = [
    ...rows(repositoryEvidence.checkupFindings),
    ...rows(repositoryEvidence.checkup?.findings),
    ...rows(repositoryEvidence.customizationCheckup?.findings),
  ].filter(isProjectedCheckupFinding);
  const capabilitySummaries = rows(repositoryEvidence.customizationCheckup?.summary?.capabilityUse)
    .filter((row) => Number(row?.configured ?? 0) > 0
      && Number(row?.unobserved ?? 0) + Number(row?.configuredOnly ?? 0) + Number(row?.unavailable ?? 0) > 0)
    .map((row) => ({ id: `capability-use-${String(row?.kind ?? "unknown")}` }));
  return new Set([...findings, ...capabilitySummaries].map((finding, index) =>
    `checkup-${String(finding?.id ?? index + 1).replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 80)}`));
}

function sourceFindingIntegrityErrors(source) {
  const findings = rows(source?.repositoryEvidence?.findings);
  const findingsById = new Map();
  const errors = [];
  const diagnosticIds = new Set(rows(source?.repositoryEvidence?.diagnosticCoverageReviews)
    .filter((review) => review?.status === "confirmed-gap")
    .map((review) => `diagnostic-${String(review?.id ?? "")}`));
  const checkupIds = projectedCheckupFindingIds(source);
  const review = repositoryReviewDecision(source);

  if (review?.learningCaptureFindingPolicy !== undefined
    && review.learningCaptureFindingPolicy !== LEARNING_CAPTURE_FINDING_POLICY) {
    errors.push(`report source repository-review learningCaptureFindingPolicy must be ${LEARNING_CAPTURE_FINDING_POLICY}`);
  }

  for (const [index, finding] of findings.entries()) {
    const prefix = `report source repositoryEvidence.findings[${index}]`;
    const id = String(finding?.id ?? "").trim();
    if (!id) {
      errors.push(`${prefix}.id must be a non-empty string`);
      continue;
    }
    if (findingsById.has(id)) errors.push(`${prefix}.id duplicates ordinary source finding id: ${id}`);
    else findingsById.set(id, finding);
    if (id === LEARNING_CAPTURE_INTERVENTION_FINDING_ID) {
      errors.push(`${prefix}.id is reserved for longitudinal follow-up: ${id}`);
    }
    if (diagnosticIds.has(id) || checkupIds.has(id)) {
      errors.push(`${prefix}.id collides with a generated finding id: ${id}`);
    }
    errors.push(...findingOutputContractErrors(finding, prefix));
    if (finding?.ownerAction !== undefined) {
      if (!hasExactFields(finding.ownerAction, ["kind", "targetRef"])) {
        errors.push(`${prefix}.ownerAction must contain only kind and targetRef`);
      } else {
        if (!SKILL_OWNER_ACTION_KINDS.has(finding.ownerAction.kind)) {
          errors.push(`${prefix}.ownerAction.kind is unsupported: ${finding.ownerAction.kind}`);
        }
        if (finding.ownerAction.targetRef !== null
          && (typeof finding.ownerAction.targetRef !== "string" || !finding.ownerAction.targetRef.trim())) {
          errors.push(`${prefix}.ownerAction.targetRef must be null or a non-empty string`);
        }
      }
    }

    const dimensionRefs = rows(finding?.dimensionRefs).map(String);
    const learningCheckRefs = rows(finding?.subdimensionRefs)
      .map(String)
      .filter((ref) => LEARNING_CAPTURE_CHECK_ID_SET.has(ref));
    if ((dimensionRefs.includes("learning-capture") || learningCheckRefs.length > 0)
      && learningCheckRefs.length !== 1) {
      errors.push(`${prefix} Learning Capture finding must name exactly one Learning Capture subdimension`);
    }
    if (learningCheckRefs.length > 0 && !dimensionRefs.includes("learning-capture")) {
      errors.push(`${prefix} Learning Capture subdimension requires learning-capture in dimensionRefs`);
    }
  }

  for (const [index, capability] of rows(review?.reviewedSoftwareFluencyCapabilities).entries()) {
    for (const [findingIndex, finding] of softwareFluencyCapabilityFindings(capability).entries()) {
      errors.push(...findingOutputContractErrors(
        finding,
        `report source repository-review reviewedSoftwareFluencyCapabilities[${index}].findings[${findingIndex}]`,
      ));
    }
  }

  if (review?.status !== "reviewed") return errors;
  const checks = learningCaptureReviewedChecks(source);
  for (const check of checks.values()) {
    for (const rawFindingId of rows(check.findingRefs)) {
      const findingId = String(rawFindingId);
      const finding = findingsById.get(findingId);
      if (!finding) {
        errors.push(`report source repository-review reviewedChecks.${check.id} references unknown finding: ${findingId}`);
      } else if (!rows(finding.subdimensionRefs).map(String).includes(check.id)) {
        errors.push(`report source repository-review reviewedChecks.${check.id} finding ${findingId} must name ${check.id} in subdimensionRefs`);
      }
    }
  }
  for (const finding of findings) {
    const findingId = String(finding?.id ?? "").trim();
    for (const checkId of rows(finding?.subdimensionRefs).map(String).filter((ref) => LEARNING_CAPTURE_CHECK_ID_SET.has(ref))) {
      if (!rows(checks.get(checkId)?.findingRefs).map(String).includes(findingId)) {
        errors.push(`report source repositoryEvidence.findings[${findingId || "(unknown)"}] must be linked from ${checkId}.findingRefs`);
      }
    }
  }

  if (review?.learningCaptureFindingPolicy === LEARNING_CAPTURE_FINDING_POLICY) {
    const ownedFindings = (checkId) => rows(checks.get(checkId)?.findingRefs).flatMap((rawFindingId) => {
      const finding = findingsById.get(String(rawFindingId));
      return rows(finding?.dimensionRefs).map(String).includes("learning-capture")
        && rows(finding?.subdimensionRefs).map(String).includes(checkId)
        ? [finding]
        : [];
    });
    const detection = checks.get("lifecycle-repeat-detection");
    const engineering = checks.get("loop-engineering");
    const boundedWindow = Number(source?.manifest?.selection?.analyzedCount ?? 0) >= 2
      && rows(source?.taskEpisodes).length >= 2;
    const supportedCandidates = supportedLearningLoopCandidates(source);
    const adequateCleanWindow = isAdequateLearningLoopNoCandidateWindow(source);
    const reviewedAdequateCleanWindow = adequateCleanWindow
      && detection?.state === "Exercised"
      && engineering?.state === "Not applicable";
    const detectionFindings = ownedFindings("lifecycle-repeat-detection");
    const fallbackRequired = boundedWindow
      && !reviewedAdequateCleanWindow
      && (supportedCandidates.length === 0 || detection?.state !== "Exercised");
    if (fallbackRequired && detectionFindings.length === 0) {
      errors.push("report source Learning Capture no-match policy requires a lifecycle-repeat-detection finding for a bounded window without an accepted supported match or a reviewed adequate clean result");
    }
    const repeatedLeadIds = new Set(rows(source?.repositoryEvidence?.workflowDemandDiagnostics?.repeatedCandidates)
      .map((lead) => String(lead?.id ?? ""))
      .filter(Boolean));
    if (fallbackRequired && repeatedLeadIds.size > 0
      && !detectionFindings.some((finding) => rows(finding?.staticEvidence)
        .some((reference) => reference?.kind === "workflow-demand" && repeatedLeadIds.has(String(reference?.id ?? ""))))) {
      errors.push("report source Learning Capture no-match finding must bind one generated repeated workflow-demand lead when repeated demand is available");
    }
    if (detection?.state === "Exercised"
      && ["Missing", "Unobserved"].includes(engineering?.state)
      && supportedCandidates.length > 0
      && ownedFindings("loop-engineering").length === 0) {
      errors.push(`report source Learning Capture no-match policy requires a loop-engineering finding when Loop Engineering is ${engineering.state}`);
    }
  }

  const hasLaterValidationFinding = findings.some((finding) => {
    const learningCheckRefs = rows(finding?.subdimensionRefs)
      .map(String)
      .filter((ref) => LEARNING_CAPTURE_CHECK_ID_SET.has(ref));
    return learningCheckRefs.length === 1 && learningCheckRefs[0] === "later-validation";
  });
  const engineering = checks.get("loop-engineering");
  const later = checks.get("later-validation");
  if (engineering?.state === "Exercised" && later?.state === "Missing" && !hasLaterValidationFinding) {
    errors.push("report source later-validation Missing requires an ordinary finding for the incomplete comparison plan");
  }
  if (rows(source?.interventionLedger).some((entry) => entry?.result?.state === "regressing")) {
    if (!hasLaterValidationFinding) {
      errors.push("report source regressing intervention requires an ordinary finding owned by later-validation");
    }
  }
  return errors;
}

function workflowDemandSourceIntegrityErrors(source) {
  const diagnostics = source?.repositoryEvidence?.workflowDemandDiagnostics;
  if (!diagnostics) return [];
  const episodeById = new Map((source?.taskEpisodes ?? []).map((episode) => [String(episode?.id ?? ""), episode]));
  const errors = [];
  for (const lead of [...(diagnostics.currentHandoffs ?? []), ...(diagnostics.repeatedCandidates ?? [])]) {
    const missing = (lead?.sourceEpisodes ?? []).filter((id) => !episodeById.has(String(id)));
    if (missing.length > 0) {
      errors.push(`report source repositoryEvidence.workflowDemandDiagnostics lead ${lead?.id ?? "(unknown)"} references unknown task episodes: ${missing.join(", ")}`);
    }
    const withoutDemand = (lead?.sourceEpisodes ?? [])
      .map((id) => episodeById.get(String(id)))
      .filter(Boolean)
      .filter((episode) => !Array.isArray(episode?.lifecycleSignals) || episode.lifecycleSignals.length === 0)
      .map((episode) => episode.id);
    if (withoutDemand.length > 0) {
      errors.push(`report source repositoryEvidence.workflowDemandDiagnostics lead ${lead?.id ?? "(unknown)"} must reference lifecycle-demand task episodes: ${withoutDemand.join(", ")}`);
    }
  }
  return errors;
}

function skillPatternRecordRegistryErrors(source) {
  const value = source?.repositoryEvidence?.skillPatternRecords;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return ["report source repositoryEvidence.skillPatternRecords must be an array"];
  }
  const errors = [];
  const resultHashes = new Set();
  const bindingHashes = new Set();
  for (const [index, record] of value.entries()) {
    const prefix = `report source repositoryEvidence.skillPatternRecords[${index}]`;
    errors.push(...validateSkillPatternRecord(record)
      .map((error) => `${prefix}.${error.replace(/^record\.?/u, "")}`));
    if (resultHashes.has(record?.resultHash)) errors.push(`${prefix}.resultHash is duplicated`);
    else if (typeof record?.resultHash === "string") resultHashes.add(record.resultHash);
    if (bindingHashes.has(record?.bindingHash)) errors.push(`${prefix}.bindingHash is duplicated`);
    else if (typeof record?.bindingHash === "string") bindingHashes.add(record.bindingHash);
    if (record?.workflowDemandId !== null) {
      const lead = skillPatternLead(source, String(record?.workflowDemandId ?? ""));
      if (!lead) {
        errors.push(`${prefix}.workflowDemandId must reference a generated workflow-demand lead`);
      } else if (JSON.stringify(normalizedReferenceIds(record?.sourceEpisodeIds))
        !== JSON.stringify(normalizedReferenceIds(lead.sourceEpisodes))) {
        errors.push(`${prefix}.sourceEpisodeIds must match the bound workflow-demand lead`);
      }
    }
  }
  return [...new Set(errors)];
}

function skillOwnerAdjudicationRegistryErrors(source) {
  const value = source?.repositoryEvidence?.skillOwnerAdjudications;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return ["report source repositoryEvidence.skillOwnerAdjudications must be an array"];
  }
  const errors = [];
  const ids = new Set();
  const hashes = new Set();
  const subjects = new Set();
  const candidates = new Set();
  for (const [index, receipt] of value.entries()) {
    const prefix = `report source repositoryEvidence.skillOwnerAdjudications[${index}]`;
    if (!hasExactFields(receipt, SKILL_OWNER_ADJUDICATION_FIELDS)) {
      errors.push(`${prefix} must contain only the generated adjudication receipt fields`);
      continue;
    }
    const binding = skillOwnerAdjudicationRecordBinding(
      receipt,
      source?.repositoryEvidence?.skillPatternRecords,
    );
    if (!binding) errors.push(`${prefix} must bind one eligible Agent 4 candidate and a valid lead decision`);
    if (ids.has(receipt.id)) errors.push(`${prefix}.id is duplicated`);
    else ids.add(receipt.id);
    if (hashes.has(receipt.adjudicationHash)) errors.push(`${prefix}.adjudicationHash is duplicated`);
    else hashes.add(receipt.adjudicationHash);
    const subjectKey = `${receipt.subjectKind}:${receipt.subjectId}`;
    if (subjects.has(subjectKey)) errors.push(`${prefix} duplicates owner adjudication subject ${subjectKey}`);
    else subjects.add(subjectKey);
    const candidateKey = `${receipt.analysisResultHash}:${receipt.selectedCandidateId}`;
    if (candidates.has(candidateKey)) errors.push(`${prefix} replays Agent 4 candidate ${candidateKey}`);
    else candidates.add(candidateKey);
  }
  return [...new Set(errors)];
}

function skillOwnerAdjudicationUsageErrors(source) {
  const registry = rows(source?.repositoryEvidence?.skillOwnerAdjudications);
  const receiptsById = new Map(registry.map((receipt) => [receipt?.id, receipt]));
  const usages = [];
  const review = repositoryReviewDecision(source);
  const findings = [
    ...rows(source?.repositoryEvidence?.findings),
    ...rows(review?.reviewedSoftwareFluencyCapabilities)
      .flatMap((capability) => softwareFluencyCapabilityFindings(capability)),
  ];
  for (const finding of findings) {
    const subjectId = String(finding?.id ?? "").trim();
    for (const reference of [...rows(finding?.staticEvidence), ...rows(finding?.evidenceRefs)]
      .filter((row) => row?.kind === LEAD_SKILL_OWNER_ADJUDICATION_REF_KIND)) {
      usages.push({ reference, subjectKind: "finding", subjectId, ownerAction: finding?.ownerAction });
    }
  }
  for (const entry of rows(source?.interventionLedger)) {
    const subjectId = String(entry?.id ?? "").trim();
    for (const reference of rows(entry?.frictionRefs)
      .filter((row) => row?.kind === LEAD_SKILL_OWNER_ADJUDICATION_REF_KIND)) {
      usages.push({ reference, subjectKind: "intervention", subjectId });
    }
  }
  const errors = [];
  const usedReceiptIds = new Set();
  for (const usage of usages) {
    const prefix = `report source ${usage.subjectKind}[${usage.subjectId || "(unknown)"}]`;
    if (!hasExactFields(usage.reference, ["kind", "id"])) {
      errors.push(`${prefix} Skill owner adjudication ref must contain only kind and id`);
      continue;
    }
    const receipt = receiptsById.get(usage.reference.id);
    if (!receipt) {
      errors.push(`${prefix} references an unknown generated Skill owner adjudication receipt`);
      continue;
    }
    if (receipt.subjectKind !== usage.subjectKind || receipt.subjectId !== usage.subjectId) {
      errors.push(`${prefix} cannot replay a Skill owner adjudication receipt bound to ${receipt.subjectKind}:${receipt.subjectId}`);
    }
    if (usedReceiptIds.has(receipt.id)) {
      errors.push(`${prefix} replays Skill owner adjudication receipt ${receipt.id}`);
    } else {
      usedReceiptIds.add(receipt.id);
    }
    if (usage.subjectKind === "finding" && !SKILL_RECEIPT_ACTIONS.has(usage.ownerAction?.kind)) {
      errors.push(`${prefix} cannot reference a Skill owner adjudication without a create-skill or extend-skill ownerAction`);
    }
  }
  return [...new Set(errors)];
}

export function attachSkillPatternAnalysis(sourceInput, packet, result, options = {}) {
  if (!isObject(sourceInput)) throw new TypeError("report source must be an object");
  const source = clone(sourceInput);
  const workflowDemandId = String(packet?.provenance?.workflowDemandId ?? "").trim();
  const lead = skillPatternLead(source, workflowDemandId);
  if (!lead) {
    throw new Error("Skill pattern packet must bind one generated workflow-demand lead");
  }
  const sourceEpisodeIds = rows(packet?.provenance?.inputs)
    .map((input) => String(input?.sourceEpisodeId ?? ""))
    .filter(Boolean)
    .sort();
  if (JSON.stringify(sourceEpisodeIds) !== JSON.stringify(normalizedReferenceIds(lead.sourceEpisodes))) {
    throw new Error("Skill pattern packet source Episodes must exactly match the generated workflow-demand lead");
  }
  const record = buildSkillPatternRecord(packet, result, options);
  if (record.productionFindingEligible !== true) {
    throw new Error("Skill pattern analysis is not eligible for a production finding");
  }
  const existing = rows(source?.repositoryEvidence?.skillPatternRecords);
  if (existing.some((entry) => entry?.resultHash === record.resultHash
    || entry?.bindingHash === record.bindingHash)) {
    throw new Error("Skill pattern analysis is already attached to this report source");
  }
  source.repositoryEvidence ??= {};
  source.repositoryEvidence.skillPatternRecords = [...existing, record];
  const errors = validateHarnessReportSource(source);
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join("; ")), { code: "INVALID_REPORT_SOURCE", errors });
  }
  return { source, record };
}

export function attachSkillOwnerAdjudication(sourceInput, {
  analysisResultHash,
  selectedCandidateId,
  subjectKind,
  subjectId,
  status = "accepted",
  selectedAction,
  selectedTarget,
} = {}) {
  if (!isObject(sourceInput)) throw new TypeError("report source must be an object");
  const source = clone(sourceInput);
  const records = rows(source?.repositoryEvidence?.skillPatternRecords);
  const matches = records.filter((record) => record?.resultHash === analysisResultHash);
  if (matches.length !== 1) {
    throw new Error("Skill owner adjudication requires one attached Agent 4 analysis result");
  }
  const record = matches[0];
  if (validateSkillPatternRecord(record).length > 0 || record.productionFindingEligible !== true) {
    throw new Error("Skill owner adjudication requires an eligible Agent 4 analysis result");
  }
  const candidates = rows(record.advisoryDecisions)
    .filter((decision) => decision?.candidateId === selectedCandidateId);
  if (candidates.length !== 1 || !SKILL_RECEIPT_ACTIONS.has(candidates[0].action)) {
    throw new Error("Skill owner adjudication requires one Skill-owning Agent 4 candidate");
  }
  if (!SKILL_OWNER_ADJUDICATION_SUBJECT_KINDS.has(subjectKind)
    || typeof subjectId !== "string" || !subjectId.trim()) {
    throw new Error("Skill owner adjudication requires a finding or intervention subject");
  }
  if (!SKILL_OWNER_ADJUDICATION_STATUSES.has(status)) {
    throw new Error("Skill owner adjudication status must be accepted or accepted-alternative");
  }
  const advisoryDecision = candidates[0];
  const leadAction = selectedAction ?? advisoryDecision.action;
  const leadTarget = normalizedSkillTarget(selectedTarget ?? advisoryDecision);
  if (!SKILL_RECEIPT_ACTIONS.has(leadAction) || !validSkillTarget(leadAction, leadTarget)) {
    throw new Error("Skill owner adjudication requires a valid final create-skill or extend-skill target");
  }
  if (status === "accepted"
    && (leadAction !== advisoryDecision.action
      || JSON.stringify(leadTarget) !== JSON.stringify(normalizedSkillTarget(advisoryDecision)))) {
    throw new Error("Accepted Skill owner adjudication must preserve the Agent 4 advisory action and target");
  }
  const receipt = {
    kind: LEAD_SKILL_OWNER_ADJUDICATION_REF_KIND,
    schemaVersion: 1,
    id: "",
    analysisResultHash: record.resultHash,
    analysisBindingHash: record.bindingHash,
    workflowDemandId: record.workflowDemandId,
    sourceEpisodeIds: normalizedReferenceIds(record.sourceEpisodeIds),
    selectedCandidateId,
    advisoryAction: advisoryDecision.action,
    subjectKind,
    subjectId: subjectId.trim(),
    status,
    selectedAction: leadAction,
    selectedTarget: leadTarget,
    adjudicationHash: "",
  };
  receipt.adjudicationHash = skillOwnerAdjudicationHash(receipt);
  receipt.id = `skill-owner:${receipt.adjudicationHash}`;
  const existing = rows(source?.repositoryEvidence?.skillOwnerAdjudications);
  const candidateKey = `${record.resultHash}:${selectedCandidateId}`;
  if (existing.some((entry) => entry?.id === receipt.id
    || entry?.adjudicationHash === receipt.adjudicationHash
    || `${entry?.subjectKind}:${entry?.subjectId}` === `${subjectKind}:${receipt.subjectId}`
    || `${entry?.analysisResultHash}:${entry?.selectedCandidateId}` === candidateKey)) {
    throw new Error("Skill owner adjudication receipt, subject, or Agent 4 candidate is already attached");
  }
  source.repositoryEvidence ??= {};
  source.repositoryEvidence.skillOwnerAdjudications = [...existing, receipt];
  const errors = validateHarnessReportSource(source);
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join("; ")), { code: "INVALID_REPORT_SOURCE", errors });
  }
  return {
    source,
    receipt,
    refs: [{ kind: AGENT4_SKILL_PATTERN_ANALYSIS_REF_KIND, id: record.resultHash }, {
      kind: LEAD_SKILL_OWNER_ADJUDICATION_REF_KIND,
      id: receipt.id,
    }],
    ownerAction: { kind: receipt.selectedAction, targetRef: receipt.selectedTarget.targetRef },
  };
}

function workflowDemandValidationInputs(source) {
  const signals = source?.repositoryEvidence?.learningCaptureDiagnostics?.signals ?? {};
  return {
    taskEpisodes: source?.taskEpisodes ?? [],
    currentEpisodeId: source?.sessionEvents?.currentEpisodeRef,
    reusableSkillEvidence: source?.repositoryEvidence?.learningCaptureEvidence?.reusableSkillEvidence,
    skillActivity: {
      observedSkills: signals.observedSkills ?? [],
      unscopedObservedSkills: signals.unscopedObservedSkills ?? [],
      apparentSkillReads: signals.apparentSkillReads ?? [],
    },
  };
}

function currentWorkflowDemandFindingBindingErrors(source) {
  const currentById = new Map(rows(source?.repositoryEvidence?.workflowDemandDiagnostics?.currentHandoffs)
    .map((lead) => [String(lead?.id ?? ""), lead]));
  if (currentById.size === 0) return [];
  const errors = [];
  for (const finding of rows(source?.repositoryEvidence?.findings)) {
    const findingId = String(finding?.id ?? "").trim() || "(unknown)";
    for (const reference of rows(finding?.staticEvidence).filter((row) => row?.kind === "workflow-demand")) {
      const lead = currentById.get(String(reference?.id ?? ""));
      if (!lead) continue;
      const dimensionId = String(lead?.primaryReview?.dimensionId ?? "");
      const checkId = String(lead?.primaryReview?.checkId ?? "");
      if (!rows(finding?.dimensionRefs).map(String).includes(dimensionId)) {
        errors.push(`report source repositoryEvidence.findings[${findingId}] current workflow-demand ref requires dimensionRefs to include ${dimensionId}`);
      }
      if (!rows(finding?.subdimensionRefs).map(String).includes(checkId)) {
        errors.push(`report source repositoryEvidence.findings[${findingId}] current workflow-demand ref requires subdimensionRefs to include ${checkId}`);
      }
      if (SKILL_RECEIPT_ACTIONS.has(finding?.ownerAction?.kind)
        && !skillReceiptBinding(source, finding)) {
        errors.push(`report source repositoryEvidence.findings[${findingId}] Skill owner action requires an exact Agent 4 receipt and lead adjudication binding; owner-review is not approval`);
      }
    }
  }
  return errors;
}

function skillCreationDecisionErrors(source) {
  const review = repositoryReviewDecision(source);
  return rows(source?.repositoryEvidence?.findings).flatMap((finding) => {
    if (!SKILL_RECEIPT_ACTIONS.has(finding?.ownerAction?.kind)) return [];
    const findingId = String(finding?.id ?? "").trim() || "(unknown)";
    const errors = [];
    const workflowRefs = rows(finding?.staticEvidence)
      .filter((reference) => reference?.kind === "workflow-demand");
    if (workflowRefs.length !== 1) {
      errors.push(`report source repositoryEvidence.findings[${findingId}] Skill owner action requires exactly one workflow-demand ref`);
    }
    if (!skillReceiptBinding(source, finding)) {
      errors.push(`report source repositoryEvidence.findings[${findingId}] Skill owner action requires independent Agent 4 analysis and lead adjudication refs`);
    }
    if (review?.status !== "reviewed") {
      errors.push(`report source repositoryEvidence.findings[${findingId}] Skill owner action requires reviewed lead adjudication`);
    }
    return errors;
  });
}

function proposesLearningCaptureSkillCreation(finding) {
  const dimensions = new Set(rows(finding?.dimensionRefs).map(String));
  const subdimensions = new Set(rows(finding?.subdimensionRefs).map(String));
  const claimsLearningCapture = dimensions.has("learning-capture")
    || subdimensions.has("lifecycle-repeat-detection")
    || subdimensions.has("loop-engineering");
  if (!claimsLearningCapture) return false;
  return SKILL_RECEIPT_ACTIONS.has(finding?.ownerAction?.kind);
}

function learningCaptureSkillCreationBindingErrors(source) {
  const suppliedFindings = rows(source?.repositoryEvidence?.findings);
  const requiredIds = new Set(suppliedFindings
    .filter((finding) => finding?.projectionPolicy === "required")
    .map((finding) => String(finding?.id ?? "")));
  const findings = suppliedFindings.filter((finding) => {
    const id = String(finding?.id ?? "");
    if (id === LEARNING_CAPTURE_INTERVENTION_FINDING_ID) return false;
    if (requiredIds.has(id) && finding?.projectionPolicy !== "required") return false;
    return proposesLearningCaptureSkillCreation(finding);
  });
  if (findings.length === 0) return [];
  const diagnostics = source?.repositoryEvidence?.workflowDemandDiagnostics;
  if (!diagnostics) {
    return findings.map((finding) => {
      const findingId = String(finding?.id ?? "").trim() || "(unknown)";
      return `report source repositoryEvidence.findings[${findingId}] Learning Capture Skill creation requires generated workflowDemandDiagnostics`;
    });
  }
  const repeatedById = new Map(rows(diagnostics.repeatedCandidates)
    .map((lead) => [String(lead?.id ?? ""), lead]));
  const currentIds = new Set(rows(diagnostics.currentHandoffs)
    .map((lead) => String(lead?.id ?? "")));
  const review = repositoryReviewDecision(source);
  const checks = learningCaptureReviewedChecks(source);
  const detection = checks.get("lifecycle-repeat-detection");
  const engineering = checks.get("loop-engineering");
  const errors = [];

  for (const finding of findings) {
    const findingId = String(finding?.id ?? "").trim() || "(unknown)";
    const prefix = `report source repositoryEvidence.findings[${findingId}]`;
    const refs = rows(finding?.staticEvidence)
      .filter((reference) => reference?.kind === "workflow-demand");
    if (refs.length !== 1) {
      errors.push(`${prefix} Learning Capture Skill creation requires exactly one repeated workflow-demand ref`);
      continue;
    }
    const reference = refs[0];
    const unsupportedFields = Object.keys(reference ?? {}).filter((field) => !["kind", "id"].includes(field));
    if (unsupportedFields.length > 0) {
      errors.push(`${prefix} workflow-demand ref must contain only kind and id`);
    }
    const leadId = String(reference?.id ?? "").trim();
    const lead = repeatedById.get(leadId);
    if (!lead) {
      errors.push(currentIds.has(leadId)
        ? `${prefix} cannot promote a current workflow handoff into Learning Capture Skill creation`
        : `${prefix} references an unknown repeated workflow-demand lead: ${leadId || "(missing)"}`);
      continue;
    }
    const sourceEpisodes = [...new Set(rows(lead.sourceEpisodes).map(String).filter(Boolean))];
    if (sourceEpisodes.length < 2) {
      errors.push(`${prefix} repeated workflow-demand lead must cite two distinct source episodes`);
    }
    const problemCandidate = supportedLearningLoopCandidate(source, sourceEpisodes);
    if (!problemCandidate) {
      errors.push(`${prefix} Learning Capture Skill creation requires repeated friction or a repeated successful procedure with result evidence across the workflow episodes`);
    }
    if (review?.status !== "reviewed") continue;
    const decisionRefs = skillReceiptBinding(source, finding);
    const ownerSelectionRefs = rows(engineering?.ownerSelectionEvidenceRefs);
    if (!decisionRefs
      || engineering?.candidateOwner !== "skill"
      || !ownerSelectionRefs.some((reference) => sameReference(reference, decisionRefs.analysis))
      || !ownerSelectionRefs.some((reference) => sameReference(reference, decisionRefs.adjudication))) {
      errors.push(`${prefix} requires lead-adjudicated Skill ownership backed by the same independent Agent 4 analysis and lead adjudication refs`);
    }
    if (detection?.state !== "Exercised") {
      errors.push(`${prefix} requires lifecycle-repeat-detection state Exercised`);
      continue;
    }
    if (!rows(engineering?.findingRefs).map(String).includes(findingId)) {
      errors.push(`${prefix} must be linked from loop-engineering.findingRefs`);
    }
  }
  return errors;
}

function findRawContent(value, location = "reportSource") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findRawContent(item, `${location}[${index}]`));
  }
  if (!isObject(value)) return [];
  const errors = [];
  for (const [key, child] of Object.entries(value)) {
    if (RAW_CONTENT_FIELD_RE.test(key) && typeof child === "string" && child.trim()) {
      errors.push(`${location}.${key} must not contain raw transcript or command content`);
    }
    errors.push(...findRawContent(child, `${location}.${key}`));
  }
  return errors;
}

function normalizeDeliveryEvidence(rows = []) {
  return rows.map((row) => ({
    id: String(row?.id ?? ""),
    episodeRef: row?.episodeRef ?? null,
    ...(row?.provider ? { provider: row.provider } : {}),
    ...(row?.kind ? { kind: row.kind } : {}),
    level: row?.level ?? "self-reported-completion",
    status: row?.status ?? "observed",
    ...(row?.revision ? { revision: String(row.revision) } : {}),
    ...(row?.summary ? { summary: String(row.summary) } : {}),
    evidenceRefs: Array.isArray(row?.evidenceRefs) ? row.evidenceRefs : [],
  }));
}

export function createHarnessReportSource({
  manifest,
  repositoryEvidence = {},
  sessionEvents = {},
  taskEpisodes = [],
  deliveryEvidence = [],
  semanticFacets = [],
  interventionLedger = [],
  evidenceRefs = [],
  assessmentDecisions = [],
} = {}) {
  const source = {
    schemaVersion: HARNESS_REPORT_SOURCE_SCHEMA_VERSION,
    kind: "harness-report-source",
    manifest: clone(manifest ?? {}),
    repositoryEvidence: clone(repositoryEvidence),
    sessionEvents: clone(sessionEvents),
    taskEpisodes: clone(taskEpisodes),
    deliveryEvidence: normalizeDeliveryEvidence(deliveryEvidence),
    semanticFacets: clone(semanticFacets),
    interventionLedger: clone(interventionLedger),
    evidenceRefs: clone(evidenceRefs),
    assessmentDecisions: clone(assessmentDecisions),
  };
  const errors = validateHarnessReportSource(source);
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join("; ")), { code: "INVALID_REPORT_SOURCE", errors });
  }
  return source;
}

export function validateHarnessReportSource(source) {
  if (!isObject(source)) return ["report source must be an object"];
  const errors = [];
  for (const key of Object.keys(source)) {
    if (!REPORT_SOURCE_FIELDS.includes(key)) errors.push(`report source has unsupported field: ${key}`);
  }
  for (const key of REPORT_SOURCE_FIELDS) {
    if (!(key in source)) errors.push(`report source missing ${key}`);
  }
  if (!Number.isInteger(source.schemaVersion) || source.schemaVersion < 1) {
    errors.push("report source schemaVersion must be positive integer metadata");
  }
  if (source.kind !== "harness-report-source") {
    errors.push("report source kind must be harness-report-source");
  }
  if (!isObject(source.manifest) || source.manifest.kind !== "session-observation-manifest") {
    errors.push("report source manifest must be a session-observation-manifest");
  }
  for (const key of ["taskEpisodes", "deliveryEvidence", "semanticFacets", "interventionLedger", "evidenceRefs", "assessmentDecisions"]) {
    if (!Array.isArray(source[key])) errors.push(`report source ${key} must be an array`);
  }
  errors.push(...validateSemanticFacets(source.semanticFacets ?? []));
  errors.push(...permissionSummaryErrors(source));
  errors.push(...validateInterventionLedger(source.interventionLedger ?? []));
  errors.push(...validateDiagnosticCoverageReviews(source.repositoryEvidence?.diagnosticCoverageReviews));
  if (source.repositoryEvidence?.learningCaptureReview !== undefined) {
    errors.push("report source repositoryEvidence.learningCaptureReview is retired");
  }
  errors.push(...validateLearningCaptureDiagnostics(source.repositoryEvidence?.learningCaptureDiagnostics));
  if (source.repositoryEvidence?.workflowDemandDiagnostics !== undefined) {
    errors.push(...validateWorkflowDemandDiagnostics(
      source.repositoryEvidence.workflowDemandDiagnostics,
      workflowDemandValidationInputs(source),
    )
      .map((error) => `report source repositoryEvidence.workflowDemandDiagnostics.${error}`));
  }
  errors.push(...workflowDemandSourceIntegrityErrors(source));
  errors.push(...skillPatternRecordRegistryErrors(source));
  errors.push(...skillOwnerAdjudicationRegistryErrors(source));
  errors.push(...skillOwnerAdjudicationUsageErrors(source));
  errors.push(...skillCreationDecisionErrors(source));
  errors.push(...currentWorkflowDemandFindingBindingErrors(source));
  errors.push(...learningCaptureSkillCreationBindingErrors(source));
  errors.push(...validateLearningCaptureEvidence(source.repositoryEvidence?.learningCaptureEvidence));
  errors.push(...validateCheckupReportEvidence(source.repositoryEvidence?.customizationCheckup));
  errors.push(...validateLearningCaptureReviewedChecks(source));
  errors.push(...sourceFindingIntegrityErrors(source));
  errors.push(...learningCaptureSourceIntegrityErrors(source));
  errors.push(...validateReaderOverview(source.repositoryEvidence?.readerOverview, source.repositoryEvidence?.locale));
  for (const row of source.deliveryEvidence ?? []) {
    if (!DELIVERY_EVIDENCE_LEVELS.includes(row?.level)) {
      errors.push(`delivery evidence ${row?.id ?? "(unknown)"} has unsupported level ${row?.level}`);
    }
    const provider = row?.provider ?? "manual";
    const kind = row?.kind ?? "validation";
    if (!DELIVERY_EVIDENCE_PROVIDERS.has(provider)) {
      errors.push(`delivery evidence ${row?.id ?? "(unknown)"} has unsupported provider ${row?.provider}`);
    }
    if (!DELIVERY_EVIDENCE_KINDS.has(kind)) {
      errors.push(`delivery evidence ${row?.id ?? "(unknown)"} has unsupported kind ${row?.kind}`);
    }
    if (row?.kind !== undefined && DELIVERY_LEVELS_BY_KIND.has(kind)
      && !DELIVERY_LEVELS_BY_KIND.get(kind).has(row?.level)) {
      errors.push(`delivery evidence ${row?.id ?? "(unknown)"} level ${row?.level} does not match kind ${kind}`);
    }
    if (!rows(source.taskEpisodes).some((episode) => episode?.id === row?.episodeRef)) {
      errors.push(`delivery evidence ${row?.id ?? "(unknown)"} must reference one retained task episode`);
    }
    if (["acceptance", "release", "deployment"].includes(kind)
      && !/^[a-f0-9]{40,64}$/u.test(String(row?.revision ?? ""))) {
      errors.push(`delivery evidence ${row?.id ?? "(unknown)"} ${kind} requires a full revision digest`);
    }
  }
  for (const episode of source.taskEpisodes ?? []) {
    if (Number(episode?.sessionCount ?? 1) > 1 && episode?.continuation !== "explicit") {
      errors.push(`task episode ${episode?.id ?? "(unknown)"} crosses sessions without explicit continuation`);
    }
    if (episode?.current !== undefined || episode?.isCurrent !== undefined) {
      errors.push(`task episode ${episode?.id ?? "(unknown)"} must use sessionEvents.currentEpisodeRef as the only current-episode owner`);
    }
  }
  const currentEpisodeRef = source?.sessionEvents?.currentEpisodeRef;
  if (currentEpisodeRef !== undefined) {
    if (typeof currentEpisodeRef !== "string" || !/^episode:[a-f0-9]{12,64}$/u.test(currentEpisodeRef)) {
      errors.push("report source sessionEvents.currentEpisodeRef must be a bounded privacy-safe episode id");
    } else if (!(source.taskEpisodes ?? []).some((episode) => episode?.id === currentEpisodeRef)) {
      errors.push("report source sessionEvents.currentEpisodeRef must reference one retained task episode");
    }
  }
  errors.push(...findRawContent(source));
  return errors;
}
