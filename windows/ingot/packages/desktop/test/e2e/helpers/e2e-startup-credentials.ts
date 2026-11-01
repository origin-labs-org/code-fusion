import { isRequestSecuritySpec } from "./request-security-edition/index.js";
export interface E2EStartupCredentialSeedOptions {
  specs?: string[];
  remoteProfile?: boolean;
  accountMock?: boolean;
  legacyAuthToken: string;
  restoredOAuthCredentials: Record<string, string>;
}

export function createE2EStartupCredentialSeed(
  options: E2EStartupCredentialSeedOptions,
): Record<string, string> {
  if (options.remoteProfile) return {};
  const requiresCfJwt = options.specs?.some((spec) => {
    const fileName = spec.replaceAll("\\", "/").split("/").at(-1);
    return (
      fileName?.startsWith("marketing-touch-delivery") ||
      fileName === "conversation-session-share-popover.test.ts" ||
      fileName === "marketing-touch-entitlement.test.ts" ||
      fileName === "marketing-touch-rewards.test.ts" ||
      fileName === "jwt-401-auto-logout.test.ts" ||
      isRequestSecuritySpec(fileName) ||
      fileName === "coding-plan-upgrade-webview-refresh-provider.test.ts" ||
      fileName === "start-plan-manual-claim-experience.test.ts" ||
      fileName === "provider-family-responsive.test.ts" ||
      fileName === "conversation-session-offpeak-subagent-model-inheritance.test.ts" ||
      fileName === "conversation-session-off-peak-invalid-ticket.test.ts"
    );
  });
  if (!options.accountMock && !requiresCfJwt) return {};
  const restoredOAuthCredentials = { ...options.restoredOAuthCredentials };
  if (!requiresCfJwt) delete restoredOAuthCredentials.cfjwttoken;
  return {
    auth_token: options.legacyAuthToken,
    ...restoredOAuthCredentials,
  };
}
