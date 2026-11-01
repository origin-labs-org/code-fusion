import { BIGMODEL_PROVIDER_ID } from "@origin-ai/cf-shared";

const ACTIVE_PROVIDER_KEY = "oauth:active_provider";
const CF_JWT_TOKEN_KEY = "cfjwttoken";

interface BigModelStartPlanCfJwtCredentialService {
  load(key: string): Promise<string | null>;
}

export async function resolveBigModelStartPlanCfJwt(params: {
  credentialService?: BigModelStartPlanCfJwtCredentialService;
  provider?: { readonly apiKey?: string | null } | null;
  trustCachedCfJwt?: boolean;
}): Promise<string> {
  const activeProvider = (await params.credentialService?.load(ACTIVE_PROVIDER_KEY))?.trim() || "";
  if (params.trustCachedCfJwt === true || activeProvider === BIGMODEL_PROVIDER_ID) {
    const credentialJwt = (await params.credentialService?.load(CF_JWT_TOKEN_KEY))?.trim() || "";
    if (credentialJwt) {
      return credentialJwt;
    }
  }

  return params.provider?.apiKey?.trim() || "";
}
