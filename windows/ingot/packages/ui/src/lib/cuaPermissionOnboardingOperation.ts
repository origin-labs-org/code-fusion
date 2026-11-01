let fallbackSequence = 0;

export function createCuaPermissionOnboardingOperationId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    return `cua-onboarding-${randomId}`;
  }
  fallbackSequence += 1;
  return `cua-onboarding-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
}
