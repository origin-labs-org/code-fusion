import type { AccountAccessIdentityInput, AccountRequestAuthInput, AccountRequestAuthMaterial, AccountRequestAuthResolver } from "./accountProviderRequestAuthService.js";
import type { CfAccountAccess, CfProviderAccountAccess } from "@origin-ai/cf-shared";
export interface IAccountRequestAuthService {
    resolveAccessCurrent(access: CfProviderAccountAccess): Promise<CfAccountAccess | null>;
    resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial>;
    assertCurrent(input: AccountAccessIdentityInput): Promise<void>;
}
export declare function createAccountRequestAuthService(resolver: AccountRequestAuthResolver): IAccountRequestAuthService;
export type { AccountRequestAuthInput, AccountAccessIdentityInput, AccountRequestAuthMaterial, AccountRequestAuthResolver, } from "./accountProviderRequestAuthService.js";
//# sourceMappingURL=accountRequestAuthService.d.ts.map