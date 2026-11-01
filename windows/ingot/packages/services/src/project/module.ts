
export const projectModule = {
  id: "project",
  requires: ["project-storage", "services", "shared"],
  provides: ["project"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
