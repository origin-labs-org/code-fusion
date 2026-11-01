//   remote:ssh:<host>:<port>:<username>:<posixPath>
//   remote:wsl:<distro>[:<user>]:<posixPath>
//   remote:docker:<container>:<posixPath>
import type { RemoteTarget } from "./remoteTarget.js";

export type RemoteWorkspaceIdentityKind = "ssh" | "wsl" | "docker" | "server";

export interface ParsedRemoteWorkspaceIdentity {
  kind: RemoteWorkspaceIdentityKind;
  
  sourceServerId?: string;
  
  workspacePath: string;
}

const REMOTE_IDENTITY_PREFIX = "remote:";

const AUTHORITY_SEGMENTS: Record<RemoteWorkspaceIdentityKind, number> = {
  ssh: 3,
  wsl: 1,
  docker: 1,
  server: 1,
};

function isRemoteWorkspaceIdentityKind(value: string): value is RemoteWorkspaceIdentityKind {
  return value === "ssh" || value === "wsl" || value === "docker" || value === "server";
}

function normalizeWorkspacePathForIdentity(workspacePath: string): string {
  const normalized = workspacePath.replace(/\\/g, "/").replace(/\/+/g, "/");
  const trimmed = normalized.replace(/^\/+|\/+$/g, "");
  return `/${trimmed}`;
}

function resolveServerIdentityId(target: Extract<RemoteTarget, { kind: "server" }>): string {
  const explicit = target.serverId?.trim() || target.name?.trim();
  if (explicit) {
    return explicit;
  }
  try {
    return new URL(target.url.trim()).host;
  } catch {
    return target.url.trim();
  }
}

function normalizeServerIdForIdentity(serverId: string): string {
  const normalized = serverId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error("serverId must contain at least one identity-safe character");
  }
  return normalized;
}

export interface BuildServerRemoteWorkspaceIdentityOptions {
  serverId: string;
  workspacePath: string;
}

export function buildServerRemoteWorkspaceIdentity(
  options: BuildServerRemoteWorkspaceIdentityOptions,
): string {
  const serverId = normalizeServerIdForIdentity(options.serverId);
  const workspacePath = normalizeWorkspacePathForIdentity(options.workspacePath);
  return `${REMOTE_IDENTITY_PREFIX}server:${serverId}:${workspacePath}`;
}

export function buildRemoteWorkspaceIdentity(workspacePath: string, target: RemoteTarget): string {
  const normalizedPath = normalizeWorkspacePathForIdentity(workspacePath);
  switch (target.kind) {
    case "ssh":
      return `remote:ssh:${target.host.trim().toLowerCase()}:${target.port ?? 22}:${target.username.trim()}:${normalizedPath}`;
    case "wsl": {
      const distro = target.distro?.trim() || "default";
      const user = target.user?.trim();
      return user
        ? `remote:wsl:${distro}:${user}:${normalizedPath}`
        : `remote:wsl:${distro}:${normalizedPath}`;
    }
    case "docker":
      return `remote:docker:${target.container}:${normalizedPath}`;
    case "server":
      return buildServerRemoteWorkspaceIdentity({
        serverId: resolveServerIdentityId(target),
        workspacePath: normalizedPath,
      });
  }
}

export function parseRemoteWorkspaceIdentity(
  identity: string,
): ParsedRemoteWorkspaceIdentity | null {
  if (!identity.startsWith(REMOTE_IDENTITY_PREFIX)) {
    return null;
  }
  const rest = identity.slice(REMOTE_IDENTITY_PREFIX.length);
  const kindEnd = rest.indexOf(":");
  if (kindEnd <= 0) {
    return null;
  }
  const kind = rest.slice(0, kindEnd);
  if (!isRemoteWorkspaceIdentityKind(kind)) {
    return null;
  }
  let cursor = kindEnd + 1;
  let sourceServerId: string | undefined;
  for (let i = 0; i < AUTHORITY_SEGMENTS[kind]; i++) {
    const next = rest.indexOf(":", cursor);
    if (next <= cursor) {
      return null;
    }
    if (kind === "server" && i === 0) sourceServerId = rest.slice(cursor, next);
    cursor = next + 1;
  }
  if (kind === "wsl" && rest[cursor] !== "/") {
    const userEnd = rest.indexOf(":", cursor);
    if (userEnd <= cursor) {
      return null;
    }
    cursor = userEnd + 1;
  }
  const workspacePath = rest.slice(cursor);
  if (!workspacePath.startsWith("/")) {
    return null;
  }
  return { kind, workspacePath, ...(sourceServerId ? { sourceServerId } : {}) };
}

export function isRemoteWorkspaceIdentity(identity: string): boolean {
  return parseRemoteWorkspaceIdentity(identity) !== null;
}

export function remoteHostIdFromWorkspaceIdentity(identity: string): string | null {
  const parsed = parseRemoteWorkspaceIdentity(identity);
  return parsed ? identity.slice(0, -(parsed.workspacePath.length + 1)) : null;
}

export function buildRemoteHostWorkspaceIdentity(hostId: string, workspacePath: string): string {
  const identity = `${hostId}:${normalizeWorkspacePathForIdentity(workspacePath)}`;
  if (remoteHostIdFromWorkspaceIdentity(identity) !== hostId)
    throw new Error("Invalid remote host identity");
  return identity;
}
