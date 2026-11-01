import type { AppSettings } from "@origin-ai/cf-shared";

export async function runStartupReconnectBatch<TCandidate, TResult>(deps: {
  getSettings: () => Promise<Pick<AppSettings, "remoteStartupAutoReconnectEnabled">>;
  listCandidates: () => Promise<TCandidate[]>;
  reconnect: (candidates: TCandidate[]) => Promise<TResult[]>;
}): Promise<TResult[]> {
  const settings = await deps.getSettings();
  if (settings.remoteStartupAutoReconnectEnabled === false) return [];
  return await deps.reconnect(await deps.listCandidates());
}
