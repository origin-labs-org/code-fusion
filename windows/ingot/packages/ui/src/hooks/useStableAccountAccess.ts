import { useRef } from "react";
import type { CfAccountAccess, CfProviderAccountAccess } from "@origin-ai/cf-shared";

type StableAccountAccess = CfProviderAccountAccess | CfAccountAccess;

export function useStableAccountAccess(
  accountAccess: StableAccountAccess | null | undefined,
): StableAccountAccess | undefined {
  const normalized = accountAccess ?? undefined;
  const key = JSON.stringify(accountAccess ?? null);
  const stable = useRef({ key, value: normalized });
  if (stable.current.key !== key) {
    stable.current = { key, value: normalized };
  }
  return stable.current.value;
}
