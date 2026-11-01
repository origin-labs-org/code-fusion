import type { RequestVerificationReason } from "@origin-ai/cf-shared";
import { createHash } from "node:crypto";
import {
  BIGMODEL_PROVIDER_ID,
  type OAuthProviderId,
  type ProviderFamilyDomain,
  type ProjectAccessTokenMaterial,
  type CfAccountAccess,
  type CfProviderAccountAccess,
  ZAI_PROVIDER_ID,
} from "@origin-ai/cf-shared";

export interface AccountRequestAuthMaterial {
  
  apiKey?: string;
  apiKeyId?: string;
  headers?: Record<string, string>;
  accountScope?: string;
}

export interface AccountRequestAuthInput {
  providerId: string;
  modelId?: string;
  accountAccess: CfProviderAccountAccess | CfAccountAccess;
  expectedAccountScope?: string;
  rejectedProjectTokenFingerprint?: string;
  reason: RequestVerificationReason | "off-peak" | "usage";
}

export interface AccountAccessIdentityInput {
  providerId: string;
  accountAccess: CfProviderAccountAccess | CfAccountAccess;
}

export class AccountRequestCredentialUnavailableError extends Error {
  constructor(readonly providerId: string) {
    super(`Account request credential is unavailable: ${providerId}`);
    this.name = "AccountRequestCredentialUnavailableError";
  }
}

export interface AccountRequestAuthResolver {
  resolveAccessCurrent(access: CfProviderAccountAccess): Promise<CfAccountAccess | null>;
  resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial>;
  assertCurrent(input: AccountAccessIdentityInput): Promise<void>;
}

interface AccountProviderRequestAuthServiceOptions {
  resolveCurrentAccountAccess(
    access: CfProviderAccountAccess,
  ): Promise<CfAccountAccess | null>;
  loadOAuthTokenSet(providerId: OAuthProviderId): Promise<{
    accessToken?: string | null;
    cfJwtToken?: string | null;
  } | null>;
  loadIndividualPlanMaterial(
    providerId: string,
    family: ProviderFamilyDomain,
    rejectedProjectTokenFingerprint?: string,
  ): Promise<ProjectAccessTokenMaterial | null>;
  resolveTeamPlanMaterial(
    access: Extract<CfAccountAccess, { planKind: "team-coding-plan" }>,
    rejectedProjectTokenFingerprint?: string,
  ): Promise<ProjectAccessTokenMaterial | null>;
}

class AccountProviderRequestAuthService implements AccountRequestAuthResolver {
  readonly #options: AccountProviderRequestAuthServiceOptions;

  constructor(options: AccountProviderRequestAuthServiceOptions) {
    this.#options = options;
  }

  resolveAccessCurrent(access: CfProviderAccountAccess): Promise<CfAccountAccess | null> {
    return this.#options.resolveCurrentAccountAccess(access);
  }

  async resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial> {
    const providerId = input.providerId.trim();
    const access = await this.#resolveAccess(input.accountAccess);
    if (!access) throw new AccountRequestCredentialUnavailableError(providerId);

    if (access.planKind === "start-plan") {
      const tokenSet = await this.#options.loadOAuthTokenSet(resolveOAuthProviderId(access.family));
      return { apiKey: requireApiKey(tokenSet?.cfJwtToken, providerId) };
    }

    const scoped = input.reason !== "usage" || input.expectedAccountScope !== undefined;
    if (input.rejectedProjectTokenFingerprint && !input.expectedAccountScope)
      throw new Error("project_token_scope_invalidated");
    const accountScope = scoped ? await this.#scope(access) : undefined;
    if (input.expectedAccountScope !== undefined && input.expectedAccountScope !== accountScope)
      throw new Error("project_token_scope_invalidated");
    const material =
      access.planKind === "individual-coding-plan"
        ? await this.#options.loadIndividualPlanMaterial(
            providerId,
            access.family,
            input.rejectedProjectTokenFingerprint,
          )
        : await this.#options.resolveTeamPlanMaterial(
            access,
            input.rejectedProjectTokenFingerprint,
          );
    if (scoped) {
      const latest = await this.#resolveAccess(input.accountAccess);
      if (!latest || accountScope !== (await this.#scope(latest)))
        throw new Error("project_token_scope_invalidated");
    }
    return {
      apiKey: requireApiKey(material?.token, providerId),
      apiKeyId: material?.apiKeyId,
      ...(accountScope ? { accountScope } : {}),
    };
  }

  async #scope(access: CfAccountAccess): Promise<string> {
    const login = await this.#options.loadOAuthTokenSet(resolveOAuthProviderId(access.family));
    if (!login?.accessToken?.trim())
      throw new AccountRequestCredentialUnavailableError(access.family);
    return createHash("sha256")
      .update(
        JSON.stringify([
          access.family,
          access.planKind,
          access.planKind === "team-coding-plan"
            ? [access.organizationId, access.projectId, access.productId]
            : null,
          login.accessToken.trim(),
          login.cfJwtToken?.trim() ?? null,
        ]),
      )
      .digest("hex");
  }

  async assertCurrent(input: AccountAccessIdentityInput): Promise<void> {
    if (!(await this.#resolveAccess(input.accountAccess))) {
      throw new AccountRequestCredentialUnavailableError(input.providerId);
    }
  }

  #resolveAccess(
    access: CfProviderAccountAccess | CfAccountAccess,
  ): Promise<CfAccountAccess | null> {
    return "mode" in access
      ? this.#options.resolveCurrentAccountAccess(access)
      : Promise.resolve(access);
  }
}

function resolveOAuthProviderId(family: ProviderFamilyDomain): OAuthProviderId {
  return family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID;
}

function requireApiKey(value: string | null | undefined, providerId: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new AccountRequestCredentialUnavailableError(providerId);
  }
  return normalized;
}

export function createAccountProviderRequestAuthService(
  options: AccountProviderRequestAuthServiceOptions,
): AccountProviderRequestAuthService {
  return new AccountProviderRequestAuthService(options);
}
