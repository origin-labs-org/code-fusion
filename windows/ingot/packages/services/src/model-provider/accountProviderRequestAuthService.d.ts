import type { RequestVerificationReason } from "@origin-ai/cf-shared";
import { type OAuthProviderId, type ProviderFamilyDomain, type ProjectAccessTokenMaterial, type CfAccountAccess, type CfProviderAccountAccess } from "@origin-ai/cf-shared";
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
export declare class AccountRequestCredentialUnavailableError extends Error {
    readonly providerId: string;
    constructor(providerId: string);
}
export interface AccountRequestAuthResolver {
    resolveAccessCurrent(access: CfProviderAccountAccess): Promise<CfAccountAccess | null>;
    resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial>;
    assertCurrent(input: AccountAccessIdentityInput): Promise<void>;
}
interface AccountProviderRequestAuthServiceOptions {
    resolveCurrentAccountAccess(access: CfProviderAccountAccess): Promise<CfAccountAccess | null>;
    loadOAuthTokenSet(providerId: OAuthProviderId): Promise<{
        accessToken?: string | null;
        cfJwtToken?: string | null;
    } | null>;
    loadIndividualPlanMaterial(providerId: string, family: ProviderFamilyDomain, rejectedProjectTokenFingerprint?: string): Promise<ProjectAccessTokenMaterial | null>;
    resolveTeamPlanMaterial(access: Extract<CfAccountAccess, {
        planKind: "team-coding-plan";
    }>, rejectedProjectTokenFingerprint?: string): Promise<ProjectAccessTokenMaterial | null>;
}
declare class AccountProviderRequestAuthService implements AccountRequestAuthResolver {
    #private;
    constructor(options: AccountProviderRequestAuthServiceOptions);
    resolveAccessCurrent(access: CfProviderAccountAccess): Promise<CfAccountAccess | null>;
    resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial>;
    assertCurrent(input: AccountAccessIdentityInput): Promise<void>;
}
export declare function createAccountProviderRequestAuthService(options: AccountProviderRequestAuthServiceOptions): AccountProviderRequestAuthService;
export {};
//# sourceMappingURL=accountProviderRequestAuthService.d.ts.map