import type { HighspeedMockScenario } from "@origin-ai/cf-shared";

export const HIGHSPEED_MOCK_SCENARIO_ENV = "CF_HIGHSPEED_MOCK_SCENARIO";

const HIGHSPEED_E2E_SPEC_SCENARIOS: ReadonlyArray<readonly [string, HighspeedMockScenario]> = [
  ["conversation-session-highspeed-card.test.ts", "hit-fast"],
  ["conversation-session-highspeed-card-draw-timeout.test.ts", "hit-after-timeout"],
  ["conversation-session-highspeed-card-draw-miss.test.ts", "miss"],
  ["conversation-session-highspeed-card-fallback-unlocks-model.test.ts", "hit-invalid-model"],
  ["conversation-session-highspeed-card-admission-retains-draft.test.ts", "hit-invalid-model"],
  ["conversation-session-highspeed-queue-edit.test.ts", "hit-queue-edit"],
];

export function resolveHighspeedE2EMockScenario(
  specs: readonly string[],
): HighspeedMockScenario | null {
  for (const spec of specs) {
    const normalized = spec.replaceAll("\\", "/");
    const matched = HIGHSPEED_E2E_SPEC_SCENARIOS.find(([marker]) => normalized.includes(marker));
    if (matched) return matched[1];
  }
  return null;
}
