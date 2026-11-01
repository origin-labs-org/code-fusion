import { copyFile, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  GitCheckpointConflict,
  GitCheckpointDiff,
  GitCheckpointMeta,
  GitCheckpointRestoreResult,
} from "@origin-ai/cf-shared";
import { getGitCheckpointIndexRootDir } from "../../paths.js";
import { toWorkspaceRelativeGitPath } from "../config.js";
import {
  createGitCommandProvider,
  type GitCommandProvider,
} from "../providers/gitCommandProvider.js";
import { createGitCliRepo, type GitCliRepo } from "./gitCliRepo.js";
import {
  buildAffectedRepoPaths,
  buildCheckpointEnv,
  getCheckpointRefName,
  getWorkspacePathspec,
  mergeCheckpointDiff,
  normalizeAffectedRepoPath,
  parseLsTree,
  parseNameStatus,
  parseNumstat,
  removeFileIfExists,
  toAbsolutePath,
} from "./gitCheckpointHelpers.js";
import { ensureGitCommandSucceeded } from "./gitCliHelpers.js";

interface GitCheckpointRepo {
  createCheckpoint(params: {
    workspacePath: string;
    checkpointId: string;
  }): Promise<GitCheckpointMeta>;
  diffCheckpoints(params: {
    workspacePath: string;
    from: GitCheckpointMeta;
    to: GitCheckpointMeta;
  }): Promise<GitCheckpointDiff>;
  restoreBetweenCheckpoints(params: {
    workspacePath: string;
    from: GitCheckpointMeta;
    to: GitCheckpointMeta;
    force?: boolean;
  }): Promise<GitCheckpointRestoreResult>;
  deleteCheckpoint(params: { workspacePath: string; checkpoint: GitCheckpointMeta }): Promise<void>;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export function createGitCheckpointRepo(options?: {
  commandProvider?: GitCommandProvider;
  gitRepo?: Pick<GitCliRepo, "resolveRepository">;
}): GitCheckpointRepo {
  const commandProvider = options?.commandProvider ?? createGitCommandProvider();
  const gitRepo = options?.gitRepo ?? createGitCliRepo({ commandProvider });

  async function ensureRepository(
    workspacePath: string,
  ): Promise<Awaited<ReturnType<typeof gitRepo.resolveRepository>>> {
    const resolution = await gitRepo.resolveRepository(workspacePath);
    if (!resolution.isGitAvailable) {
      throw new Error("Git binary is not available in the current environment.");
    }
    if (!resolution.isRepository) {
      throw new Error("Workspace is not inside a Git repository.");
    }
    return resolution;
  }

  async function computeCheckpointDiff(params: {
    workspacePath: string;
    from: GitCheckpointMeta;
    to: GitCheckpointMeta;
  }): Promise<GitCheckpointDiff> {
    const resolution = await ensureRepository(params.workspacePath);
    const pathspec = getWorkspacePathspec(resolution.workspaceInRepoPath);
    const [nameStatusResult, numstatResult] = await Promise.all([
      commandProvider.run({
        cwd: resolution.repoRoot,
        args: [
          "diff",
          "--name-status",
          "--find-renames",
          "-z",
          params.from.commitOid,
          params.to.commitOid,
          "--",
          pathspec,
        ],
      }),
      commandProvider.run({
        cwd: resolution.repoRoot,
        args: [
          "diff",
          "--numstat",
          "--find-renames",
          "-z",
          params.from.commitOid,
          params.to.commitOid,
          "--",
          pathspec,
        ],
      }),
    ]);
    ensureGitCommandSucceeded("git diff --name-status checkpoint", nameStatusResult);
    ensureGitCommandSucceeded("git diff --numstat checkpoint", numstatResult);

    return mergeCheckpointDiff({
      repoRoot: resolution.repoRoot,
      workspaceInRepoPath: resolution.workspaceInRepoPath,
      fromCheckpointId: params.from.checkpointId,
      toCheckpointId: params.to.checkpointId,
      nameStatusEntries: parseNameStatus(nameStatusResult.stdout),
      numstat: parseNumstat(numstatResult.stdout),
    });
  }

  async function collectWorkspaceConflicts(params: {
    repoRoot: string;
    workspaceInRepoPath: string;
    from: GitCheckpointMeta;
    affectedRepoPaths: string[];
  }): Promise<GitCheckpointConflict[]> {
    if (params.affectedRepoPaths.length === 0) {
      return [];
    }

    const treeResult = await commandProvider.run({
      cwd: params.repoRoot,
      args: ["ls-tree", "-r", "-z", params.from.commitOid, "--", ...params.affectedRepoPaths],
    });
    ensureGitCommandSucceeded("git ls-tree checkpoint paths", treeResult);
    const treeEntries = parseLsTree(treeResult.stdout);

    const conflicts: GitCheckpointConflict[] = [];
    for (const repoRelativePath of params.affectedRepoPaths) {
      const absolutePath = toAbsolutePath(params.repoRoot, repoRelativePath);
      const expectedEntry = treeEntries.get(repoRelativePath);

      if (!expectedEntry) {
        if (!(await pathExists(absolutePath))) {
          continue;
        }
        conflicts.push({
          path: absolutePath,
          repoRelativePath,
          workspaceRelativePath: toWorkspaceRelativeGitPath(
            repoRelativePath,
            params.workspaceInRepoPath,
          ),
          reason: "unexpected-file-in-worktree",
        });
        continue;
      }

      let stats: Awaited<ReturnType<typeof lstat>>;
      try {
        stats = await lstat(absolutePath);
      } catch {
        conflicts.push({
          path: absolutePath,
          repoRelativePath,
          workspaceRelativePath: toWorkspaceRelativeGitPath(
            repoRelativePath,
            params.workspaceInRepoPath,
          ),
          reason: "missing-in-worktree",
        });
        continue;
      }

      const expectsSymlink = expectedEntry.mode === "120000";
      if (stats.isDirectory() || (expectsSymlink && !stats.isSymbolicLink())) {
        conflicts.push({
          path: absolutePath,
          repoRelativePath,
          workspaceRelativePath: toWorkspaceRelativeGitPath(
            repoRelativePath,
            params.workspaceInRepoPath,
          ),
          reason: "type-mismatch",
        });
        continue;
      }

      const hashResult = await commandProvider.run({
        cwd: params.repoRoot,
        args: ["hash-object", "--no-filters", absolutePath],
      });
      ensureGitCommandSucceeded("git hash-object checkpoint verify", hashResult);
      if (hashResult.stdout.trim() === expectedEntry.objectId) {
        continue;
      }

      conflicts.push({
        path: absolutePath,
        repoRelativePath,
        workspaceRelativePath: toWorkspaceRelativeGitPath(
          repoRelativePath,
          params.workspaceInRepoPath,
        ),
        reason: "content-mismatch",
      });
    }

    const deduped = new Map<string, GitCheckpointConflict>();
    for (const conflict of conflicts) {
      deduped.set(conflict.repoRelativePath, conflict);
    }
    return [...deduped.values()];
  }

  return {
    
    async createCheckpoint(params) {
      const resolution = await ensureRepository(params.workspacePath);
      const refName = getCheckpointRefName(params.workspacePath, params.checkpointId);
      const tempIndexRootDir = getGitCheckpointIndexRootDir();
      await mkdir(tempIndexRootDir, { recursive: true });
      const tempIndexDir = await mkdtemp(resolve(tempIndexRootDir, "index-"));
      const tempIndexPath = resolve(tempIndexDir, "index");
      const env = buildCheckpointEnv(tempIndexPath);
      const pathspec = getWorkspacePathspec(resolution.workspaceInRepoPath);

      try {
        const indexPathResult = await commandProvider.run({
          cwd: resolution.repoRoot,
          args: ["rev-parse", "--git-path", "index"],
        });
        let primed = false;
        if (indexPathResult.exitCode === 0) {
          const indexRelPath = indexPathResult.stdout.trim();
          if (indexRelPath.length > 0) {
            const userIndexPath = resolve(resolution.repoRoot, indexRelPath);
            try {
              await copyFile(userIndexPath, tempIndexPath);
              primed = true;
            } catch {
            }
          }
        }
        if (!primed) {
          const readTreeResult = await commandProvider.run({
            cwd: resolution.repoRoot,
            args: ["read-tree", "HEAD"],
            env,
          });
          if (readTreeResult.exitCode === 0) {
            primed = true;
          }
        }

        const addResult = await commandProvider.run({
          cwd: resolution.repoRoot,
          args: ["add", "-A", "--", pathspec],
          env,
        });
        ensureGitCommandSucceeded("git add checkpoint", addResult);

        const treeResult = await commandProvider.run({
          cwd: resolution.repoRoot,
          args: ["write-tree"],
          env,
        });
        ensureGitCommandSucceeded("git write-tree checkpoint", treeResult);

        const commitResult = await commandProvider.run({
          cwd: resolution.repoRoot,
          args: [
            "commit-tree",
            treeResult.stdout.trim(),
            "-m",
            `cf checkpoint ${params.checkpointId}`,
          ],
          env,
        });
        ensureGitCommandSucceeded("git commit-tree checkpoint", commitResult);
        const commitOid = commitResult.stdout.trim();

        const updateRefResult = await commandProvider.run({
          cwd: resolution.repoRoot,
          args: ["update-ref", refName, commitOid],
        });
        ensureGitCommandSucceeded("git update-ref checkpoint", updateRefResult);

        return {
          checkpointId: params.checkpointId,
          workspacePath: params.workspacePath,
          repoRoot: resolution.repoRoot,
          workspaceInRepoPath: resolution.workspaceInRepoPath,
          createdAt: Date.now(),
          refName,
          commitOid,
          scope: "workspace",
        };
      } finally {
        await rm(tempIndexDir, { recursive: true, force: true });
      }
    },

    
    async diffCheckpoints(params) {
      return await computeCheckpointDiff(params);
    },

    
    async restoreBetweenCheckpoints(params) {
      const resolution = await ensureRepository(params.workspacePath);
      const diff = await computeCheckpointDiff({
        workspacePath: params.workspacePath,
        from: params.from,
        to: params.to,
      });
      const affectedRepoPaths = buildAffectedRepoPaths(diff.files).map((path) =>
        normalizeAffectedRepoPath(resolution.repoRoot, path),
      );

      if (affectedRepoPaths.length === 0) {
        return {
          success: true,
          restoredPaths: [],
        };
      }

      const conflicts = await collectWorkspaceConflicts({
        repoRoot: resolution.repoRoot,
        workspaceInRepoPath: resolution.workspaceInRepoPath,
        from: params.from,
        affectedRepoPaths,
      });
      if (conflicts.length > 0 && params.force !== true) {
        return {
          success: false,
          conflicts,
        };
      }

      const restoreRepoPaths = diff.files
        .filter((file) => file.kind !== "deleted")
        .map((file) => file.repoRelativePath);
      if (restoreRepoPaths.length > 0) {
        const restoreResult = await commandProvider.run({
          cwd: resolution.repoRoot,
          args: [
            "restore",
            `--source=${params.to.commitOid}`,
            "--worktree",
            "--",
            ...restoreRepoPaths,
          ],
        });
        ensureGitCommandSucceeded("git restore checkpoint", restoreResult);
      }

      const deleteAbsolutePaths = new Set<string>();
      for (const file of diff.files) {
        if (file.kind === "deleted") {
          deleteAbsolutePaths.add(file.path);
          continue;
        }
        if (file.kind === "renamed" && file.originalPath) {
          deleteAbsolutePaths.add(file.originalPath);
        }
      }
      for (const path of deleteAbsolutePaths) {
        await removeFileIfExists(path);
      }

      const verifyConflicts = await collectWorkspaceConflicts({
        repoRoot: resolution.repoRoot,
        workspaceInRepoPath: resolution.workspaceInRepoPath,
        from: params.to,
        affectedRepoPaths,
      });
      if (verifyConflicts.length > 0) {
        throw new Error("Checkpoint restore verification failed.");
      }

      return {
        success: true,
        restoredPaths: diff.files.map((file) => file.path),
      };
    },

    
    async deleteCheckpoint(params) {
      const resolution = await ensureRepository(params.workspacePath);
      const deleteRefResult = await commandProvider.run({
        cwd: resolution.repoRoot,
        args: ["update-ref", "-d", params.checkpoint.refName],
      });
      ensureGitCommandSucceeded("git update-ref -d checkpoint", deleteRefResult, [0, 1]);
    },
  };
}

export type { GitCheckpointRepo };
