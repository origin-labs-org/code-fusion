import type { CfEnv } from "@origin-ai/cf-shared";

export function shouldShowRemoteConnectionEntry(params: {
  env: CfEnv;
  isIntranet: boolean;
}): boolean {
  void params;
  return true;
}

export function useRemoteConnectionEntryVisibility(): boolean {
  return true;
}
