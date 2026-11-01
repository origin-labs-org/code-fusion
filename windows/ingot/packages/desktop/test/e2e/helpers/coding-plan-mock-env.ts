export const CODING_PLAN_TEAM_MOCK_BASE_URL_ENV = "CF_CODING_PLAN_TEAM_MOCK_BASE_URL";
export const CODING_PLAN_UPGRADE_MOCK_BASE_URL_ENV = "CF_CODING_PLAN_UPGRADE_MOCK_BASE_URL";

type MutableEnvironment = Record<string, string | undefined>;

const CODING_PLAN_COMMON_ENV_KEYS = [
  "CF_BASE_URL",
  "CF_ENDPOINT_ORIGIN",
  "CF_TEST_BASE_URL",
  "BIGMODEL_API_BASE_URL",
  "CF_E2E_CODING_PLAN_MOCK_URL",
] as const;

const CODING_PLAN_TEAM_SUITE_GLOBS = [
  "test/e2e/**/*.test.ts",
  "test/e2e/conversation-session/*.test.ts",
];
const CODING_PLAN_TEAM_SPEC_MARKERS = [
  "conversation-session-toolsearch",
  "conversation-session-tool-discovery-card.test.ts",
  "conversation-session-rpn-project-navigation.test.ts",
  "conversation-session-ssh-disconnect-experience.test.ts",
  "conversation-session-ssh-remote-cold-reconnect.test.ts",
  "conversation-session-r3-mixed-entries.test.ts",
  "conversation-session-r3-mobile.test.ts",
  "settings-ui-polish.test.ts",
  "side-pane-tabs-responsive-interactions.test.ts",
  "conversation-session-share-tool-presentation.test.ts",
  "conversation-session-share-popover.test.ts",
  "conversation-session-start-plan-independent.test.ts",
  "conversation-session-create-telemetry.test.ts",
  "conversation-session-automation-run-title-stable.test.ts",
  "coding-plan-team-usage.test.ts",
  "coding-plan-entitlement-presentation.test.ts",
  "provider-family-responsive.test.ts",
  "provider-builtin-refresh-failure.test.ts",
  "subagent-coding-plan-login-catalog-stale.test.ts",
  "conversation-session-model-provider-restart-recovery.test.ts",
  "conversation-session-model-provider-settings-transition.test.ts",
  "conversation-session-model-provider-effective-selection.test.ts",
  "conversation-session-worker-effective-selection.test.ts",
  "conversation-session-model-provider-turbo-recovery.test.ts",
  "conversation-session-model-provider-turbo-switch.test.ts",
  "conversation-session-highspeed-card.test.ts",
  "conversation-session-highspeed-card-draw-timeout.test.ts",
  "conversation-session-highspeed-card-draw-miss.test.ts",
  "conversation-session-highspeed-card-fallback-unlocks-model.test.ts",
  "conversation-session-highspeed-card-admission-retains-draft.test.ts",
  "conversation-session-highspeed-queue-edit.test.ts",
  "conversation-session-model-provider-plan-surface.test.ts",
  "conversation-session-active-model-context.test.ts",
  "conversation-session-off-peak-team-plan.test.ts",
  "conversation-session-offpeak-create.test.ts",
  "conversation-session-offpeak-create-existing-session.test.ts",
  "conversation-session-offpeak-subagent-model-inheritance.test.ts",
  "conversation-session-off-peak-invalid-ticket.test.ts",
  "off-peak-create-manage.test.ts",
  "off-peak-automations-home-layout.test.ts",
  "off-peak-limit-pre-gate.test.ts",
] as const;

export function shouldPrepareCodingPlanTeamMock(specs: readonly string[]) {
  return specs.some((spec) => {
    const normalized = spec.replaceAll("\\", "/").replace(/^\.\//u, "");
    return (
      CODING_PLAN_TEAM_SUITE_GLOBS.includes(normalized) ||
      CODING_PLAN_TEAM_SPEC_MARKERS.some((marker) => normalized.includes(marker))
    );
  });
}

export function applyCodingPlanTeamMockEnv(environment: MutableEnvironment, baseUrl: string) {
  environment[CODING_PLAN_TEAM_MOCK_BASE_URL_ENV] = baseUrl;
  environment.CF_ENV = "test";
  for (const key of CODING_PLAN_COMMON_ENV_KEYS) {
    environment[key] = baseUrl;
  }
  environment.CF_BIGMODEL_USAGE_QUOTA_URL = `${baseUrl}/api/monitor/usage/quota/limit`;
  environment.BIGMODEL_USAGE_QUOTA_URL = `${baseUrl}/api/monitor/usage/quota/limit`;
}

export function clearCodingPlanTeamMockEnv(environment: MutableEnvironment, baseUrl: string) {
  clearOwnedEnvironmentValues(environment, baseUrl, [
    ...CODING_PLAN_COMMON_ENV_KEYS,
    "CF_BIGMODEL_USAGE_QUOTA_URL",
    "BIGMODEL_USAGE_QUOTA_URL",
  ]);
  if (environment[CODING_PLAN_TEAM_MOCK_BASE_URL_ENV] === baseUrl) {
    delete environment[CODING_PLAN_TEAM_MOCK_BASE_URL_ENV];
  }
}

export function applyCodingPlanUpgradeMockEnv(environment: MutableEnvironment, baseUrl: string) {
  environment[CODING_PLAN_UPGRADE_MOCK_BASE_URL_ENV] = baseUrl;
  for (const key of CODING_PLAN_COMMON_ENV_KEYS) {
    environment[key] = baseUrl;
  }
  environment.BIGMODEL_TEST_API_BASE_URL = baseUrl;
  environment.VITE_CODING_PLAN_WEBVIEW_ORIGIN = baseUrl;
  environment.ZAI_BUSINESS_BASE_URL = baseUrl;
}

export function shouldReuseDesktopE2EBuild(environment: MutableEnvironment): boolean {
  return (
    environment.CF_E2E_SKIP_BUILD === "1" &&
    !environment[CODING_PLAN_UPGRADE_MOCK_BASE_URL_ENV]?.trim()
  );
}

export function clearCodingPlanUpgradeMockEnv(environment: MutableEnvironment, baseUrl: string) {
  clearOwnedEnvironmentValues(environment, baseUrl, [
    ...CODING_PLAN_COMMON_ENV_KEYS,
    "BIGMODEL_TEST_API_BASE_URL",
    "VITE_CODING_PLAN_WEBVIEW_ORIGIN",
    "ZAI_BUSINESS_BASE_URL",
  ]);
  if (environment[CODING_PLAN_UPGRADE_MOCK_BASE_URL_ENV] === baseUrl) {
    delete environment[CODING_PLAN_UPGRADE_MOCK_BASE_URL_ENV];
  }
}

function clearOwnedEnvironmentValues(
  environment: MutableEnvironment,
  baseUrl: string,
  keys: readonly string[],
) {
  const ownedValues = new Set([baseUrl, `${baseUrl}/api/monitor/usage/quota/limit`]);
  for (const key of keys) {
    if (ownedValues.has(environment[key] ?? "")) {
      delete environment[key];
    }
  }
}
