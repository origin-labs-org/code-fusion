import type {
  AccountAccessIdentityInput,
  AccountRequestAuthInput,
  AccountRequestAuthMaterial,
  AccountRequestAuthResolver,
} from "./accountProviderRequestAuthService.js";
import type { CfAccountAccess, CfProviderAccountAccess } from "@origin-ai/cf-shared";

export interface IAccountRequestAuthService {
  resolveAccessCurrent(access: CfProviderAccountAccess): Promise<CfAccountAccess | null>;
  resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial>;
  assertCurrent(input: AccountAccessIdentityInput): Promise<void>;
}

export function createAccountRequestAuthService(
  resolver: AccountRequestAuthResolver,
): IAccountRequestAuthService {
  return {
    resolveAccessCurrent(access) {
      return resolver.resolveAccessCurrent(access);
    },
    resolveCurrent(input) {
      return resolver.resolveCurrent(input);
    },
    assertCurrent(input) {
      return resolver.assertCurrent(input);
    },
  };
}

export type {
  AccountRequestAuthInput,
  AccountAccessIdentityInput,
  AccountRequestAuthMaterial,
  AccountRequestAuthResolver,
} from "./accountProviderRequestAuthService.js";
