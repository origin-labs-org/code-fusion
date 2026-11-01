import type { VirtualProject } from "#src/project-storage/contract.js";

export function assertRemoteProjectRoots(
  ownerHostId: string | undefined,
  roots: readonly string[],
  previous?: VirtualProject,
): void {
  if (!ownerHostId || ownerHostId === "local") return;
  if (roots.length !== 1) throw new Error("project.remote-single-root-required");
  if (previous && (previous.roots.length !== 1 || previous.roots[0]?.rootPath !== roots[0]))
    throw new Error("project.remote-root-immutable");
}

export function assertRemoteTaskDirectories(
  ownerHostId: string | undefined,
  project: VirtualProject | null | undefined,
  workspacePath: string,
  additionalDirectories: readonly string[] = [],
): void {
  if (!ownerHostId || ownerHostId === "local") return;
  if (!project) throw new Error("project.remote-project-required");
  assertRemoteProjectRoots(
    ownerHostId,
    project.roots.map((root) => root.rootPath),
  );
  if (additionalDirectories.length) throw new Error("project.remote-single-root-required");
  if (project.roots[0]?.rootPath !== workspacePath) throw new Error("project.cwd-not-in-roots");
}
