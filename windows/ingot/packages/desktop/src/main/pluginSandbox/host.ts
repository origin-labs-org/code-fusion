import type { Locale } from "@origin-ai/cf-shared";
import { PlatformChannels } from "@origin-ai/cf-shared";
import type { PluginSandboxHandle, PluginSandboxRegisterInput } from "@origin-ai/cf-shared/mcp-apps";
import {
  BrowserWindow,
  clipboard,
  nativeImage,
  MessageChannelMain,
  app,
  dialog,
  session as electronSession,
  webContents as electronWebContents,
  ipcMain,
  systemPreferences,
  type WebContents,
} from "electron";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PluginSandboxRecord, PluginSandboxRegistryPort } from "./contract.js";
import { attachPluginSandboxGuest, configurePluginSandboxGuest } from "./guestPolicy.js";
import { createPluginSandboxPermissionGate } from "./permissionGate.js";
import { formatPluginSandboxPermissionDialogText } from "./permissions.js";
import type { PluginSandboxAssetSource } from "./protocol.js";
import { createPluginSandboxRegistry } from "./registry.js";
import { preparePluginSandboxSession } from "./session.js";
import { sandboxCaptureSchema, scaleCaptureRect } from "./capture.js";
import { DesktopBrowserScreenshotActivityController } from "@desktop/main/browserView/browserScreenshotActivityController.js";

export interface PluginSandboxHost {
  clearBrowserData(): Promise<void>;
  
  registerFromHost(input: PluginSandboxRegisterInput): PluginSandboxHandle;
  
  configureGuest(input: {
    webPreferences: Electron.WebPreferences;
    params: Record<string, string>;
    ownerWebContentsId: number;
  }): ReturnType<typeof configurePluginSandboxGuest>;
  
  attachGuest(input: { guest: WebContents; hostWebContents: WebContents; sandboxId: string }): void;
}

let installedHost: PluginSandboxHost | null = null;

export function getPluginSandboxHost(): PluginSandboxHost | null {
  return installedHost;
}

export function installPluginSandboxHost(input: {
  preloadPath: string;
  rendererDir: string;
  aliasDir: string;
  
  devServerUrl?: string;
  logger?: { warn: (...args: unknown[]) => void; info?: (...args: unknown[]) => void };
  registry?: PluginSandboxRegistryPort;
  
  registryMaxEntries?: number;
}): PluginSandboxHost {
  if (installedHost) return installedHost;
  const detachByKey = new Map<string, () => void>();
  const watchedOwners = new Set<number>();
  const guests = new Map<string, WebContents>();
  const activity = new DesktopBrowserScreenshotActivityController({
    fromId: (id) => BrowserWindow.fromId(id),
    fromWebContentsId: (id) => electronWebContents.fromId(id) ?? null,
    log: (message) => input.logger?.warn(message),
  });
  const executions = new Map<string, { lease?: ReturnType<typeof activity.acquire> }>();
  const releaseExecution = (sandboxId: string) => {
    executions.get(sandboxId)?.lease?.release();
    executions.delete(sandboxId);
  };
  const syncExecution = (sandboxId: string) => {
    const state = executions.get(sandboxId);
    const guest = guests.get(sandboxId);
    if (!state || state.lease || !guest || guest.isDestroyed() || guest.isLoadingMainFrame())
      return;
    const owner = guest.hostWebContents;
    const win = owner && BrowserWindow.fromWebContents(owner);
    if (!win) return;
    state.lease = activity.acquire({
      windowId: win.id,
      webContentsId: guest.id,
      requestId: sandboxId,
      reason: "plugin-execution",
    });
    state.lease?.markPrepared?.();
    state.lease?.invalidated?.addEventListener(
      "abort",
      () => {
        if (executions.get(sandboxId) === state) releaseExecution(sandboxId);
      },
      { once: true },
    );
  };
  const stopping = new WeakMap<WebContents, Promise<void>>();
  const partitions = new Set<string>();
  let clearing = false;
  const assets: PluginSandboxAssetSource = {
    rendererDir: input.rendererDir,
    aliasDir: input.aliasDir,
    ...(input.devServerUrl ? { devServerUrl: input.devServerUrl } : {}),
  };
  const stopGuest = (guest: WebContents): Promise<void> => {
    if (guest.isDestroyed()) return Promise.resolve();
    const existing = stopping.get(guest);
    if (existing) return existing;
    const stopped = Promise.resolve().then(async () => {
      if (guest.isDestroyed()) return;
      const allowUnload = (event: Electron.Event) => event.preventDefault();
      guest.on("will-prevent-unload", allowUnload);
      try {
        await guest.loadURL("about:blank");
      } catch (error) {
        if (!guest.isDestroyed()) throw error;
      } finally {
        guest.removeListener("will-prevent-unload", allowUnload);
      }
      if (guest.isDestroyed()) return;
      const destroyed = new Promise<void>((resolve) => guest.once("destroyed", resolve));
      guest.close({ waitForBeforeUnload: false });
      await destroyed;
    });
    stopping.set(guest, stopped);
    return stopped;
  };
  const onDispose = (record: PluginSandboxRecord) => {
    releaseExecution(record.sandboxId);
    detachByKey.get(record.sandboxId)?.();
    detachByKey.delete(record.sandboxId);
    const guest = guests.get(record.sandboxId);
    if (guest)
      void stopGuest(guest).catch((error: unknown) =>
        input.logger?.warn("[plugin-sandbox] guest stop failed", String(error)),
      );
  };
  const registry =
    input.registry ??
    createPluginSandboxRegistry({
      onDispose,
      ...(input.registryMaxEntries !== undefined ? { maxEntries: input.registryMaxEntries } : {}),
    });

  const resolveLocale = (): Locale =>
    app.getLocale().toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  const permissions = createPluginSandboxPermissionGate({
    registry,
    async prompt({ record, permissions: pending }) {
      const text = formatPluginSandboxPermissionDialogText(
        { serverName: record.serverName ?? "CodeFusion Gen UI", permissions: pending },
        resolveLocale(),
      );
      const owner = electronWebContents.fromId(record.ownerWebContentsId);
      const parent = owner ? BrowserWindow.fromWebContents(owner) : null;
      const options = {
        type: "question" as const,
        buttons: [text.allowButton, text.denyButton],
        defaultId: 1,
        cancelId: 1,
        title: text.title,
        message: text.message,
        detail: text.detail,
        noLink: true,
      };
      const { response } =
        parent && !parent.isDestroyed()
          ? await dialog.showMessageBox(parent, options)
          : await dialog.showMessageBox(options);
      return response === 0;
    },
    ...(process.platform === "darwin"
      ? {
          async requestSystemMediaAccess(kind: "camera" | "microphone") {
            const status = systemPreferences.getMediaAccessStatus(kind);
            if (status === "granted") return true;
            if (status !== "not-determined") return false;
            return systemPreferences.askForMediaAccess(kind);
          },
        }
      : {}),
    ...(input.logger ? { logger: input.logger } : {}),
  });

  const host: PluginSandboxHost = {
    async clearBrowserData() {
      clearing = true;
      for (const owner of watchedOwners) registry.disposeOwner(owner);
      await Promise.all([...guests.values()].map(stopGuest));
      guests.clear();
      const names = await readdir(join(app.getPath("sessionData"), "Partitions")).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      for (const name of names)
        if (/^plugin-sandbox-v[12]-[a-f0-9]+$/.test(name)) partitions.add(`persist:${name}`);
      await Promise.all(
        [...partitions].map(async (partition) => {
          const session = electronSession.fromPartition(partition);
          await session.clearStorageData();
          await session.clearCache();
        }),
      );
    },
    registerFromHost(registerInput) {
      if (clearing) throw new Error("MCP App browser data is being cleared");
      const owner = electronWebContents.fromId(registerInput.ownerWebContentsId);
      if (!owner || owner.isDestroyed()) throw new Error("MCP App window is no longer available");
      const handle = registry.register(registerInput);
      partitions.add(handle.partition);
      if (!watchedOwners.has(owner.id)) {
        watchedOwners.add(owner.id);
        owner.once("destroyed", () => {
          watchedOwners.delete(owner.id);
          registry.disposeOwner(owner.id);
        });
      }
      preparePluginSandboxSession({
        session: electronSession.fromPartition(handle.partition),
        registry,
        assets,
        permissions,
        logger: input.logger,
      });
      input.logger?.info?.("[plugin-sandbox] registered", {
        sandboxId: handle.sandboxId,
        initId: handle.initId,
        scopeId: registerInput.scopeId,
        ownerWebContentsId: registerInput.ownerWebContentsId,
      });
      return handle;
    },
    configureGuest(guestInput) {
      return configurePluginSandboxGuest({
        ...guestInput,
        registry,
        preloadPath: input.preloadPath,
      });
    },
    attachGuest({ guest, hostWebContents, sandboxId }) {
      if (clearing) {
        void stopGuest(guest).catch((error: unknown) =>
          input.logger?.warn("[plugin-sandbox] late guest stop failed", String(error)),
        );
        return;
      }
      guests.set(sandboxId, guest);
      guest.on("did-stop-loading", () => syncExecution(sandboxId));
      guest.once("destroyed", () => {
        if (guests.get(sandboxId) === guest) {
          releaseExecution(sandboxId);
          guests.delete(sandboxId);
        }
      });
      if (!watchedOwners.has(hostWebContents.id)) {
        watchedOwners.add(hostWebContents.id);
        const ownerId = hostWebContents.id;
        hostWebContents.once("destroyed", () => {
          watchedOwners.delete(ownerId);
          registry.disposeOwner(ownerId);
        });
      }
      detachByKey.get(sandboxId)?.();
      detachByKey.set(
        sandboxId,
        attachPluginSandboxGuest({
          guest,
          hostWebContents,
          registry,
          sandboxId,
          createMessageChannel: () => new MessageChannelMain(),
          logger: input.logger,
        }),
      );
    },
  };

  ipcMain.handle(PlatformChannels.PluginSandboxOwnerWebContentsId, (event) => event.sender.id);
  ipcMain.handle(
    PlatformChannels.PluginSandboxExecutionActive,
    (event, sandboxId: unknown, initId: unknown, active: unknown) => {
      if (
        typeof sandboxId !== "string" ||
        typeof initId !== "number" ||
        typeof active !== "boolean"
      )
        throw new Error("Invalid sandbox execution request");
      const record = registry.get(sandboxId);
      if (
        !record ||
        record.ownerWebContentsId !== event.sender.id ||
        record.initId !== initId ||
        record.contentKind === "gen-ui"
      )
        throw new Error("Sandbox execution is no longer available");
      if (!active) {
        releaseExecution(sandboxId);
        return;
      }
      if (!executions.has(sandboxId)) executions.set(sandboxId, {});
      syncExecution(sandboxId);
    },
  );
  ipcMain.handle(PlatformChannels.PluginSandboxCopyImage, async (event, value: unknown) => {
    const request = sandboxCaptureSchema.parse(value);
    const record = registry.get(request.sandboxId);
    const guest = guests.get(request.sandboxId);
    const isCurrent = () =>
      record &&
      registry.get(request.sandboxId) === record &&
      record.ownerWebContentsId === event.sender.id &&
      record.initId === request.initId &&
      !event.sender.isDestroyed() &&
      guest &&
      !guest.isDestroyed() &&
      guests.get(request.sandboxId) === guest;
    if (!isCurrent() || !guest) throw new Error("Sandbox capture is no longer available");
    const captured = await guest.capturePage();
    if (!isCurrent()) throw new Error("Sandbox capture is no longer available");
    const cropped = captured.crop(scaleCaptureRect(request, captured.getSize()));
    clipboard.writeImage(
      process.platform === "win32"
        ? nativeImage.createFromBitmap(cropped.toBitmap(), cropped.getSize())
        : cropped,
    );
  });
  ipcMain.handle(
    PlatformChannels.PluginSandboxDispose,
    (event, sandboxId: unknown, initId: unknown) => {
      if (typeof sandboxId !== "string") return;
      const record = registry.get(sandboxId);
      if (!record || record.ownerWebContentsId !== event.sender.id) return;
      input.logger?.info?.("[plugin-sandbox] dispose requested", {
        sandboxId,
        initId,
        currentInitId: record.initId,
      });
      registry.dispose(sandboxId, typeof initId === "number" ? initId : undefined);
      const guest = guests.get(sandboxId);
      if (guest && !registry.get(sandboxId)) return stopGuest(guest);
    },
  );
  ipcMain.handle(PlatformChannels.PluginSandboxConsumeUserGesture, (event, sandboxId: unknown) => {
    if (typeof sandboxId !== "string") return false;
    const record = registry.get(sandboxId);
    if (!record || record.ownerWebContentsId !== event.sender.id) return false;
    return registry.consumeUserGesture(sandboxId);
  });

  installedHost = host;
  return host;
}
