
export const remoteConnectionFlowModule = {
  id: "remote-connection-flow",
  requires: ["shared", "ui"],
  provides: ["remote-connection-flow"],
  publicEntrypoints: ["index.ts", "contract.ts", "ui/RemoteConnectionProgress.tsx"],
} as const;
