import { execFile } from "node:child_process";

export interface DesktopCloseToTrayCapability {
  
  supported: boolean;
  
  gnomeLikeWithoutTray: boolean;
}

export type TraySupportCommandExecutor = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<{ stdout: string }>;

const STATUS_NOTIFIER_WATCHER_NAME = "org.kde.StatusNotifierWatcher";

const defaultExecutor: TraySupportCommandExecutor = (command, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout });
    });
  });

const probeCommands: ReadonlyArray<{ command: string; args: string[] }> = [
  {
    command: "gdbus",
    args: [
      "call",
      "--session",
      "--dest",
      "org.freedesktop.DBus",
      "--object-path",
      "/org/freedesktop/DBus",
      "--method",
      "org.freedesktop.DBus.NameHasOwner",
      STATUS_NOTIFIER_WATCHER_NAME,
    ],
  },
  {
    command: "busctl",
    args: [
      "--user",
      "call",
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "NameHasOwner",
      "s",
      STATUS_NOTIFIER_WATCHER_NAME,
    ],
  },
  {
    command: "qdbus",
    args: [
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus.NameHasOwner",
      STATUS_NOTIFIER_WATCHER_NAME,
    ],
  },
];

export function parseStatusNotifierOwnerOutput(stdout: string): boolean | null {
  const text = stdout.trim();
  if (/^\(true,?\)$/.test(text) || /^b\s+"?true"?$/.test(text) || text === "true") {
    return true;
  }
  if (/^\(false,?\)$/.test(text) || /^b\s+"?false"?$/.test(text) || text === "false") {
    return false;
  }
  return null;
}

export function isGnomeLikeDesktop(env: NodeJS.ProcessEnv): boolean {
  const desktop = env.XDG_CURRENT_DESKTOP ?? env.XDG_SESSION_DESKTOP ?? "";
  return desktop.toLowerCase().split(/[:;]/).includes("gnome");
}

export async function detectDesktopCloseToTrayCapability(options: {
  platform: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execute?: TraySupportCommandExecutor;
  commandTimeoutMs?: number;
}): Promise<DesktopCloseToTrayCapability> {
  const execute = options.execute ?? defaultExecutor;
  const timeoutMs = options.commandTimeoutMs ?? 1500;
  const env = options.env ?? process.env;

  if (options.platform !== "linux") {
    return { supported: true, gnomeLikeWithoutTray: false };
  }

  for (const probe of probeCommands) {
    try {
      const { stdout } = await execute(probe.command, probe.args, timeoutMs);
      const hasOwner = parseStatusNotifierOwnerOutput(stdout);
      if (hasOwner !== null) {
        return { supported: hasOwner, gnomeLikeWithoutTray: !hasOwner && isGnomeLikeDesktop(env) };
      }
    } catch {
    }
  }
  return { supported: false, gnomeLikeWithoutTray: isGnomeLikeDesktop(env) };
}

export function createCloseToTrayCapabilityMonitor(options: {
  platform: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execute?: TraySupportCommandExecutor;
  commandTimeoutMs?: number;
  staleMs?: number;
  now?: () => number;
}) {
  const staleMs = options.staleMs ?? 10_000;
  const now = options.now ?? Date.now;
  let cached: DesktopCloseToTrayCapability | null = null;
  let cachedAt = 0;
  let pending: Promise<DesktopCloseToTrayCapability> | null = null;

  const detect = () =>
    detectDesktopCloseToTrayCapability({
      platform: options.platform,
      env: options.env,
      execute: options.execute,
      commandTimeoutMs: options.commandTimeoutMs,
    });

  return {
    
    getSync(): DesktopCloseToTrayCapability | null {
      return cached;
    },
    refresh(force = false): Promise<DesktopCloseToTrayCapability> {
      if (!force && cached && now() - cachedAt < staleMs) {
        return Promise.resolve(cached);
      }
      pending ??= detect()
        .then((result) => {
          cached = result;
          cachedAt = now();
          return result;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}

export type CloseToTrayCapabilityMonitor = ReturnType<typeof createCloseToTrayCapabilityMonitor>;

export function resolveCloseToTraySupported(input: {
  platform: NodeJS.Platform;
  desktopTrayReady: boolean;
  capabilitySupported: boolean | undefined;
}): boolean {
  if (input.platform === "win32") {
    return input.desktopTrayReady;
  }
  if (input.platform === "linux") {
    return input.desktopTrayReady && input.capabilitySupported === true;
  }
  return false;
}

export function resolveCloseToTrayBootstrapValue(input: {
  platform: NodeJS.Platform;
  stored: boolean | undefined;
  linuxMigrationInitialized: boolean | undefined;
}): { value: boolean; needsLinuxMigration: boolean } {
  if (input.platform !== "linux") {
    return { value: input.stored ?? true, needsLinuxMigration: false };
  }
  if (input.linuxMigrationInitialized !== true) {
    return { value: false, needsLinuxMigration: true };
  }
  return { value: input.stored ?? false, needsLinuxMigration: false };
}

export function resolveCloseToTrayRuntimeValue(input: {
  platform: NodeJS.Platform;
  stored: boolean | undefined;
  linuxMigrationInitialized: boolean | undefined;
  migrationPersisted: boolean;
}): boolean {
  const bootstrap = resolveCloseToTrayBootstrapValue(input);
  if (bootstrap.needsLinuxMigration && !input.migrationPersisted) {
    return input.stored ?? true;
  }
  return bootstrap.value;
}
