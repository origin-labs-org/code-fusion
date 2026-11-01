import { createHash } from "node:crypto";
import { BIGMODEL_PROVIDER_ID, ZAI_PROVIDER_ID, } from "@origin-ai/cf-shared";
export class AccountRequestCredentialUnavailableError extends Error {
    providerId;
    constructor(providerId) {
        super(`Account request credential is unavailable: ${providerId}`);
        this.providerId = providerId;
        this.name = "AccountRequestCredentialUnavailableError";
    }
}
class AccountProviderRequestAuthService {
    #options;
    constructor(options) {
        this.#options = options;
    }
    resolveAccessCurrent(access) {
        return this.#options.resolveCurrentAccountAccess(access);
    }
    async resolveCurrent(input) {
        const providerId = input.providerId.trim();
        const access = await this.#resolveAccess(input.accountAccess);
        if (!access)
            throw new AccountRequestCredentialUnavailableError(providerId);
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
        const material = access.planKind === "individual-coding-plan"
            ? await this.#options.loadIndividualPlanMaterial(providerId, access.family, input.rejectedProjectTokenFingerprint)
            : await this.#options.resolveTeamPlanMaterial(access, input.rejectedProjectTokenFingerprint);
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
    async #scope(access) {
        const login = await this.#options.loadOAuthTokenSet(resolveOAuthProviderId(access.family));
        if (!login?.accessToken?.trim())
            throw new AccountRequestCredentialUnavailableError(access.family);
        return createHash("sha256")
            .update(JSON.stringify([
            access.family,
            access.planKind,
            access.planKind === "team-coding-plan"
                ? [access.organizationId, access.projectId, access.productId]
                : null,
            login.accessToken.trim(),
            login.cfJwtToken?.trim() ?? null,
        ]))
            .digest("hex");
    }
    async assertCurrent(input) {
        if (!(await this.#resolveAccess(input.accountAccess))) {
            throw new AccountRequestCredentialUnavailableError(input.providerId);
        }
    }
    #resolveAccess(access) {
        return "mode" in access
            ? this.#options.resolveCurrentAccountAccess(access)
            : Promise.resolve(access);
    }
}
function resolveOAuthProviderId(family) {
    return family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID;
}
function requireApiKey(value, providerId) {
    const normalized = value?.trim() ?? "";
    if (!normalized) {
        throw new AccountRequestCredentialUnavailableError(providerId);
    }
    return normalized;
}
export function createAccountProviderRequestAuthService(options) {
    return new AccountProviderRequestAuthService(options);
}
//# sourceMappingURL=accountProviderRequestAuthService.js.map