import type {
  ConnectionProfile,
  RemoteAssetInstallMode,
  RemoteTarget,
  SourceServerManagementSnapshot,
} from "@origin-ai/cf-shared";
import { isValidWslUser, normalizeRemoteResourcePackageSelection } from "@origin-ai/cf-shared";
import type { SSHAuthMethod } from "@/hooks/useRemoteConnectionForm.js";
import type { RemoteWizardStep } from "@/RemoteConnectionWizardChrome.js";

type WizardIntlLike = {
  formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string;
};

export interface RemoteConnectionFormSnapshot {
  kind: RemoteTarget["kind"];
  host: string;
  port: string;
  username: string;
  sshAuthMethod: SSHAuthMethod;
  assetInstallMode?: RemoteAssetInstallMode;
  selectedSshConfigAlias?: string | null;
  password: string;
  privateKeyPath: string;
  privateKeyPassphrase: string;
  wslDistro: string;
  wslUser?: string;
  dockerContainer: string;
  manualDockerContainer?: string;
  serverUrl?: string;
  serverName?: string;
  serverToken?: string;
  serverWorkspacePath?: string;
}

export function getRemoteWizardStepCopy(
  intl: WizardIntlLike,
  step: RemoteWizardStep,
  kind: RemoteTarget["kind"],
  context?: {
    
    lineName?: string;
    
    deviceName?: string;
    connectionReady?: boolean;
    hasError?: boolean;
    updating?: boolean;
    cancelled?: boolean;
  },
) {
  switch (step) {
    case "device":
      return {
        title: intl.formatMessage({ id: "remote.deviceStepTitle" }),
        description: intl.formatMessage({ id: "remote.deviceStepDescription" }),
      };
    case "settings":
      return {
        title: intl.formatMessage({ id: "remote.settingsStepTitle" }),
        description: "",
      };
    case "connecting": {
      const description = context?.cancelled
        ? intl.formatMessage({ id: "remote.connectionCancelled" })
        : context?.updating
          ? intl.formatMessage({ id: "remote.connectingSubtitleUpdating" })
          : context?.hasError
            ? intl.formatMessage({ id: "remote.connectingSubtitleFailed" })
            : context?.connectionReady
              ? intl.formatMessage(
                  { id: "remote.connectingSubtitleConnected" },
                  {
                    device:
                      context.deviceName ??
                      context.lineName ??
                      intl.formatMessage({ id: `remote.kind.${kind}` }),
                  },
                )
              : intl.formatMessage(
                  { id: "remote.connectingStepDescription" },
                  {
                    method: context?.lineName ?? intl.formatMessage({ id: `remote.kind.${kind}` }),
                  },
                );
      return {
        title: intl.formatMessage({ id: "remote.connectingStepTitle" }),
        description,
      };
    }
    case "directory":
      return {
        title: intl.formatMessage({ id: "remote.selectDirectoryTitle" }),
        description: intl.formatMessage(
          { id: "remote.selectDirectoryDescription" },
          {
            method:
              context?.deviceName ??
              context?.lineName ??
              intl.formatMessage({ id: `remote.kind.${kind}` }),
          },
        ),
      };
  }
}

export function findPreferredSourceConnectionProfile(
  snapshot: Pick<SourceServerManagementSnapshot, "servers" | "profiles">,
  sourceServerId: string,
): ConnectionProfile | undefined {
  const server = snapshot.servers.find((candidate) => candidate.sourceServerId === sourceServerId);
  if (!server) return undefined;

  const activeProfiles = snapshot.profiles.filter(
    (profile) => profile.sourceServerId === sourceServerId && profile.lifecycleState !== "retired",
  );
  return (
    activeProfiles.find((profile) => profile.profileId === server.preferredProfileId) ??
    activeProfiles[0]
  );
}

export type RemoteFormField =
  | "host"
  | "port"
  | "username"
  | "password"
  | "privateKey"
  | "docker"
  | "wslUser"
  | "serverUrl";

export interface RemoteFormFieldError {
  field: RemoteFormField;
  message: string;
}

function isInvalidPort(port: string): boolean {
  return Boolean(port) && (!/^\d+$/u.test(port) || Number(port) < 1 || Number(port) > 65535);
}

export function collectRemoteFormFieldErrors(
  intl: WizardIntlLike,
  snapshot: RemoteConnectionFormSnapshot,
  options: {
    
    passwordOptional?: boolean;
  } = {},
): RemoteFormFieldError[] {
  const errors: RemoteFormFieldError[] = [];
  const add = (field: RemoteFormField, id: string) =>
    errors.push({ field, message: intl.formatMessage({ id }) });
  switch (snapshot.kind) {
    case "ssh":
      if (!snapshot.host.trim()) add("host", "ssh.validation.hostRequired");
      if (isInvalidPort(snapshot.port.trim())) add("port", "ssh.validation.port");
      if (!snapshot.username.trim()) add("username", "ssh.validation.usernameRequired");
      if (
        snapshot.sshAuthMethod === "password" &&
        !snapshot.password &&
        !options.passwordOptional
      ) {
        add("password", "ssh.validation.passwordRequired");
      }
      if (snapshot.sshAuthMethod === "privateKey" && !snapshot.privateKeyPath.trim()) {
        add("privateKey", "ssh.validation.privateKeyRequired");
      }
      break;
    case "docker":
      if (!(snapshot.manualDockerContainer?.trim() || snapshot.dockerContainer.trim())) {
        add("docker", "docker.validation.required");
      }
      break;
    case "wsl": {
      const wslUser = snapshot.wslUser?.trim();
      if (wslUser && !isValidWslUser(wslUser)) add("wslUser", "wsl.validation.invalidUser");
      break;
    }
    case "server": {
      const url = snapshot.serverUrl?.trim() ?? "";
      if (!url) {
        add("serverUrl", "server.validation.urlRequired");
      } else {
        try {
          new URL(url);
        } catch {
          add("serverUrl", "server.validation.invalidUrl");
        }
      }
      break;
    }
  }
  return errors;
}

export function formatRemoteDraftPreview(snapshot: RemoteConnectionFormSnapshot): string | null {
  switch (snapshot.kind) {
    case "ssh": {
      const host = snapshot.host.trim();
      if (!host) return null;
      return `${snapshot.username.trim() || "user"}@${host}:${snapshot.port.trim() || 22}`;
    }
    case "docker":
      return snapshot.manualDockerContainer?.trim() || snapshot.dockerContainer.trim() || null;
    case "wsl":
      return snapshot.wslDistro.trim() || null;
    case "server":
      return snapshot.serverUrl?.trim() || null;
  }
}

export function buildRemoteTarget(
  intl: WizardIntlLike,
  snapshot: RemoteConnectionFormSnapshot,
): { target?: RemoteTarget; errorMessage?: string } {
  const [firstError] = collectRemoteFormFieldErrors(intl, snapshot);
  if (firstError) return { errorMessage: firstError.message };
  switch (snapshot.kind) {
    case "ssh": {
      const sshConfigAlias = snapshot.selectedSshConfigAlias?.trim();
      const port = snapshot.port.trim();

      return {
        target: {
          kind: "ssh",
          host: snapshot.host.trim(),
          port: port ? Number(port) : undefined,
          username: snapshot.username.trim(),
          ...(sshConfigAlias ? { sshConfigAlias } : {}),
          assetInstallMode: snapshot.assetInstallMode,
          ...(snapshot.sshAuthMethod === "password" && snapshot.password
            ? { password: snapshot.password }
            : {}),
          ...(snapshot.sshAuthMethod === "privateKey" && snapshot.privateKeyPath
            ? { privateKeyPath: snapshot.privateKeyPath }
            : {}),
          ...(snapshot.sshAuthMethod === "privateKey" && snapshot.privateKeyPassphrase
            ? { privateKeyPassphrase: snapshot.privateKeyPassphrase }
            : {}),
        },
      };
    }
    case "docker": {
      const dockerContainer =
        snapshot.manualDockerContainer?.trim() || snapshot.dockerContainer.trim();

      return {
        target: {
          kind: "docker",
          container: dockerContainer,
        },
      };
    }
    case "wsl": {
      const wslUser = snapshot.wslUser?.trim();
      return {
        target: {
          kind: "wsl",
          distro: snapshot.wslDistro || undefined,
          ...(wslUser ? { user: wslUser } : {}),
        },
      };
    }
    case "server": {
      const url = snapshot.serverUrl?.trim() ?? "";
      const name = snapshot.serverName?.trim();
      const token = snapshot.serverToken?.trim();
      const workspacePath = snapshot.serverWorkspacePath?.trim();

      return {
        target: {
          kind: "server",
          url,
          ...(name ? { name } : {}),
          ...(token ? { token } : {}),
          ...(workspacePath ? { workspacePath } : {}),
        },
      };
    }
  }
}

export function withDefaultRemoteResourcePackages(target: RemoteTarget): RemoteTarget {
  if (target.kind !== "ssh") {
    return target;
  }

  return {
    ...target,
    resourcePackages: {
      selectedPackageIds: normalizeRemoteResourcePackageSelection(),
    },
  };
}

export function buildRemoteTargetFromProfile(
  profile: ConnectionProfile,
): Exclude<RemoteTarget, { kind: "server" }> {
  switch (profile.target.kind) {
    case "ssh":
      return {
        kind: "ssh",
        host: profile.target.host,
        ...(profile.target.port ? { port: profile.target.port } : {}),
        username: profile.target.username,
        ...(profile.target.sshConfigAlias ? { sshConfigAlias: profile.target.sshConfigAlias } : {}),
        ...(profile.target.privateKeyPath ? { privateKeyPath: profile.target.privateKeyPath } : {}),
        ...(profile.target.assetInstallMode
          ? { assetInstallMode: profile.target.assetInstallMode }
          : {}),
      };
    case "wsl":
      return {
        kind: "wsl",
        ...(profile.target.distro ? { distro: profile.target.distro } : {}),
        ...(profile.target.user ? { user: profile.target.user } : {}),
      };
    case "docker":
      return { kind: "docker", container: profile.target.container };
  }
}

export function profileMatchesRemoteTarget(
  profile: ConnectionProfile,
  target: Exclude<RemoteTarget, { kind: "server" }>,
): boolean {
  if (profile.target.kind !== target.kind) return false;
  switch (target.kind) {
    case "ssh":
      return (
        profile.target.kind === "ssh" &&
        profile.target.host === target.host &&
        (profile.target.port ?? 22) === (target.port ?? 22) &&
        profile.target.username === target.username &&
        (profile.target.sshConfigAlias?.trim() ?? "") === (target.sshConfigAlias?.trim() ?? "")
      );
    case "wsl":
      return (
        profile.target.kind === "wsl" &&
        (profile.target.distro?.trim() ?? "") === (target.distro?.trim() ?? "") &&
        (profile.target.user?.trim() ?? "") === (target.user?.trim() ?? "")
      );
    case "docker":
      return profile.target.kind === "docker" && profile.target.container === target.container;
  }
}

export function findSourceServerUpgradeProfileId(
  snapshot: SourceServerManagementSnapshot,
  target: Exclude<RemoteTarget, { kind: "server" }>,
  failedProfileId?: string,
): string | null {
  const requiredByProfileId = new Map(
    snapshot.states
      .filter(
        (state) =>
          state.state === "needs-upgrade" &&
          state.upgradeTarget === "server" &&
          state.updateAvailability === "required",
      )
      .map((state) => [state.profileId, state.updatedAt]),
  );
  return (
    snapshot.profiles
      .filter(
        (profile) =>
          (!failedProfileId || profile.profileId === failedProfileId) &&
          profile.lifecycleState !== "retired" &&
          requiredByProfileId.has(profile.profileId) &&
          profileMatchesRemoteTarget(profile, target),
      )
      .toSorted(
        (left, right) =>
          (requiredByProfileId.get(right.profileId) ?? 0) -
          (requiredByProfileId.get(left.profileId) ?? 0),
      )[0]?.profileId ?? null
  );
}

export interface SshPasteTarget {
  host: string;
  username?: string;
  port?: string;
}

function parsePort(value: string | undefined): string | undefined | null {
  if (value == null) return undefined;
  if (!/^\d+$/u.test(value)) return null;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? String(port) : null;
}

function parseUserHostPort(value: string): SshPasteTarget | null {
  const match = /^(?:([^@\s:/]+)@)?(\[[^\]\s]+\]|[^:@\s[\]/]+)(?::([^:\s]+))?$/u.exec(value);
  if (!match) return null;
  const [, username, rawHost = "", rawPort] = match;
  const port = parsePort(rawPort);
  if (port === null) return null;
  const host = rawHost.startsWith("[") ? rawHost.slice(1, -1) : rawHost;
  return {
    host,
    ...(username ? { username } : {}),
    ...(port ? { port } : {}),
  };
}

export function parseSshPasteTarget(text: string): SshPasteTarget | null {
  const trimmed = text.trim();
  const sshMatch = /^ssh\s+(.+)$/u.exec(trimmed);
  if (sshMatch) {
    const tokens = sshMatch[1]!.split(/\s+/u);
    let target: string | undefined;
    let portToken: string | undefined;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token === "-p") {
        portToken = tokens[index + 1];
        if (portToken == null) return null;
        index += 1;
      } else if (token.startsWith("-") || target) {
        return null;
      } else {
        target = token;
      }
    }
    if (!target) return null;
    const parsed = parseUserHostPort(target);
    const port = parsePort(portToken);
    if (!parsed || port === null) return null;
    return port ? { ...parsed, port } : parsed;
  }
  const parsed = parseUserHostPort(trimmed);
  if (!parsed || (!parsed.username && !parsed.port)) return null;
  return parsed;
}
