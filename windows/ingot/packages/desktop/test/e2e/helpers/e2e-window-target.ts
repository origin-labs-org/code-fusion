export interface E2EBrowserTargetInfo {
  id: string | null;
  type: string;
  url: string;
}

export interface E2EWebDriverPageHandleCandidate {
  handle: string;
  targetUrl: string;
}

export function collectE2EWebDriverPageHandleCandidates(
  handles: string[],
  targets: E2EBrowserTargetInfo[],
): E2EWebDriverPageHandleCandidate[] {
  const pageTargetsById = new Map(
    targets
      .filter(
        (target): target is E2EBrowserTargetInfo & { id: string } =>
          target.type === "page" && typeof target.id === "string" && target.id.length > 0,
      )
      .map((target) => [target.id, target] as const),
  );

  return handles.flatMap((handle) => {
    const target = pageTargetsById.get(handle);
    return target ? [{ handle, targetUrl: target.url }] : [];
  });
}
