// ============================================================
// ============================================================
//
//

export function qualityEpilogue(schema: unknown): string {
  const fields = topLevelSchemaProperties(schema);
  return [
    "",
    "",
    "---",
    "Standard for this result:",
    "- Every finding cites what you read or ran: path and line for code; the exact command and its output for a check; the part of the ask for material the ask itself gave you.",
    "- A check counts as passed only if you ran it during this ask. Otherwise report it as not run.",
    "- Run the check the ask names, at the scale it names. A narrower or faster substitute — one test file for the suite, a build for the tests — is reported as what it is, never as the ask's check; say the exact command you ran.",
    "- Anything you could not do, verify, or find is stated as such — never filled with a plausible guess.",
    ...(fields.has("evidence") ? ["- Put each finding's citation in its `evidence` field."] : []),
    ...(fields.has("confidence")
      ? ["- Rate `confidence` honestly; a low value with a reason beats a confident guess."]
      : []),
    "- If you are blocked by something outside your reach, call `escalate` instead of inventing a value.",
  ].join("\n");
}

function topLevelSchemaProperties(schema: unknown): Set<string> {
  if (typeof schema !== "object" || schema === null) return new Set();
  const properties = (schema as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return new Set();
  return new Set(Object.keys(properties as Record<string, unknown>));
}
