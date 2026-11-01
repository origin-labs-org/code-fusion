
export const remoteProjectsModule = {
  id: "remote-projects",
  requires: ["services", "shared", "project-storage"],
  provides: ["remote-projects"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
