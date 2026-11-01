function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unsupportedFields(value, allowed, location) {
  return Object.keys(value ?? {})
    .filter((field) => !allowed.includes(field))
    .map((field) => `${location} has unsupported field: ${field}`);
}

export function validateMemoryDetails(details, {
  memoryCount,
  prefix = "findings.json summary.aiAgentPractice.memoryDetails",
} = {}) {
  if (!isObject(details)) return [`${prefix} must be an object`];
  const errors = unsupportedFields(details, ["contentPolicy", "scanState", "scopeCounts", "integrity"], prefix);
  if (details.contentPolicy !== "metadata-only") errors.push(`${prefix}.contentPolicy must be metadata-only`);
  if (!["scanned-present", "scanned-empty", "not-scanned"].includes(details.scanState)) {
    errors.push(`${prefix}.scanState must be scanned-present, scanned-empty, or not-scanned`);
  }
  if (!Array.isArray(details.scopeCounts) || details.scopeCounts.length > 2) {
    errors.push(`${prefix}.scopeCounts must be an array with at most Project and Global rows`);
  }
  const seenScopes = new Set();
  let detailCount = 0;
  for (const [index, row] of (Array.isArray(details.scopeCounts) ? details.scopeCounts : []).entries()) {
    const rowPrefix = `${prefix}.scopeCounts[${index}]`;
    if (!isObject(row)) {
      errors.push(`${rowPrefix} must be an object`);
      continue;
    }
    errors.push(...unsupportedFields(row, ["scope", "count"], rowPrefix));
    if (!["Project", "Global"].includes(row.scope) || seenScopes.has(row.scope)) {
      errors.push(`${rowPrefix}.scope must be a unique Project or Global value`);
    }
    seenScopes.add(row.scope);
    if (!Number.isInteger(row.count) || row.count < 0) errors.push(`${rowPrefix}.count must be a non-negative integer`);
    else detailCount += row.count;
  }
  if (Number.isInteger(memoryCount) && detailCount !== memoryCount) {
    errors.push(`${prefix}.scopeCounts must add up to the Memories coverage count ${memoryCount}`);
  }
  if (details.scanState === "scanned-present" && detailCount === 0) {
    errors.push(`${prefix}.scanState scanned-present requires a positive scope count`);
  }
  if (["scanned-empty", "not-scanned"].includes(details.scanState) && detailCount !== 0) {
    errors.push(`${prefix}.scanState ${details.scanState} requires zero scope count`);
  }

  const integrity = details.integrity;
  const integrityPrefix = `${prefix}.integrity`;
  if (!isObject(integrity)) return [...errors, `${integrityPrefix} must be an object`];
  const numericFields = ["titleCount", "reviewedTitleCount", "exactCollisionGroups", "similarityCandidates"];
  errors.push(...unsupportedFields(integrity, ["status", ...numericFields, "truncated"], integrityPrefix));
  if (!["reviewed", "unavailable", "not-run"].includes(integrity.status)) {
    errors.push(`${integrityPrefix}.status must be reviewed, unavailable, or not-run`);
  }
  if (integrity.status === "reviewed") {
    for (const field of numericFields) {
      if (!Number.isInteger(integrity[field]) || integrity[field] < 0) {
        errors.push(`${integrityPrefix}.${field} must be a non-negative integer when reviewed`);
      }
    }
    if (typeof integrity.truncated !== "boolean") errors.push(`${integrityPrefix}.truncated must be boolean when reviewed`);
    if (Number.isInteger(integrity.titleCount) && Number.isInteger(integrity.reviewedTitleCount)
      && integrity.reviewedTitleCount > integrity.titleCount) {
      errors.push(`${integrityPrefix}.reviewedTitleCount must not exceed titleCount`);
    }
  } else if (Object.keys(integrity).some((field) => field !== "status")) {
    errors.push(`${integrityPrefix} must contain only status when integrity is not reviewed`);
  }
  return errors;
}

export function normalizeMemoryDetails(details, { memoryCount } = {}) {
  if (!isObject(details)) return undefined;
  const scopeCounts = [];
  const seenScopes = new Set();
  for (const row of Array.isArray(details.scopeCounts) ? details.scopeCounts : []) {
    const scope = String(row?.scope ?? "").trim();
    const count = Number(row?.count);
    if (!["Project", "Global"].includes(scope) || seenScopes.has(scope) || !Number.isInteger(count) || count < 0) continue;
    seenScopes.add(scope);
    scopeCounts.push({ scope, count });
  }
  const integritySource = details.integrity;
  const integrityStatus = String(integritySource?.status ?? "").trim();
  let integrity;
  if (["unavailable", "not-run"].includes(integrityStatus)) {
    integrity = { status: integrityStatus };
  } else if (integrityStatus === "reviewed") {
    const numericFields = ["titleCount", "reviewedTitleCount", "exactCollisionGroups", "similarityCandidates"];
    const values = Object.fromEntries(numericFields.map((field) => [field, Number(integritySource?.[field])]));
    if (numericFields.every((field) => Number.isInteger(values[field]) && values[field] >= 0)
      && values.reviewedTitleCount <= values.titleCount
      && typeof integritySource?.truncated === "boolean") {
      integrity = { status: "reviewed", ...values, truncated: integritySource.truncated };
    }
  }
  const detailCount = scopeCounts.reduce((total, row) => total + row.count, 0);
  const validScanState = ["scanned-present", "scanned-empty", "not-scanned"].includes(details.scanState);
  const scanMatchesCount = details.scanState === "scanned-present" ? detailCount > 0 : detailCount === 0;
  const countMatches = !Number.isInteger(memoryCount) || memoryCount === detailCount;
  if (details.contentPolicy !== "metadata-only" || !validScanState || !integrity || !scanMatchesCount || !countMatches) {
    return undefined;
  }
  return {
    contentPolicy: "metadata-only",
    scanState: details.scanState,
    scopeCounts,
    integrity,
  };
}
