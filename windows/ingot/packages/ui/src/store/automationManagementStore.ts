
import { create } from "zustand";
import {
  AUTOMATION_CREATE_LIMIT,
  AUTOMATION_CREATE_LIMIT_ERROR_CODE,
  isAutomationCreateLimitError,
  type CfAutomation,
  type CfAutomationRun,
  type CfAutomationScheduleRule,
  type ModelSelection,
} from "@origin-ai/cf-shared";
import type { ICfAgentService } from "@origin-ai/cf-services";
import { logger } from "@/logger.js";

export interface AutomationRunsEntry {
  status: "loading" | "loaded" | "error";
  runs?: CfAutomationRun[];
  error?: string;
}

export type AutomationRunNowResult = "queued" | "duplicate" | "failed";

export interface CreateAutomationInput {
  projectId?: string | null;
  title: string;
  cronExpr: string;
  prompt: string;
  modelSelection?: ModelSelection;
  mode?: string;
  recurring?: boolean;
  maxRuns?: number;
  endAt?: number;
  scheduleRule?: CfAutomationScheduleRule;
  workspacePath?: string;
  workspaceIdentity?: string;
}

export interface UpdateAutomationInput {
  title?: string;
  cronExpr?: string;
  prompt?: string;
  modelSelection?: ModelSelection | null;
  mode?: string | null;
  recurring?: boolean;
  maxRuns?: number | null;
  endAt?: number | null;
  scheduleRule?: CfAutomationScheduleRule | null;
  scheduleEditedByUser?: boolean;
}

export interface AutomationManagementState {
  workspacePath: string | null;
  workspaceIdentity: string | null;
  automations: CfAutomation[];
  loading: boolean;
  error: string | null;
  operationId: string | null;
  runsCache: Record<string, AutomationRunsEntry>;
  initialize: (params: {
    workspacePath: string;
    workspaceIdentity?: string;
    agentService: ICfAgentService;
  }) => Promise<void>;
  refresh: (agentService: ICfAgentService) => Promise<void>;
  createAutomation: (
    input: CreateAutomationInput,
    agentService: ICfAgentService,
  ) => Promise<CfAutomation | null>;
  updateAutomation: (
    automationId: string,
    input: UpdateAutomationInput,
    agentService: ICfAgentService,
  ) => Promise<boolean>;
  deleteAutomation: (automationId: string, agentService: ICfAgentService) => Promise<void>;
  setEnabled: (
    automationId: string,
    enabled: boolean,
    agentService: ICfAgentService,
  ) => Promise<void>;
  restartAutomation: (automationId: string, agentService: ICfAgentService) => Promise<void>;
  
  runAutomationNow: (
    automationId: string,
    agentService: ICfAgentService,
  ) => Promise<AutomationRunNowResult>;
  loadRuns: (
    automationId: string,
    agentService: ICfAgentService,
    force?: boolean,
  ) => Promise<void>;
  deleteRun: (
    automationId: string,
    runId: string,
    agentService: ICfAgentService,
  ) => Promise<void>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let automationLoadSeq = 0;
const inFlightRunNowAutomationIds = new Set<string>();

function sameWorkspace(
  current: Pick<AutomationManagementState, "workspacePath" | "workspaceIdentity">,
  workspacePath: string,
  workspaceIdentity: string | null,
): boolean {
  return current.workspacePath === workspacePath && current.workspaceIdentity === workspaceIdentity;
}

function resolveAutomationActionScope(
  state: Pick<AutomationManagementState, "automations" | "workspacePath" | "workspaceIdentity">,
  automationId: string,
): { workspacePath: string; workspaceIdentity: string | null } | null {
  const automation = state.automations.find((candidate) => candidate.automationId === automationId);
  const workspacePath = automation?.workspacePath ?? state.workspacePath;
  if (!workspacePath) return null;
  return {
    workspacePath,
    workspaceIdentity: automation?.workspaceIdentity ?? state.workspaceIdentity,
  };
}

async function loadInto(
  set: (partial: Partial<AutomationManagementState>) => void,
  get: () => AutomationManagementState,
  params: {
    workspacePath: string;
    workspaceIdentity: string | null;
    agentService: ICfAgentService;
    requestId: number;
  },
): Promise<void> {
  const { workspacePath, workspaceIdentity, agentService, requestId } = params;
  try {
    const automations = await agentService.listAllAutomations();
    if (
      requestId !== automationLoadSeq ||
      !sameWorkspace(get(), workspacePath, workspaceIdentity)
    ) {
      return;
    }
    set({ automations, loading: false });
  } catch (error) {
    if (
      requestId !== automationLoadSeq ||
      !sameWorkspace(get(), workspacePath, workspaceIdentity)
    ) {
      return;
    }
    logger.error("[automations] load failed", {
      workspacePath,
      error: toMessage(error),
    });
    set({ error: toMessage(error), loading: false });
  }
}

export const useAutomationManagementStore = create<AutomationManagementState>((set, get) => ({
  workspacePath: null,
  workspaceIdentity: null,
  automations: [],
  loading: false,
  error: null,
  operationId: null,
  runsCache: {},

  async initialize({ workspacePath, workspaceIdentity, agentService }) {
    const normalizedIdentity = workspaceIdentity?.trim() || null;
    const requestId = ++automationLoadSeq;
    const current = get();
    const hasCache =
      current.automations.length > 0 &&
      current.workspacePath === workspacePath &&
      current.workspaceIdentity === normalizedIdentity;
    set({
      workspacePath,
      workspaceIdentity: normalizedIdentity,
      loading: !hasCache,
      error: null,
      operationId: null,
      automations: hasCache ? current.automations : [],
      ...(hasCache ? {} : { runsCache: {} }),
    });
    await loadInto(set, get, {
      workspacePath,
      workspaceIdentity: normalizedIdentity,
      agentService,
      requestId,
    });
  },

  async refresh(agentService) {
    const { workspacePath, workspaceIdentity } = get();
    if (!workspacePath) return;
    const requestId = ++automationLoadSeq;
    set({ error: null });
    await loadInto(set, get, {
      workspacePath,
      workspaceIdentity,
      agentService,
      requestId,
    });
  },

  async createAutomation(input, agentService) {
    const { automations, workspacePath, workspaceIdentity } = get();
    if (!workspacePath) return null;
    if (automations.length >= AUTOMATION_CREATE_LIMIT) {
      set({
        error: `[${AUTOMATION_CREATE_LIMIT_ERROR_CODE}] automation limit reached`,
      });
      return null;
    }
    set({ operationId: `automation:create:${input.title}`, error: null });
    try {
      const created = await agentService.createAutomation({
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...input,
      });
      const requestId = ++automationLoadSeq;
      await loadInto(set, get, {
        workspacePath,
        workspaceIdentity,
        agentService,
        requestId,
      });
      return created;
    } catch (error) {
      const message = toMessage(error);
      if (isAutomationCreateLimitError(error)) {
        logger.warn("[automations] create blocked by limit", {
          limit: AUTOMATION_CREATE_LIMIT,
        });
      } else {
        logger.error("[automations] create failed", { error: message });
      }
      set({ error: message });
      return null;
    } finally {
      set({ operationId: null });
    }
  },

  async updateAutomation(automationId, input, agentService) {
    const state = get();
    const viewWorkspacePath = state.workspacePath;
    if (!viewWorkspacePath) return false;
    const actionScope = resolveAutomationActionScope(state, automationId);
    if (!actionScope) return false;
    set({ operationId: `automation:update:${automationId}`, error: null });
    try {
      await agentService.updateAutomation({
        workspacePath: actionScope.workspacePath,
        ...(actionScope.workspaceIdentity
          ? { workspaceIdentity: actionScope.workspaceIdentity }
          : {}),
        automationId,
        ...input,
      });
      const requestId = ++automationLoadSeq;
      await loadInto(set, get, {
        workspacePath: viewWorkspacePath,
        workspaceIdentity: state.workspaceIdentity,
        agentService,
        requestId,
      });
      return true;
    } catch (error) {
      logger.error("[automations] update failed", {
        automationId,
        error: toMessage(error),
      });
      set({ error: toMessage(error) });
      return false;
    } finally {
      set({ operationId: null });
    }
  },

  async deleteAutomation(automationId, agentService) {
    const state = get();
    const viewWorkspacePath = state.workspacePath;
    if (!viewWorkspacePath) return;
    const actionScope = resolveAutomationActionScope(state, automationId);
    if (!actionScope) return;
    set({ operationId: `automation:delete:${automationId}`, error: null });
    try {
      await agentService.deleteAutomation({
        workspacePath: actionScope.workspacePath,
        ...(actionScope.workspaceIdentity
          ? { workspaceIdentity: actionScope.workspaceIdentity }
          : {}),
        automationId,
      });
      const requestId = ++automationLoadSeq;
      await loadInto(set, get, {
        workspacePath: viewWorkspacePath,
        workspaceIdentity: state.workspaceIdentity,
        agentService,
        requestId,
      });
    } catch (error) {
      logger.error("[automations] delete failed", {
        automationId,
        error: toMessage(error),
      });
      set({ error: toMessage(error) });
    } finally {
      set({ operationId: null });
    }
  },

  async setEnabled(automationId, enabled, agentService) {
    const state = get();
    const viewWorkspacePath = state.workspacePath;
    if (!viewWorkspacePath) return;
    const actionScope = resolveAutomationActionScope(state, automationId);
    if (!actionScope) return;
    set({
      operationId: `automation:setEnabled:${automationId}`,
      error: null,
    });
    try {
      await agentService.setAutomationEnabled({
        workspacePath: actionScope.workspacePath,
        ...(actionScope.workspaceIdentity
          ? { workspaceIdentity: actionScope.workspaceIdentity }
          : {}),
        automationId,
        enabled,
      });
      set({
        automations: get().automations.map((automation) =>
          automation.automationId === automationId
            ? {
                ...automation,
                enabled,
                lifecycleStatus: enabled ? "active" : "paused",
              }
            : automation,
        ),
      });
      const requestId = ++automationLoadSeq;
      await loadInto(set, get, {
        workspacePath: viewWorkspacePath,
        workspaceIdentity: state.workspaceIdentity,
        agentService,
        requestId,
      });
    } catch (error) {
      logger.error("[automations] setEnabled failed", {
        automationId,
        enabled,
        error: toMessage(error),
      });
      set({ error: toMessage(error) });
    } finally {
      set({ operationId: null });
    }
  },

  async restartAutomation(automationId, agentService) {
    const state = get();
    const viewWorkspacePath = state.workspacePath;
    if (!viewWorkspacePath) return;
    const actionScope = resolveAutomationActionScope(state, automationId);
    if (!actionScope) return;
    set({ operationId: `automation:restart:${automationId}`, error: null });
    try {
      await agentService.restartAutomation({
        workspacePath: actionScope.workspacePath,
        ...(actionScope.workspaceIdentity
          ? { workspaceIdentity: actionScope.workspaceIdentity }
          : {}),
        automationId,
      });
      const requestId = ++automationLoadSeq;
      await loadInto(set, get, {
        workspacePath: viewWorkspacePath,
        workspaceIdentity: state.workspaceIdentity,
        agentService,
        requestId,
      });
    } catch (error) {
      logger.error("[automations] restart failed", {
        automationId,
        error: toMessage(error),
      });
      set({ error: toMessage(error) });
    } finally {
      set({ operationId: null });
    }
  },

  async runAutomationNow(automationId, agentService) {
    const state = get();
    const viewWorkspacePath = state.workspacePath;
    if (!viewWorkspacePath) return "failed";
    const actionScope = resolveAutomationActionScope(state, automationId);
    if (!actionScope) return "failed";
    if (inFlightRunNowAutomationIds.has(automationId)) {
      return "duplicate";
    }
    inFlightRunNowAutomationIds.add(automationId);
    set({ operationId: `automation:runNow:${automationId}`, error: null });
    try {
      const result = await agentService.runAutomationNow({
        workspacePath: actionScope.workspacePath,
        ...(actionScope.workspaceIdentity
          ? { workspaceIdentity: actionScope.workspaceIdentity }
          : {}),
        automationId,
      });
      if (result.status === "duplicate") {
        return "duplicate";
      }
      const requestId = ++automationLoadSeq;
      await loadInto(set, get, {
        workspacePath: viewWorkspacePath,
        workspaceIdentity: state.workspaceIdentity,
        agentService,
        requestId,
      });
      return "queued";
    } catch (error) {
      logger.error("[automations] runNow failed", {
        automationId,
        error: toMessage(error),
      });
      set({ error: toMessage(error) });
      return "failed";
    } finally {
      inFlightRunNowAutomationIds.delete(automationId);
      set({ operationId: null });
    }
  },

  async loadRuns(automationId, agentService, force = false) {
    const state = get();
    const viewWorkspacePath = state.workspacePath;
    if (!viewWorkspacePath) return;
    const actionScope = resolveAutomationActionScope(state, automationId);
    if (!actionScope) return;
    const { runsCache } = state;
    const cached = runsCache[automationId];
    if (!force && cached && cached.status !== "error") return;
    set({
      runsCache: {
        ...get().runsCache,
        [automationId]: { status: "loading" },
      },
    });
    try {
      const runs = await agentService.listAutomationRuns({
        workspacePath: actionScope.workspacePath,
        ...(actionScope.workspaceIdentity
          ? { workspaceIdentity: actionScope.workspaceIdentity }
          : {}),
        automationId,
      });
      if (!sameWorkspace(get(), viewWorkspacePath, state.workspaceIdentity)) {
        return;
      }
      set({
        runsCache: {
          ...get().runsCache,
          [automationId]: { status: "loaded", runs },
        },
      });
    } catch (error) {
      if (!sameWorkspace(get(), viewWorkspacePath, state.workspaceIdentity)) {
        return;
      }
      logger.error("[automations] load runs failed", {
        automationId,
        error: toMessage(error),
      });
      set({
        runsCache: {
          ...get().runsCache,
          [automationId]: { status: "error", error: toMessage(error) },
        },
      });
    }
  },

  async deleteRun(automationId, runId, agentService) {
    const state = get();
    const actionScope = resolveAutomationActionScope(state, automationId);
    if (!actionScope) return;
    set({ operationId: `automation:deleteRun:${runId}`, error: null });
    try {
      await agentService.deleteAutomationRun({
        workspacePath: actionScope.workspacePath,
        ...(actionScope.workspaceIdentity
          ? { workspaceIdentity: actionScope.workspaceIdentity }
          : {}),
        runId,
      });
      await get().loadRuns(automationId, agentService, true);
    } catch (error) {
      logger.error("[automations] delete run failed", {
        runId,
        error: toMessage(error),
      });
      set({ error: toMessage(error) });
    } finally {
      set({ operationId: null });
    }
  },
}));
