
export const storageModule = {
  id: "storage",
  requires: ["shared", "rpc", "services"],
  provides: ["storage-service"],
  publicEntrypoints: ["contract.ts"],
} as const;
