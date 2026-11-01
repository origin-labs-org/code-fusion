import { setImmediate } from "node:timers/promises";
import type { WorkspaceFileEntry } from "@origin-ai/cf-shared";
import { unpackWorkspaceFileEntries } from "@origin-ai/cf-shared/workspaceFileEntriesCodec";
import {
  filterWorkspaceFileSearchCandidates,
  mapWorkspaceFileEntriesToSearchCandidates,
  type WorkspaceFileSearchCandidate,
} from "@origin-ai/cf-shared/workspaceFileSearch";

export async function buildHostFileSearchCandidates(packed: string, rootPath: string) {
  const candidates: WorkspaceFileSearchCandidate[] = [];
  for (let offset = 0; offset < packed.length; ) {
    const newline = packed.indexOf("\n", offset + 128_000);
    const end = newline < 0 ? packed.length : newline + 1;
    const entries = unpackWorkspaceFileEntries(packed.slice(offset, end), rootPath);
    for (const candidate of mapWorkspaceFileEntriesToSearchCandidates(entries))
      candidates.push(candidate);
    offset = end;
    await setImmediate();
  }
  return candidates;
}

export async function searchHostFileCandidates(
  candidates: WorkspaceFileSearchCandidate[],
  query: string,
  limit: number,
): Promise<WorkspaceFileEntry[]> {
  let best: WorkspaceFileSearchCandidate[] = [];
  for (let offset = 0; offset < candidates.length; offset += 2048) {
    best = filterWorkspaceFileSearchCandidates(
      [...best, ...candidates.slice(offset, offset + 2048)],
      query,
      { limit },
    );
    await setImmediate();
  }
  return best.map(({ name, path, relativePath, type }) => ({ name, path, relativePath, type }));
}
