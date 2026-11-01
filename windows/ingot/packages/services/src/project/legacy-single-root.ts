import type { AppSettings, FileEntry, SystemInfo, CfTaskMeta } from "@origin-ai/cf-shared";
import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";
import { remoteHostIdFromWorkspaceIdentity } from "@origin-ai/cf-shared";
import type { IProjectService, VirtualProject, ProjectTask } from "#src/project/contract.js";
import { LEGACY_SINGLE_ROOT_PROJECT_PREFIX } from "#src/project/contract.js";

interface LegacyProjectReadPort {
  directories: {
    info(): Promise<SystemInfo>;
    read(input: { path: string; includeHidden?: boolean }): Promise<FileEntry[]>;
  };
  readSettings(): Promise<Pick<AppSettings, "lastWorkspaceSession" | "recentProjects">>;
  readTasks(input: {
    workspacePath: string;
    kind: "active" | "pinned" | "archived";
  }): Promise<CfTaskMeta[]>;
  ensureConversation(): Promise<string>;
  readKnownWorkspaces?(): Promise<
    readonly { workspacePath: string; workspacePurpose?: "project" | "conversation" }[]
  >;
}

export function createLegacySingleRootProjectService(
  options: LegacyProjectReadPort & { hostId: string },
): IProjectService {
  const verifyHost = (hostId?: string) => {
    if (hostId && hostId !== options.hostId) throw new Error("project.cross-host-move");
  };
  const readOnly = async (): Promise<never> => {
    throw new Error("project.legacy-read-only");
  };
  const catalog = async () => {
    const [settings, info] = await Promise.all([
      options.readSettings(),
      options.directories.info(),
    ]);
    const pathRules = info.platform === "win32" ? win32 : posix;
    const local = (settings.lastWorkspaceSession ?? []).filter((entry) => entry.kind === "local");
    const known = [...local, ...((await options.readKnownWorkspaces?.()) ?? [])];
    const conversations = new Set(
      known
        .filter((entry) => entry.workspacePurpose === "conversation")
        .map((entry) => entry.workspacePath),
    );
    const paths = [
      ...new Set([
        ...known.map((entry) => entry.workspacePath),
        ...(settings.recentProjects ?? []),
      ]),
    ];
    const projects: VirtualProject[] = paths
      .filter((path) => !conversations.has(path))
      .map((rootPath, position) => ({
        id:
          LEGACY_SINGLE_ROOT_PROJECT_PREFIX +
          createHash("sha256")
            .update(JSON.stringify([options.hostId, rootPath]))
            .digest("hex"),
        hostId: options.hostId,
        legacySingleRoot: true,
        directoryMatchPath: pathRules.normalize(rootPath),
        name: rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? rootPath,
        nameOverridden: false,
        roots: [{ rootPath, isPrimary: true, position: 0 }],
        position,
        pinned: false,
        deleted: false,
        createdAt: 0,
        updatedAt: 0,
      }));
    return { paths, projects };
  };
  const service: IProjectService = {
    async readDirectory(params) {
      verifyHost(params?.hostId);
      const info = await options.directories.info();
      const paths = info.platform === "win32" ? win32 : posix;
      const requested = params?.path?.trim() || info.homedir;
      if (!paths.isAbsolute(requested)) throw new Error("project.absolute-path-required");
      const path = paths.normalize(requested);
      const entries = await options.directories.read({
        path,
        ...(params?.includeHidden === undefined ? {} : { includeHidden: params.includeHidden }),
      });
      return { path, entries };
    },
    async readProjects(params) {
      verifyHost(params?.hostId);
      return (await catalog()).projects;
    },
    async readTree(params) {
      verifyHost(params?.hostId);
      const { paths, projects } = await catalog();
      const rows = await Promise.all(
        paths.map(async (workspacePath) => {
          const scope = { workspacePath };
          const [active, pinned, archived] = await Promise.all([
            options.readTasks({ ...scope, kind: "active" }),
            options.readTasks({ ...scope, kind: "pinned" }),
            options.readTasks({ ...scope, kind: "archived" }),
          ]);
          const projectId =
            projects.find((project) => project.roots[0]?.rootPath === workspacePath)?.id ?? null;
          return [
            ...active.map((task) => ({ ...task, pinned: false, archived: false })),
            ...pinned.map((task) => ({ ...task, pinned: true, archived: false })),
            ...archived.map((task) => ({ ...task, pinned: false, archived: true })),
          ].map((task): ProjectTask => ({ ...task, hostId: options.hostId, projectId }));
        }),
      );
      const tasks = [
        ...new Map(
          rows
            .flat()
            .map((task) => [
              JSON.stringify([task.workspaceIdentity?.trim() || task.workspacePath, task.taskId]),
              task,
            ]),
        ).values(),
      ];
      return { projects, tasks, legacySingleRoot: true };
    },
    async prepareSession(params) {
      verifyHost(params?.hostId);
      if (!params?.projectId)
        return {
          workspacePath: await options.ensureConversation(),
          projectId: null,
          additionalDirectories: [],
        };
      const project = (await catalog()).projects.find((item) => item.id === params.projectId);
      if (!project) throw new Error("project.not-found");
      return {
        workspacePath: project.roots[0]!.rootPath,
        projectId: project.id,
        additionalDirectories: [],
      };
    },
    async resolveSessionDirectories(task, hostId) {
      verifyHost(hostId);
      if (task.workspaceIdentity)
        verifyHost(remoteHostIdFromWorkspaceIdentity(task.workspaceIdentity) ?? undefined);
      const project = (await catalog()).projects.find(
        (item) => item.roots[0]?.rootPath === task.workspacePath,
      );
      return {
        workspacePath: task.workspacePath,
        projectId: project?.id ?? null,
        additionalDirectories: [],
      };
    },
    saveProject: readOnly,
    deleteProject: readOnly,
    moveTask: readOnly,
    reorderProjects: readOnly,
  };
  return service;
}
