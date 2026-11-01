import { webContents, type Session } from "electron";
import type { PluginSandboxRegistryPort } from "./contract.js";
import type { PluginSandboxPermissionGate } from "./permissionGate.js";
import { createGenUiVendorResources, resolveGenUiVendorRedirect } from "./genUiVendor.js";
import {
  createPluginSandboxProtocolHandler,
  installPluginSandboxProtocol,
  parsePluginSandboxUrl,
  type PluginSandboxAssetSource,
} from "./protocol.js";

const preparedSessions = new WeakSet<Session>();

export function preparePluginSandboxSession(input: {
  session: Session;
  registry: PluginSandboxRegistryPort;
  assets: PluginSandboxAssetSource;
  
  permissions?: PluginSandboxPermissionGate;
  logger?: { warn: (...args: unknown[]) => void; info?: (...args: unknown[]) => void };
}): void {
  const { session } = input;
  if (preparedSessions.has(session)) return;
  preparedSessions.add(session);
  const vendorResources = createGenUiVendorResources(input.assets.aliasDir);
  installPluginSandboxProtocol(
    session.protocol,
    createPluginSandboxProtocolHandler({
      registry: input.registry,
      assets: input.assets,
      vendorResources,
      ...(input.logger ? { logger: input.logger } : {}),
    }),
  );
  session.webRequest.onBeforeRequest(
    { urls: ["cf-sandbox://*/*", "https://*/*"] },
    (details, callback) => {
      const target = parsePluginSandboxUrl(details.url);
      const guest =
        details.webContentsId === undefined ? undefined : webContents.fromId(details.webContentsId);
      const shell = guest && parsePluginSandboxUrl(guest.getURL());
      const url = new URL(details.url);
      if (url.protocol === "https:") {
        if (details.resourceType !== "script" || shell?.kind !== "shell") {
          callback({});
          return;
        }
        void resolveGenUiVendorRedirect(
          details.url,
          input.registry.get(shell.sandboxId),
          vendorResources,
        ).then(
          (redirectURL) => callback(redirectURL ? { redirectURL } : {}),
          () => {
            input.logger?.warn("[plugin-sandbox] Gen UI vendor manifest unavailable");
            callback({ cancel: true });
          },
        );
        return;
      }
      if (!target && shell?.kind === "shell") {
        const record = input.registry.get(shell.sandboxId);
        if (record && url.hostname === `shell-${record.instance.appIdentity}`) {
          callback({
            redirectURL: `${url.protocol}//${url.host}/instance/${record.sandboxId}${url.pathname}${url.search}`,
          });
          return;
        }
      }
      if (target?.kind === "shell") {
        const record = input.registry.get(target.sandboxId);
        const initial =
          details.resourceType === "mainFrame" && (!shell || shell.sandboxId === target.sandboxId);
        callback({
          cancel:
            !record ||
            url.hostname !== `shell-${record.instance.appIdentity}` ||
            (!initial && shell?.sandboxId !== target.sandboxId),
        });
        return;
      }
      const record = target && input.registry.get(target.sandboxId);
      callback({
        cancel:
          !record ||
          !shell ||
          shell.kind !== "shell" ||
          shell.sandboxId !== record.sandboxId ||
          url.hostname !== `plugin-${record.instance.appIdentity}`,
      });
    },
  );
  const gate = input.permissions;
  session.setPermissionRequestHandler((guest, permission, callback, details) => {
    if (!gate) {
      input.logger?.warn(`[plugin-sandbox] permission blocked: ${permission}`);
      callback(false);
      return;
    }
    const guestUrl = guest.getURL();
    const frame = guest.mainFrame.frames.find((child) => child.url === details.requestingUrl);
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes;
    void gate
      .request({
        permission,
        guestUrl,
        isCurrent: () =>
          !guest.isDestroyed() &&
          guest.getURL() === guestUrl &&
          Boolean(frame && !frame.detached && guest.mainFrame.frames.includes(frame)),
        requestingUrl: details.requestingUrl,
        ...(mediaTypes ? { mediaTypes } : {}),
      })
      .then(callback, (error: unknown) => {
        input.logger?.warn(`[plugin-sandbox] permission request failed: ${String(error)}`);
        callback(false);
      });
  });
  session.setPermissionCheckHandler((guest, permission, requestingOrigin, details) => {
    if (!gate) return false;
    const mediaType = (details as { mediaType?: string }).mediaType;
    return gate.check({
      guestUrl: guest?.getURL(),
      permission,
      requestingOrigin,
      ...(mediaType ? { mediaType } : {}),
    });
  });
  session.on("will-download", (event) => {
    event.preventDefault();
    input.logger?.warn("[plugin-sandbox] download blocked");
  });
  void session.setProxy({ mode: "direct" }).catch(() => undefined);
}
