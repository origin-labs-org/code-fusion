import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gitFileNames } from "./git-file-names.mjs";
import { readUpstreamSnapshot } from "./upstream-snapshot.mjs";

const exec = promisify(execFile);

async function requireMergedCommit(cwd, commit) {
  try {
    await exec("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd });
  } catch (cause) {
    let mergeHeads = [];
    try {
      const { stdout } = await exec("git", ["rev-parse", "--git-path", "MERGE_HEAD"], { cwd });
      mergeHeads = (await readFile(resolve(cwd, stdout.trim()), "utf8")).trim().split(/\s+/);
    } catch {
    }
    for (const mergeHead of mergeHeads) {
      try {
        await exec("git", ["merge-base", "--is-ancestor", commit, mergeHead], { cwd });
        return;
      } catch {
      }
    }
    throw new Error(`上游准入 commit 必须存在且已合入 HEAD orCurrent MERGE_HEAD：${commit}`, {
      cause,
    });
  }
}

const diffOptions = ["--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z"];

export async function pristineUpstreamFiles(cwd, admissions, snapshotPath = null) {
  if (snapshotPath) return (await readUpstreamSnapshot(cwd, snapshotPath)).accepted;
  const accepted = new Set();
  const tracked = new Set(await gitFileNames(cwd, ["ls-files", "-z"]));
  for (const { commit, previousHead } of admissions) {
    await Promise.all([requireMergedCommit(cwd, commit), requireMergedCommit(cwd, previousHead)]);
    const [files, workingDifference, stagedDifference] = await Promise.all([
      gitFileNames(cwd, ["ls-tree", "-r", "--name-only", "-z", commit, "--"]),
      gitFileNames(cwd, ["diff", ...diffOptions, commit, "--"]),
      gitFileNames(cwd, ["diff", "--cached", ...diffOptions, commit, "--"]),
    ]);
    const different = new Set([...workingDifference, ...stagedDifference]);
    for (const file of files) {
      if (tracked.has(file) && !different.has(file)) accepted.add(file);
    }
  }
  return accepted;
}

export async function applyUpstreamAdmission(
  cwd,
  { base, candidates, untracked, admissions, eligibleHistoryFiles, snapshotPath = null },
) {
  if (admissions.length === 0 && !snapshotPath) return candidates;
  const required = new Set(candidates);
  const introducedFiles = new Set();
  const accepted = new Set();
  const untrackedSet = new Set(untracked);
  let historical = new Set();
  const [workingChanges, stagedChanges, tracked] = await Promise.all([
    gitFileNames(cwd, ["diff", ...diffOptions, "--diff-filter=ACMRT", base, "--"]),
    gitFileNames(cwd, ["diff", "--cached", ...diffOptions, "--diff-filter=ACMRT", base, "--"]),
    gitFileNames(cwd, ["ls-files", "-z"]),
  ]);
  const changed = new Set([...workingChanges, ...stagedChanges]);
  const trackedSet = new Set(tracked);
  if (snapshotPath) {
    const snapshot = await readUpstreamSnapshot(cwd, snapshotPath);
    historical = snapshot.historical;
    for (const file of snapshot.introduced) {
      if (eligibleHistoryFiles && !eligibleHistoryFiles.has(file)) continue;
      if (!trackedSet.has(file) || untrackedSet.has(file)) continue;
      introducedFiles.add(file);
      if (changed.has(file)) required.add(file);
    }
    for (const file of snapshot.accepted) accepted.add(file);
  }
  for (const { commit, previousHead } of admissions) {
    await Promise.all([requireMergedCommit(cwd, commit), requireMergedCommit(cwd, previousHead)]);
    const [introduced, files, workingDifference, stagedDifference] = await Promise.all([
      gitFileNames(cwd, ["diff", ...diffOptions, "--diff-filter=A", previousHead, commit, "--"]),
      gitFileNames(cwd, ["ls-tree", "-r", "--name-only", "-z", commit, "--"]),
      gitFileNames(cwd, ["diff", ...diffOptions, commit, "--"]),
      gitFileNames(cwd, ["diff", "--cached", ...diffOptions, commit, "--"]),
    ]);
    const different = new Set([...workingDifference, ...stagedDifference]);
    for (const file of introduced) {
      if (eligibleHistoryFiles && !eligibleHistoryFiles.has(file)) continue;
      if (!trackedSet.has(file) || untrackedSet.has(file)) continue;
      introducedFiles.add(file);
      if (changed.has(file)) required.add(file);
    }
    for (const file of files) if (!different.has(file)) accepted.add(file);
  }
  return [...required].filter(
    (file) => !historical.has(file) && (!introducedFiles.has(file) || !accepted.has(file)),
  );
}
