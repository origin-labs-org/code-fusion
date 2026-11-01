import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function subagentUpdateCursor() {
  const root = await browser.electron.execute(() => process.env.CF_E2E_RUNTIME_LOG_DIR!);
  const read = async () =>
    (
      await Promise.all(
        (
          await readdir(root)
        )
          .filter((p) => p.endsWith(".log"))
          .sort()
          .map((p) => readFile(join(root, p), "utf8")),
      )
    ).join("\n");
  const before = await read();
  return async (hostPids?: number[], changedPaths: string[] = []) => {
    await browser.waitUntil(
      async () => {
        const after = await read();
        const lines = after
          .split("\n")
          .filter((line) => line.includes("Subagent 配置文件更新完成") && !before.includes(line));
        const matches = (pid?: number) =>
          changedPaths.length
            ? changedPaths.every((path) =>
                lines.some(
                  (line) =>
                    (!pid || line.includes(`[pid:${pid}]`)) &&
                    line.includes(JSON.stringify(path).slice(1, -1)),
                ),
              )
            : lines.some((line) => !pid || line.includes(`[pid:${pid}]`));
        return hostPids?.length ? hostPids.every(matches) : matches();
      },
      { timeout: 20000, timeoutMsg: "Host failed to complete config file update" },
    );
  };
}
