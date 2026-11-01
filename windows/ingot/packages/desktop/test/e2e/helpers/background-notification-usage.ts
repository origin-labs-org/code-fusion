import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { TID_CHAT_CONTEXT_USAGE_TRIGGER } from "@origin-ai/cf-shared/test-ids";
import { getV4PaneSnapshot } from "./v4-conversation.js";
import { sel } from "./selectors.js";

type UsageCategory = { source: string; chars: number };

export async function readBackgroundContextUsage(): Promise<UsageCategory[]> {
  const { sessionId } = await getV4PaneSnapshot();
  const logDir = process.env.CF_LOG_DIR;
  if (!sessionId || sessionId === "draft" || !logDir) {
    throw new Error("BG36 缺少已绑定 session 或 worker 日志目录");
  }
  const records: Array<{ timestamp: string; context: { categories: UsageCategory[] } }> = [];
  for (const file of (await readdir(logDir)).filter((name) => name.endsWith(".jsonl"))) {
    const content = await readFile(join(logDir, file), "utf8");
    for (const line of content.split("\n").slice(0, -1)) {
      if (!line.includes("context_usage_snapshot") || !line.includes(sessionId)) continue;
      const record = JSON.parse(line);
      if (
        record.event === "context_usage_snapshot" &&
        record.sessionId === sessionId &&
        record.context?.querySource === "main_turn"
      ) {
        records.push(record);
      }
    }
  }
  const latest = records
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .at(-1);
  expect(latest).toBeDefined();
  return latest!.context.categories.map(({ source, chars }) => ({ source, chars }));
}

export async function assertBackgroundUsageInV4(categories: UsageCategory[]): Promise<void> {
  const messageChars = categories.find((item) => item.source === "messages")!.chars;
  const totalChars = categories.reduce((sum, item) => sum + item.chars, 0);
  const expectedPercent = Math.round((messageChars / totalChars) * 1000) / 10;
  await $(sel(TID_CHAT_CONTEXT_USAGE_TRIGGER)).moveTo();
  let actualPercent: number | null = null;
  await browser.waitUntil(
    async () => {
      actualPercent = await browser.execute(() => {
        const panel = document.querySelector(
          '[aria-label="Context sources"], [aria-label="上下文来源"]',
        );
        const row = Array.from(panel?.firstElementChild?.children ?? []).find((element) =>
          Array.from(element.children).some((label) =>
            ["消息", "Messages"].includes(label.textContent?.trim() ?? ""),
          ),
        );
        const text = row?.lastElementChild?.textContent?.trim();
        return text ? Number(text.replace("%", "")) : null;
      });
      return actualPercent === expectedPercent;
    },
    { timeout: 10000, timeoutMsg: `BG36 V4 Messages 占比应为 ${expectedPercent}%` },
  );
  expect(actualPercent).toBe(expectedPercent);
}
