import { resolveSeededReplayBaseUrl } from "./custom-openai-provider-store.js";

export async function releaseControlledReplay(fixtureId: string): Promise<void> {
  const baseUrl = await resolveSeededReplayBaseUrl();
  if (!baseUrl) throw new Error("受控回放缺少本轮服务地址");
  await browser.waitUntil(
    async () => {
      const response = await fetch(`${baseUrl}/__e2e__/gates`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Read受控流Failed: ${response.status}`);
      const ids = (await response.json()) as string[];
      return ids.includes(fixtureId);
    },
    { timeout: 15_000, interval: 100, timeoutMsg: `fixture 没有进入Waiting释放Status: ${fixtureId}` },
  );
  const result = await fetch(`${baseUrl}/__e2e__/release/${encodeURIComponent(fixtureId)}`, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
  });
  if (result.status !== 204) throw new Error(`fixture 释放Failed: ${fixtureId} (${result.status})`);
}
