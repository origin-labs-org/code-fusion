import { create } from "zustand";
import type { Hook, HookConfig } from "@origin-ai/cf-shared";
import type { IHooksService } from "@origin-ai/cf-services";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";

interface HooksStoreState {
  workspacePath: string | null;
  workspaceIdentity: string | null;
  authorityKey: string | null;
  loadedWorkspaceKey: string | null;
  hooks: Hook[];
  loading: boolean;
  error: string | null;
  operatingHookId: string | null;
  initialize: (
    workspacePath: string | undefined,
    workspaceIdentity: string | undefined,
    hooksService: IHooksService,
    authorityKey?: string,
  ) => Promise<void>;
  
  refresh: (
    hooksService: IHooksService,
    target: {
      workspacePath?: string | null;
      workspaceIdentity?: string | null;
      authorityKey?: string | null;
    },
  ) => Promise<void>;
  addHook: (config: HookConfig, hooksService: IHooksService) => Promise<void>;
  updateHook: (id: string, config: HookConfig, hooksService: IHooksService) => Promise<void>;
  deleteHook: (id: string, hooksService: IHooksService) => Promise<void>;
  toggleHook: (id: string, enabled: boolean, hooksService: IHooksService) => Promise<void>;
  importHook: (id: string, hooksService: IHooksService) => Promise<void>;
}

type StoreSet = (state: Partial<HooksStoreState>) => void;
type StoreGet = () => HooksStoreState;

const inflightLoads = new Map<string, Promise<void>>();

function getHooksCacheKey(
  workspacePath: string,
  workspaceIdentity?: string | null,
  authorityKey?: string | null,
): string {
  const targetKey = getWorkspaceKey(workspacePath, workspaceIdentity);
  return authorityKey?.trim() ? `${authorityKey.trim()}\0${targetKey}` : targetKey;
}

function currentWorkspaceKey(get: StoreGet): string | null {
  const { workspacePath, workspaceIdentity, authorityKey } = get();
  return workspacePath ? getHooksCacheKey(workspacePath, workspaceIdentity, authorityKey) : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildCfHookLocation(
  workspacePath: string,
  storageLevel: "user" | "project" = "user",
): Hook["location"] {
  return storageLevel === "project"
    ? {
        source: "cf",
        scope: "project",
        directoryPath: "",
        projectPath: workspacePath,
      }
    : {
        source: "cf",
        scope: "user",
        directoryPath: "",
      };
}

function isEditableHook(hook: Hook): boolean {
  return hook.editable ?? (!hook.location || hook.location.source === "cf");
}

function hookFromConfig(config: HookConfig, workspacePath: string): Hook {
  return {
    id: `hook-${crypto.randomUUID()}`,
    event: config.event,
    matcher: config.matcher,
    type: config.type,
    command: config.command,
    ...(config.type === "process" ? { args: config.args ?? [] } : {}),
    ...(config.type === "command" && config.async !== undefined ? { async: config.async } : {}),
    ...(config.type === "command" && config.shell !== undefined ? { shell: config.shell } : {}),
    ...(config.statusMessage ? { statusMessage: config.statusMessage } : {}),
    timeout: config.timeout ?? 60,
    enabled: config.enabled ?? true,
    custom: config.custom,
    location: buildCfHookLocation(workspacePath, config.storageLevel),
  };
}

function updateHookFromConfig(hook: Hook, config: HookConfig): Hook {
  return {
    ...hook,
    event: config.event,
    matcher: config.matcher,
    type: config.type,
    command: config.command,
    args: config.type === "process" ? (config.args ?? []) : undefined,
    async: config.type === "command" ? config.async : undefined,
    shell: config.type === "command" ? config.shell : undefined,
    statusMessage: config.statusMessage,
    timeout: config.timeout ?? 60,
    enabled: config.enabled ?? hook.enabled,
    custom: config.custom,
  };
}

async function loadCurrentHooks(get: StoreGet, set: StoreSet, hooksService: IHooksService) {
  const { workspacePath, workspaceIdentity, authorityKey } = get();
  if (!workspacePath) return;
  const key = getHooksCacheKey(workspacePath, workspaceIdentity, authorityKey);
  const result = await hooksService.loadHooks({
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
  });
  if (currentWorkspaceKey(get) !== key) return;
  set({
    hooks: result.hooks,
    loadedWorkspaceKey: key,
  });
}

async function persistHooks(
  hooks: Hook[],
  get: StoreGet,
  set: StoreSet,
  hooksService: IHooksService,
): Promise<void> {
  const { workspacePath, workspaceIdentity } = get();
  if (!workspacePath) throw new Error("No workspace path set");
  await hooksService.saveHooks({
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    hooks,
  });
  await loadCurrentHooks(get, set, hooksService);
}

async function applyHookMutation(
  get: StoreGet,
  set: StoreSet,
  hooksService: IHooksService,
  updatedHooks: Hook[],
  operatingHookId?: string,
): Promise<void> {
  const previousHooks = get().hooks;
  const key = currentWorkspaceKey(get);
  set({
    hooks: updatedHooks,
    error: null,
    ...(operatingHookId ? { operatingHookId } : {}),
  });
  try {
    await persistHooks(updatedHooks, get, set, hooksService);
    set({ operatingHookId: null });
  } catch (error) {
    set(
      currentWorkspaceKey(get) === key
        ? { hooks: previousHooks, operatingHookId: null, error: errorMessage(error) }
        : { operatingHookId: null },
    );
    throw error;
  }
}

export const useHooksStore = create<HooksStoreState>((set, get) => ({
  workspacePath: null,
  workspaceIdentity: null,
  authorityKey: null,
  loadedWorkspaceKey: null,
  hooks: [],
  loading: false,
  error: null,
  operatingHookId: null,

  initialize: async (workspacePath, workspaceIdentity, hooksService, authorityKey) => {
    const normalizedIdentity = workspaceIdentity?.trim() || null;
    const normalizedAuthorityKey = authorityKey?.trim() || null;
    set({
      workspacePath: workspacePath ?? null,
      workspaceIdentity: normalizedIdentity,
      authorityKey: normalizedAuthorityKey,
    });
    if (!workspacePath) {
      set({ hooks: [], loading: false, loadedWorkspaceKey: null });
      return;
    }
    const key = getHooksCacheKey(workspacePath, normalizedIdentity, normalizedAuthorityKey);
    if (get().loadedWorkspaceKey !== key) {
      set({ hooks: [], loadedWorkspaceKey: null });
    }
    const existing = inflightLoads.get(key);
    if (existing) {
      await existing;
      return;
    }
    const promise = (async () => {
      set({ loading: true, error: null });
      try {
        const result = await hooksService.loadHooks({
          workspacePath,
          ...(normalizedIdentity ? { workspaceIdentity: normalizedIdentity } : {}),
        });
        if (currentWorkspaceKey(get) !== key) return;
        set({ hooks: result.hooks, loadedWorkspaceKey: key, loading: false });
      } catch (error) {
        if (currentWorkspaceKey(get) !== key) return;
        set({ error: errorMessage(error), loading: false });
      } finally {
        inflightLoads.delete(key);
      }
    })();
    inflightLoads.set(key, promise);
    await promise;
  },

  refresh: async (hooksService, target) => {
    const targetPath = target.workspacePath ?? null;
    const targetIdentity = target.workspaceIdentity?.trim() || null;
    const targetAuthorityKey = target.authorityKey?.trim() || null;
    if (!targetPath) return;
    const key = getHooksCacheKey(targetPath, targetIdentity, targetAuthorityKey);
    if (currentWorkspaceKey(get) !== key) return;
    set({ loading: true, error: null });
    try {
      const result = await hooksService.loadHooks({
        workspacePath: targetPath,
        ...(targetIdentity ? { workspaceIdentity: targetIdentity } : {}),
      });
      if (currentWorkspaceKey(get) !== key) return;
      set({ hooks: result.hooks, loadedWorkspaceKey: key, loading: false });
    } catch (error) {
      if (currentWorkspaceKey(get) !== key) return;
      set({ error: errorMessage(error), loading: false });
    }
  },

  addHook: async (config, hooksService) => {
    const { workspacePath, hooks } = get();
    if (!workspacePath) throw new Error("No workspace path set");
    await applyHookMutation(get, set, hooksService, [
      ...hooks,
      hookFromConfig(config, workspacePath),
    ]);
  },

  updateHook: async (id, config, hooksService) => {
    const { hooks } = get();
    const target = hooks.find((hook) => hook.id === id);
    if (!target || !isEditableHook(target)) throw new Error("Hook is not editable");
    await applyHookMutation(
      get,
      set,
      hooksService,
      hooks.map((hook) => (hook.id === id ? updateHookFromConfig(hook, config) : hook)),
      id,
    );
  },

  deleteHook: async (id, hooksService) => {
    const { hooks } = get();
    const target = hooks.find((hook) => hook.id === id);
    if (!target || !isEditableHook(target)) throw new Error("Hook is not editable");
    await applyHookMutation(
      get,
      set,
      hooksService,
      hooks.filter((hook) => hook.id !== id),
      id,
    );
  },

  toggleHook: async (id, enabled, hooksService) => {
    const { hooks } = get();
    const target = hooks.find((hook) => hook.id === id);
    if (!target || !isEditableHook(target)) throw new Error("Hook is not editable");
    await applyHookMutation(
      get,
      set,
      hooksService,
      hooks.map((hook) => (hook.id === id ? { ...hook, enabled } : hook)),
      id,
    );
  },

  importHook: async (id, hooksService) => {
    const { hooks, workspacePath } = get();
    if (!workspacePath) throw new Error("No workspace path set");
    const source = hooks.find((hook) => hook.id === id);
    if (!source || source.location?.source === "cf") throw new Error("Hook is not importable");
    const imported: Hook = {
      ...source,
      id: `hook-${crypto.randomUUID()}`,
      enabled: true,
      location: buildCfHookLocation(workspacePath, source.location?.scope ?? "user"),
    };
    await applyHookMutation(get, set, hooksService, [...hooks, imported], id);
  },
}));
