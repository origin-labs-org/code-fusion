export type AppShutdownKind = "normal" | "update-install";

export interface AppShutdownPolicy {
  forceKillDelayMs: number;
  waitTimeoutMs: number;
}

export interface AppShutdownPolicySelection {
  kind: AppShutdownKind;
  policy: AppShutdownPolicy;
  upgraded: boolean;
}

const STRICT_SHUTDOWN_POLICY: AppShutdownPolicy = {
  forceKillDelayMs: 7_500,
  waitTimeoutMs: 9_000,
};

const WINDOWS_NORMAL_SHUTDOWN_POLICY: AppShutdownPolicy = {
  forceKillDelayMs: 4_000,
  waitTimeoutMs: 4_500,
};

export function resolveAppShutdownPolicy(
  kind: AppShutdownKind,
  platform: NodeJS.Platform,
): AppShutdownPolicy {
  if (platform === "win32" && kind === "normal") {
    return WINDOWS_NORMAL_SHUTDOWN_POLICY;
  }
  return STRICT_SHUTDOWN_POLICY;
}

export function selectAppShutdownPolicy(
  activeKind: AppShutdownKind | null,
  requestedKind: AppShutdownKind,
  platform: NodeJS.Platform,
): AppShutdownPolicySelection {
  const kind =
    activeKind === "update-install" || requestedKind === "update-install"
      ? "update-install"
      : "normal";
  return {
    kind,
    policy: resolveAppShutdownPolicy(kind, platform),
    upgraded: activeKind === "normal" && kind === "update-install",
  };
}
