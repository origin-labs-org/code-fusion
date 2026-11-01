import type { SessionConfigState, SessionModelTransition } from "@origin-ai/cf-shared/cf-protocol-v4";

export interface ModelConfigProjectionObservation {
  sessionId: string;
  config: Pick<SessionConfigState, "provider" | "model" | "thought">;
}

export function isOnlineModelFallbackAuthoritative(params: {
  targetSessionId: string | null;
  current: ModelConfigProjectionObservation | null;
  transition: SessionModelTransition;
  hasPendingExplicitIntent: boolean;
}): boolean {
  const { targetSessionId, current, transition, hasPendingExplicitIntent } = params;
  if (
    hasPendingExplicitIntent ||
    !targetSessionId ||
    !current ||
    current.sessionId !== targetSessionId ||
    !current.config.provider ||
    !current.config.model ||
    current.config.provider !== transition.to.provider ||
    current.config.model !== transition.to.model
  ) {
    return false;
  }
  return !(
    transition.from.provider === current.config.provider &&
    transition.from.model === current.config.model
  );
}
