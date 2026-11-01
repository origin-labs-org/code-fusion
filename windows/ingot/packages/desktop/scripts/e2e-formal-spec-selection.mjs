export const SSH_FORMAL_SPEC_GLOB =
  "./test/e2e/conversation-session/conversation-session-ssh-remote*.test.ts";
export const MANUAL_REVIEW_SPEC_GLOB = "./test/e2e/**/manual-review/**/*.test.ts";

const REQUIRED_SSH_E2E_ENV = [
  "CF_E2E_SSH_HOST",
  "CF_E2E_SSH_USERNAME",
  "CF_E2E_SSH_PASSWORD",
];

export function hasRequiredSshE2EEnvironment(env) {
  return REQUIRED_SSH_E2E_ENV.every((name) => env[name]?.trim());
}

export function isSshFormalSpec(spec) {
  return spec
    .replaceAll("\\", "/")
    .includes("/conversation-session/conversation-session-ssh-remote");
}

export function resolveEnvironmentGatedFormalSpecExcludes({ env, targeted }) {
  return !targeted && !hasRequiredSshE2EEnvironment(env) ? [SSH_FORMAL_SPEC_GLOB] : [];
}
