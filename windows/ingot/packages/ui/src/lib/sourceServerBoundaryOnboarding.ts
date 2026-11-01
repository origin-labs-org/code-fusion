export interface EnsureSourceServerBoundaryAcknowledgedOptions<TVersion extends number> {
  currentVersion?: TVersion;
  targetVersion: TVersion;
  requestAcknowledgement: () => Promise<boolean>;
  persistVersion: (version: TVersion) => Promise<void>;
  isCurrent?: () => boolean;
}

export async function ensureSourceServerBoundaryAcknowledged<TVersion extends number>(
  options: EnsureSourceServerBoundaryAcknowledgedOptions<TVersion>,
): Promise<boolean> {
  if (options.isCurrent?.() === false || options.currentVersion === options.targetVersion)
    return false;
  if (!(await options.requestAcknowledgement())) return false;
  if (options.isCurrent?.() === false) return false;
  await options.persistVersion(options.targetVersion);
  return true;
}
