import { create } from "zustand";
import {
  normalizeAgentProviderToCfAgent,
  CF_AGENT_PROVIDER,
  type CfProvider,
  type SkillSummary,
  type SkillsCapability,
} from "@origin-ai/cf-shared";
import type { ISkillsService } from "@origin-ai/cf-services";
import { shouldExposeE2EStoreBridge } from "@/lib/e2eStoreBridge.js";
import { logger } from "@/logger.js";
import { getServiceAuthorityId } from "@/store/serviceAuthorityKey.js";

interface SkillStoreState {
  workspacePath: string | null;
  workspaceIdentity: string | null;
  loadedWorkspacePath: string | null;
  loadedWorkspaceIdentity: string | null;
  provider: CfProvider;
  loadedProvider: CfProvider | null;
  skills: SkillSummary[];
  capability: SkillsCapability | null;
  loading: boolean;
  error: string | null;
  initialize: (
    workspacePath: string,
    providerOrSkillsService: CfProvider | ISkillsService,
    maybeSkillsService?: ISkillsService,
    workspaceIdentity?: string,
  ) => Promise<void>;
  refresh: (skillsService: ISkillsService, workspaceIdentity?: string) => Promise<void>;
  setEnabled: (
    skillId: string,
    providerOrEnabled: CfProvider | boolean,
    scopeOrSkillsService: SkillSummary["scope"] | ISkillsService,
    enabledOrSkillsService?: boolean | ISkillsService,
    maybeSkillsService?: ISkillsService,
    workspaceIdentity?: string,
  ) => Promise<void>;
}

const inFlightSkillLoads = new Map<string, ReturnType<ISkillsService["list"]>>();
let activeSkillProjectionKey: string | null = null;
let loadedSkillServiceAuthorityId: number | null = null;
function getSkillLoadKey(
  workspacePath: string,
  provider: CfProvider,
  skillsService: ISkillsService,
  workspaceIdentity?: string,
): string {
  return `${getServiceAuthorityId(skillsService)}::${workspaceIdentity?.trim() || workspacePath}::${provider}`;
}

function loadSkillsOnce(
  workspacePath: string,
  provider: CfProvider,
  skillsService: ISkillsService,
  workspaceIdentity?: string,
  options: { bypassCache?: boolean } = {},
): ReturnType<ISkillsService["list"]> {
  const key = getSkillLoadKey(workspacePath, provider, skillsService, workspaceIdentity);
  if (!options.bypassCache) {
    const current = inFlightSkillLoads.get(key);
    if (current) {
      return current;
    }
  }
  const request = skillsService.list({ workspacePath, workspaceIdentity, provider }).finally(() => {
    if (inFlightSkillLoads.get(key) === request) {
      inFlightSkillLoads.delete(key);
    }
  });
  inFlightSkillLoads.set(key, request);
  return request;
}

export const useSkillStore = create<SkillStoreState>((set, get) => ({
  workspacePath: null,
  workspaceIdentity: null,
  loadedWorkspacePath: null,
  loadedWorkspaceIdentity: null,
  provider: CF_AGENT_PROVIDER,
  loadedProvider: null,
  skills: [],
  capability: null,
  loading: false,
  error: null,
  async initialize(
    workspacePath: string,
    providerOrSkillsService: CfProvider | ISkillsService,
    maybeSkillsService?: ISkillsService,
    workspaceIdentity?: string,
  ) {
    const currentState = get();
    const hasProvider = typeof providerOrSkillsService === "string";
    const provider = normalizeAgentProviderToCfAgent(
      hasProvider ? providerOrSkillsService : CF_AGENT_PROVIDER,
    );
    const skillsService = hasProvider ? maybeSkillsService : providerOrSkillsService;
    const normalizedWorkspaceIdentity = workspaceIdentity?.trim() || null;
    if (!skillsService) {
      set({
        workspacePath,
        workspaceIdentity: normalizedWorkspaceIdentity,
        provider,
        loading: false,
        error: "skillsService is required",
        loadedWorkspacePath: workspacePath,
        loadedWorkspaceIdentity: normalizedWorkspaceIdentity,
        loadedProvider: provider,
      });
      return;
    }
    const serviceAuthorityId = getServiceAuthorityId(skillsService);
    const projectionKey = `${serviceAuthorityId}::${normalizedWorkspaceIdentity || workspacePath}::${provider}`;
    activeSkillProjectionKey = projectionKey;
    const hasCachedSkills =
      currentState.skills.length > 0 &&
      loadedSkillServiceAuthorityId === serviceAuthorityId &&
      currentState.loadedWorkspacePath === workspacePath &&
      currentState.loadedWorkspaceIdentity === normalizedWorkspaceIdentity &&
      currentState.loadedProvider === provider;
    set({
      workspacePath,
      workspaceIdentity: normalizedWorkspaceIdentity,
      provider,
      skills: hasCachedSkills ? currentState.skills : [],
      capability: hasCachedSkills ? currentState.capability : null,
      loading: !hasCachedSkills,
      error: null,
    });
    try {
      const result = await loadSkillsOnce(
        workspacePath,
        provider,
        skillsService,
        normalizedWorkspaceIdentity ?? undefined,
      );
      if (activeSkillProjectionKey !== projectionKey) return;
      loadedSkillServiceAuthorityId = serviceAuthorityId;
      set({
        skills: result.skills,
        capability: result.capability,
        loading: false,
        loadedWorkspacePath: workspacePath,
        loadedWorkspaceIdentity: normalizedWorkspaceIdentity,
        loadedProvider: provider,
      });
    } catch (error) {
      if (activeSkillProjectionKey !== projectionKey) return;
      logger.error("[skills] initialize failed", {
        workspacePath,
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        loadedWorkspacePath: workspacePath,
        loadedWorkspaceIdentity: normalizedWorkspaceIdentity,
        loadedProvider: provider,
      });
    }
  },
  async refresh(skillsService: ISkillsService, workspaceIdentity?: string) {
    const workspacePath = get().workspacePath;
    if (!workspacePath) {
      return;
    }
    const workspaceIdentityFromState =
      workspaceIdentity?.trim() || get().workspaceIdentity || undefined;
    const provider = normalizeAgentProviderToCfAgent(get().provider);
    const serviceAuthorityId = getServiceAuthorityId(skillsService);
    const projectionKey = `${serviceAuthorityId}::${workspaceIdentityFromState || workspacePath}::${provider}`;
    activeSkillProjectionKey = projectionKey;
    const hasCachedSkills =
      get().skills.length > 0 && loadedSkillServiceAuthorityId === serviceAuthorityId;
    set({
      skills: hasCachedSkills ? get().skills : [],
      capability: hasCachedSkills ? get().capability : null,
      loading: !hasCachedSkills,
      error: null,
    });
    inFlightSkillLoads.delete(
      getSkillLoadKey(workspacePath, provider, skillsService, workspaceIdentityFromState),
    );
    try {
      const result = await loadSkillsOnce(
        workspacePath,
        provider,
        skillsService,
        workspaceIdentityFromState,
      );
      if (activeSkillProjectionKey !== projectionKey) return;
      loadedSkillServiceAuthorityId = serviceAuthorityId;
      set({
        skills: result.skills,
        capability: result.capability,
        loading: false,
        loadedWorkspacePath: workspacePath,
        loadedWorkspaceIdentity: workspaceIdentityFromState ?? null,
        loadedProvider: provider,
      });
    } catch (error) {
      if (activeSkillProjectionKey !== projectionKey) return;
      logger.error("[skills] refresh failed", {
        workspacePath,
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        loadedWorkspacePath: workspacePath,
        loadedWorkspaceIdentity: workspaceIdentityFromState ?? null,
        loadedProvider: provider,
      });
    }
  },
  async setEnabled(
    skillId: string,
    providerOrEnabled: CfProvider | boolean,
    scopeOrSkillsService: SkillSummary["scope"] | ISkillsService,
    enabledOrSkillsService?: boolean | ISkillsService,
    maybeSkillsService?: ISkillsService,
    workspaceIdentity?: string,
  ) {
    const workspacePath = get().workspacePath;
    if (!workspacePath) {
      return;
    }
    const workspaceIdentityFromState =
      workspaceIdentity?.trim() || get().workspaceIdentity || undefined;
    const legacyCall = typeof providerOrEnabled === "boolean";
    const provider = normalizeAgentProviderToCfAgent(
      legacyCall ? get().provider : providerOrEnabled,
    );
    const scope = legacyCall ? undefined : (scopeOrSkillsService as SkillSummary["scope"]);
    const enabled = legacyCall ? providerOrEnabled : (enabledOrSkillsService as boolean);
    const skillsService = legacyCall
      ? (scopeOrSkillsService as ISkillsService)
      : maybeSkillsService;
    if (!skillsService) {
      set({ error: "skillsService is required" });
      return;
    }
    try {
      await skillsService.setEnabled({
        workspacePath,
        workspaceIdentity: workspaceIdentityFromState,
        provider,
        ...(scope ? { scope } : {}),
        skillId,
        enabled,
      });
      await get().refresh(skillsService, workspaceIdentityFromState);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));

type SkillStoreE2EBridge = typeof useSkillStore;

declare global {
  interface Window {
    __skillStoreE2E?: SkillStoreE2EBridge;
  }
}

if (shouldExposeE2EStoreBridge()) {
  window.__skillStoreE2E = useSkillStore;
}
