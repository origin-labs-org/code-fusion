export interface E2ETestBridgeEnvironment {
  VITE_CF_E2E_STORE_BRIDGE?: string;
  CF_E2E_RUN_ID?: string;
}

export function shouldEnableE2ETestBridge(env: E2ETestBridgeEnvironment): boolean {
  return env.VITE_CF_E2E_STORE_BRIDGE === "1" && Boolean(env.CF_E2E_RUN_ID?.trim());
}
