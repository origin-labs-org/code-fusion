const MEMORY_SCOPES = Object.freeze(["Project", "Global"]);

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

export function projectMemoryInventoryDetails(inventory, integrityReview) {
  const memories = inventory?.memories;
  if (memories?.included !== true) return undefined;

  const categories = rows(memories.categories);
  const scopeCounts = MEMORY_SCOPES
    .map((scope) => ({
      scope,
      count: categories
        .filter((category) => category?.scope === scope)
        .reduce((total, category) => total + nonNegativeInteger(category?.count), 0),
    }))
    .filter((row) => row.count > 0);
  const totalCount = scopeCounts.reduce((total, row) => total + row.count, 0);
  const diagnostics = integrityReview?.summary?.memories;
  const integrity = integrityReview?.status === "reviewed" && diagnostics
    ? {
        status: "reviewed",
        titleCount: nonNegativeInteger(diagnostics.titleCount),
        reviewedTitleCount: nonNegativeInteger(diagnostics.reviewedTitleCount),
        truncated: diagnostics.truncated === true,
        exactCollisionGroups: nonNegativeInteger(diagnostics.exactCollisionGroups),
        similarityCandidates: nonNegativeInteger(diagnostics.similarityCandidates),
      }
    : { status: "unavailable" };

  return {
    contentPolicy: "metadata-only",
    scanState: totalCount > 0 ? "scanned-present" : "scanned-empty",
    scopeCounts,
    integrity,
  };
}
