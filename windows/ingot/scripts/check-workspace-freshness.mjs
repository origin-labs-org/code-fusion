#!/usr/bin/env node
//
//
//

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const args = process.argv.slice(2);
const maxBehindMainIndex = args.indexOf("--max-behind-main");
const maxBehindMain =
  maxBehindMainIndex >= 0 ? Number(args[maxBehindMainIndex + 1]) : 50;
if (!Number.isInteger(maxBehindMain) || maxBehindMain < 0) {
  console.error("[freshness] --max-behind-main 需要One个非负整Count");
  process.exit(2);
}
const doFetch = !args.includes("--no-fetch");

async function git(...gitArgs) {
  const { stdout } = await execFile("git", gitArgs, { encoding: "utf8" });
  return stdout.trim();
}

if (doFetch) {
  await git("fetch", "origin", "--prune");
}

const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
let upstream = null;
try {
  upstream = await git("rev-parse", "--abbrev-ref", "@{upstream}");
} catch {
  console.warn(
    `[freshness] ${branch} 没有远端跟踪分支，Skip behind-remote Check（Yes否忘了 push -u？）`,
  );
}

const failures = [];
if (upstream) {
  const behindRemote = Number(await git("rev-list", "--count", `HEAD..${upstream}`));
  if (behindRemote > 0) {
    failures.push(
      `${branch} 落后 ${upstream} ${behindRemote} 个Submit：先 git merge --ff-only ${upstream}`,
    );
  }
}

let mainReport = "";
try {
  await git("rev-parse", "--verify", "origin/main^{commit}");
  const aheadMain = Number(
    await git("rev-list", "--count", `origin/main..HEAD`),
  );
  const behindMain = Number(
    await git("rev-list", "--count", `HEAD..origin/main`),
  );
  mainReport = `E对 origin/main：ahead ${aheadMain} / behind ${behindMain}（阈Value ${maxBehindMain}）`;
  if (behindMain > maxBehindMain) {
    const message = `落后 origin/main ${behindMain} 个Submit，超过阈Value ${maxBehindMain}`;
    if (aheadMain === 0) {
      failures.push(`${message}：git merge --ff-only origin/main or重建分支`);
    } else {
      console.warn(
        `[freshness] Warning：${message}。This is特性/MR 分支（ahead ${aheadMain}），` +
          `分叉本身正常；若要跟主线对齐请先确认 MR Status（冻结Medium的 Draft MR 不要盲目 rebase）。`,
      );
    }
  }
} catch {
  console.warn("[freshness] 仓库没有 origin/main，Skip main 距离Check。");
}

if (failures.length > 0) {
  console.error(`[freshness] 基线Expired，Deny在Old架构上开工（Current分支：${branch}）：`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `[freshness] 基线New鲜：${branch}${upstream ? `（与 ${upstream} 同步）` : ""}${
    mainReport ? `，${mainReport}` : ""
  }`,
);
