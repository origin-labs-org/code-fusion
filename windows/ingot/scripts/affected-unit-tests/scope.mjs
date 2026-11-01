import { resolve } from "node:path";
import { git, run } from "./process.mjs";

async function commit(root, ref) {
  try {
    return (await git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]))
      .toString()
      .trim();
  } catch (error) {
    throw new Error(`无法解析基线orSubmit ${ref}：${error.message}`, { cause: error });
  }
}
async function isAncestor(root, ancestor, head) {
  const check = await run("git", ["merge-base", "--is-ancestor", ancestor, head], {
    allowFailure: true,
  });
  return check.code === 0;
}

async function resolvePushBase(root, head, remote) {
  if (await isAncestor(root, remote, head)) {
    return remote;
  }

  return (await git(root, ["merge-base", remote, head])).toString().trim();
}

async function firstPushBase(root, head) {
  const staging = await commit(root, "origin/staging");
  return (await git(root, ["merge-base", staging, head])).toString().trim();
}

export async function resolveScope(root, options = {}, env = process.env) {
  if (options.scope && !["worktree", "push"].includes(options.scope))
    throw new Error(`Unknown范围：${options.scope}`);
  const explicit = options.base ?? env.CF_AFFECTED_TEST_BASE ?? env.CF_PRE_PUSH_BASE;
  if (options.files && (options.scope === "push" || explicit))
    throw new Error("--files 不能与 push or --base 混用");
  if (options.files)
    return { files: [...new Set(options.files.map((file) => resolve(root, file)))], bases: [true] };
  if (options.scope !== "push") return { bases: [explicit ? await commit(root, explicit) : true] };

  if ((await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).length)
    throw new Error("Push Workspace不干净：请先Submitor自行Save已暂存、Unstaged及未跟踪改动");
  const head = await commit(root, "HEAD");
  const entries = (env.CF_PRE_PUSH_STDIN ?? "")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.split(/\s+/u));
  const bases = [];
  if (entries.length) {
    for (const entry of entries) {
      if (entry.length !== 4 || !/^[\da-f]+$/iu.test(entry[1]) || !/^[\da-f]+$/iu.test(entry[3]))
        throw new Error("推送 ref Input无效");
      if (/^0+$/u.test(entry[1])) continue;
      if ((await commit(root, entry[1])) !== head) throw new Error("推送Target不YesCurrent HEAD");
      bases.push(
        explicit
          ? await commit(root, explicit)
          : /^0+$/u.test(entry[3])
            ? await firstPushBase(root, head)
            : await resolvePushBase(root, head, await commit(root, entry[3])),
      );
    }
    return { bases: [...new Set(bases)], deletedOnly: !bases.length };
  }
  if (explicit) return { bases: [await commit(root, explicit)] };
  const upstream = await run("git", ["rev-parse", "--verify", "@{upstream}^{commit}"], {
    cwd: root,
    allowFailure: true,
  });
  return {
    bases: [
      upstream.code === 0
        ? await resolvePushBase(root, head, upstream.stdout.toString().trim())
        : await firstPushBase(root, head),
    ],
  };
}
