import type { McpAppsResourcePermission } from "@origin-ai/cf-shared/mcp-apps";
import type { PluginSandboxRecord, PluginSandboxRegistryPort } from "./contract.js";
import {
  decidePluginSandboxPermission,
  isPluginSandboxPermissionGranted,
  resolvePluginSandboxCheckedPermission,
  resolvePluginSandboxRequestedPermissions,
  type PluginSandboxPromptedPermission,
} from "./permissions.js";

export interface PluginSandboxPermissionGate {
  request(input: {
    permission: string;
    guestUrl?: string;
    isCurrent?: () => boolean;
    requestingUrl?: string;
    mediaTypes?: readonly string[];
  }): Promise<boolean>;
  check(input: {
    guestUrl?: string;
    permission: string;
    requestingOrigin?: string;
    mediaType?: string;
  }): boolean;
}

const EMPTY: ReadonlySet<McpAppsResourcePermission> = new Set();

export function createPluginSandboxPermissionGate(deps: {
  registry: Pick<PluginSandboxRegistryPort, "get">;
  
  prompt(input: {
    record: PluginSandboxRecord;
    permissions: PluginSandboxPromptedPermission[];
  }): Promise<boolean>;
  
  requestSystemMediaAccess?(kind: "camera" | "microphone"): Promise<boolean>;
  logger?: { warn: (...args: unknown[]) => void; info?: (...args: unknown[]) => void };
}): PluginSandboxPermissionGate {
  const inflight = new Map<string, Promise<boolean>>();
  const consented = new Map<string, Set<McpAppsResourcePermission>>();

  const recordFor = (
    url: string | undefined,
    guestUrl: string | undefined,
  ): PluginSandboxRecord | null => {
    try {
      if (!url || !guestUrl) return null;
      const guest = new URL(guestUrl);
      if (guest.protocol !== "cf-sandbox:" || !guest.hostname.startsWith("shell-")) return null;
      const record = deps.registry.get(guest.pathname.split("/")[2] ?? "");
      if (
        !record ||
        guestUrl !== record.shellUrl ||
        `${new URL(url).protocol}//${new URL(url).host}` !==
          `cf-sandbox://plugin-${record.instance.appIdentity}`
      )
        return null;
      return record;
    } catch {
      return null;
    }
  };

  const systemAccess = async (requested: readonly McpAppsResourcePermission[]) => {
    if (!deps.requestSystemMediaAccess) return true;
    for (const permission of requested) {
      if (permission !== "camera" && permission !== "microphone") continue;
      if (!(await deps.requestSystemMediaAccess(permission))) return false;
    }
    return true;
  };

  return {
    async request({ permission, requestingUrl, mediaTypes, guestUrl, isCurrent }) {
      const record = recordFor(requestingUrl, guestUrl);
      const requested = resolvePluginSandboxRequestedPermissions(permission, { mediaTypes });
      if (!record || !requested) {
        deps.logger?.warn(`[plugin-sandbox] permission blocked: ${permission}`);
        return false;
      }
      const valid = () =>
        deps.registry.get(record.sandboxId) === record && (isCurrent?.() ?? false);
      if (!valid()) return false;
      const declared = record.permissions ?? [];
      const { decision, pending } = decidePluginSandboxPermission({
        requested,
        declared,
        consented: consented.get(record.partition) ?? EMPTY,
      });
      if (decision === "deny") {
        deps.logger?.warn(
          `[plugin-sandbox] undeclared permission blocked: ${permission} sandbox=${record.sandboxId}`,
        );
        return false;
      }
      if (decision === "prompt") {
        const key = `${record.instance.token}|${[...pending].sort().join(",")}`;
        let flight = inflight.get(key);
        if (!flight) {
          flight = deps
            .prompt({ record, permissions: pending })
            .then((allowed) => {
              allowed = allowed && valid();
              deps.logger?.info?.("[plugin-sandbox] permission prompt settled", {
                sandboxId: record.sandboxId,
                serverName: record.serverName ?? "CodeFusion Gen UI",
                permissions: pending,
                allowed,
              });
              return allowed;
            })
            .finally(() => inflight.delete(key));
          inflight.set(key, flight);
        }
        if (!(await flight)) return false;
      }
      if (!(await systemAccess(requested)) || !valid()) return false;
      if (decision === "prompt") {
        const granted = consented.get(record.partition) ?? new Set();
        for (const item of pending) granted.add(item);
        consented.set(record.partition, granted);
      }
      return true;
    },
    check({ permission, requestingOrigin, mediaType, guestUrl }) {
      const record = recordFor(requestingOrigin, guestUrl);
      const checked = resolvePluginSandboxCheckedPermission(permission, { mediaType });
      if (!record || !checked) return false;
      return isPluginSandboxPermissionGranted({
        permission: checked,
        declared: record.permissions ?? [],
        consented: consented.get(record.partition) ?? EMPTY,
      });
    },
  };
}
