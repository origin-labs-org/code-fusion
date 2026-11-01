//
import { logger } from "@/logger.js";
import {
  modelSelectionSchema,
  remoteHostIdFromWorkspaceIdentity,
  type ModelSelection,
} from "@origin-ai/cf-shared";
import { submissionModeSchema, type SubmissionMode } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { ComposerMentionPrefill } from "@/store/cfSessionStoreTypes.js";

export interface V4ComposerDraft {
  text: string;
  
  projectId?: string | null;
  taskGroupId?: string | null;
  editorStateJson?: string;
  mention?: ComposerMentionPrefill;
  
  mode?: SubmissionMode;
  planEnabled?: boolean;
  modelSelection?: ModelSelection;
  updatedAt: number;
}

interface V4DraftFile {
  version: 1;
  legacyClaimed?: boolean;
  scopes: Record<string, V4ComposerDraft>;
}

const STORAGE_KEY_PREFIX = "cf-v4-composer-drafts:v1:";
export interface ComposerScope {
  clientNamespace: string;
  hostId: string;
  projectId: string | null;
}

export function composerScopeKey(scope: ComposerScope): string {
  return JSON.stringify([scope.clientNamespace, scope.hostId, scope.projectId]);
}

export interface PendingTaskDraft {
  draftId: string;
  workspacePath?: string;
  commandId?: string;
  sessionId?: string | null;
}

function pendingTaskKey(scope: ComposerScope): string {
  return `cf-pending-task-draft:v1:${composerScopeKey(scope)}`;
}
export function readPendingTaskDraft(scope: ComposerScope): PendingTaskDraft | null {
  try {
    const raw = getStorage()?.getItem(pendingTaskKey(scope));
    const value = raw ? JSON.parse(raw) : null;
    return value &&
      typeof value.draftId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.draftId) &&
      (value.workspacePath === undefined || typeof value.workspacePath === "string") &&
      (value.commandId === undefined || typeof value.commandId === "string") &&
      (value.sessionId == null || typeof value.sessionId === "string")
      ? value
      : null;
  } catch {
    return null;
  }
}
function writePendingTaskDraft(scope: ComposerScope, value: PendingTaskDraft | null): void {
  const storage = getStorage();
  if (!storage) throw new Error("composer.draft-storage-unavailable");
  if (value) storage.setItem(pendingTaskKey(scope), JSON.stringify(value));
  else storage.removeItem(pendingTaskKey(scope));
}
export function ensurePendingTaskDraft(scope: ComposerScope): PendingTaskDraft {
  const current = readPendingTaskDraft(scope);
  if (current) return current;
  const next = { draftId: crypto.randomUUID() };
  writePendingTaskDraft(scope, next);
  return next;
}
export function bindPendingTaskDraft(
  scope: ComposerScope,
  draftId: string,
  workspacePath: string,
): void {
  const current = readPendingTaskDraft(scope);
  if (current?.draftId === draftId && current.workspacePath !== workspacePath)
    writePendingTaskDraft(scope, { ...current, workspacePath });
}
export function completePendingTaskDraft(scope: ComposerScope, draftId: string): void {
  if (readPendingTaskDraft(scope)?.draftId === draftId) writePendingTaskDraft(scope, null);
}
export function markPendingTaskDraftCommand(
  scope: ComposerScope,
  draftId: string,
  commandId: string,
  sessionId: string | null,
): void {
  const current = readPendingTaskDraft(scope);
  if (current?.draftId !== draftId) return;
  if (current.commandId && current.commandId !== commandId)
    throw new Error("composer.draft-submission-pending");
  writePendingTaskDraft(scope, { ...current, commandId, sessionId });
}
export function releasePendingTaskDraftCommand(
  scope: ComposerScope,
  draftId: string,
  commandId: string,
): void {
  const current = readPendingTaskDraft(scope);
  if (current?.draftId !== draftId || current.commandId !== commandId) return;
  writePendingTaskDraft(scope, { draftId, workspacePath: current.workspacePath });
}

export function resolveComposerScope(
  projectId: string | null | undefined,
  workspaceIdentity?: string,
  clientNamespace = "desktop",
): ComposerScope {
  return {
    clientNamespace,
    hostId: workspaceIdentity
      ? (remoteHostIdFromWorkspaceIdentity(workspaceIdentity) ?? workspaceIdentity)
      : "local",
    projectId: projectId ?? null,
  };
}

function workspaceScopeKey(
  path: string,
  identity: string | undefined,
  clientNamespace: string,
): string {
  return `cf-composer-workspace-scope:v1:${JSON.stringify([clientNamespace, identity?.trim() || path])}`;
}
export function rememberComposerWorkspaceScope(
  path: string,
  identity: string | undefined,
  scope: ComposerScope,
): void {
  try {
    getStorage()?.setItem(
      workspaceScopeKey(path, identity, scope.clientNamespace),
      JSON.stringify(scope),
    );
  } catch (error) {
    warnStorageFailure(workspaceScopeKey(path, identity, scope.clientNamespace), error);
  }
}
export function readComposerWorkspaceScope(
  path: string,
  identity: string | undefined,
  clientNamespace = "desktop",
): ComposerScope | undefined {
  try {
    const raw = getStorage()?.getItem(workspaceScopeKey(path, identity, clientNamespace));
    const value = raw ? JSON.parse(raw) : null;
    if (
      value?.clientNamespace === clientNamespace &&
      value.hostId === resolveComposerScope(null, identity, clientNamespace).hostId &&
      (value.projectId === null || typeof value.projectId === "string")
    )
      return value;
  } catch {
    
  }
  return undefined;
}

function draftStorageKey(
  path: string,
  identity: string | undefined,
  scopeId: string,
  scope?: ComposerScope,
): string {
  return scopeId === V4_DRAFT_SCOPE_ROOT && scope
    ? `cf-v4-composer-project-drafts:v1:${composerScopeKey(scope)}`
    : getV4ComposerDraftStorageKey(path, identity);
}
export const V4_DRAFT_SCOPE_ROOT = "__draft__";
const warnedStorageKeys = new Set<string>();

function warnStorageFailure(key: string, error: unknown) {
  if (warnedStorageKeys.has(key)) return;
  warnedStorageKeys.add(key);
  logger.warn("[v4-composer-draft] 草稿持久化访问失败", {
    error: error instanceof Error ? error.message : String(error),
    key,
  });
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getV4ComposerDraftStorageKey(
  workspacePath: string,
  workspaceIdentity?: string,
): string {
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceKey)}`;
}

function readDraftFile(key: string): V4DraftFile {
  const storage = getStorage();
  try {
    const raw = storage?.getItem(key);
    if (!raw) return { version: 1, scopes: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.scopes)) {
      return { version: 1, scopes: {} };
    }
    const scopes = Object.fromEntries(
      Object.entries(parsed.scopes).flatMap(([scopeId, value]) => {
        const draft = readDraft(value);
        return draft ? [[scopeId, draft]] : [];
      }),
    );
    const file: V4DraftFile = {
      version: 1,
      scopes,
      ...(parsed.legacyClaimed === true ? { legacyClaimed: true } : {}),
    };
    return file;
  } catch (error) {
    warnStorageFailure(key, error);
    return { version: 1, scopes: {} };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDraft(value: unknown): V4ComposerDraft | null {
  if (!isRecord(value) || typeof value.text !== "string" || !value.text.trim()) return null;
  const mode = submissionModeSchema.safeParse(value.mode);
  const selection = modelSelectionSchema.safeParse(value.modelSelection);
  const identity = isRecord(value.modelSelection)
    ? modelSelectionSchema.safeParse({
        providerId: value.modelSelection.providerId,
        modelId: value.modelSelection.modelId,
      })
    : null;
  const modelSelection = selection.success
    ? selection.data
    : identity?.success
      ? identity.data
      : undefined;
  const mention = value.mention;
  const hasMention =
    isRecord(mention) &&
    ["id", "category", "label", "value", "markdown"].every(
      (key) => typeof mention[key] === "string",
    ) &&
    ["files", "skills", "commands", "subagents", "whiteboards", "sessions", "plugins"].includes(
      String(mention.category),
    );
  return {
    text: value.text,
    ...(value.taskGroupId === null || typeof value.taskGroupId === "string"
      ? { taskGroupId: value.taskGroupId as string | null }
      : {}),
    ...(value.projectId === null || (typeof value.projectId === "string" && value.projectId.trim())
      ? { projectId: value.projectId as string | null }
      : {}),
    ...(typeof value.editorStateJson === "string"
      ? { editorStateJson: value.editorStateJson }
      : {}),
    ...(hasMention ? { mention: mention as unknown as ComposerMentionPrefill } : {}),
    ...(mode.success ? { mode: mode.data === "plan" ? ("build" as const) : mode.data } : {}),
    ...(typeof value.planEnabled === "boolean"
      ? { planEnabled: value.planEnabled }
      : mode.success
        ? { planEnabled: mode.data === "plan" }
        : {}),
    ...(modelSelection ? { modelSelection } : {}),
    updatedAt:
      typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
  };
}

function writeDraftFile(key: string, file: V4DraftFile) {
  const storage = getStorage();
  if (!storage) {
    return false;
  }
  try {
    const serialized =
      Object.keys(file.scopes).length || file.legacyClaimed ? JSON.stringify(file) : null;
    if (storage.getItem(key) === serialized) return true;
    if (serialized === null) storage.removeItem(key);
    else storage.setItem(key, serialized);
    warnedStorageKeys.delete(key);
    return true;
  } catch (error) {
    warnStorageFailure(key, error);
    return false;
  }
}

export function readV4ComposerDraft(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  scopeId: string,
  scope?: ComposerScope,
): V4ComposerDraft | null {
  const key = draftStorageKey(workspacePath, workspaceIdentity, scopeId, scope);
  const file = readDraftFile(key);
  const draft = file.scopes[scopeId];
  if (!draft || typeof draft.text !== "string") {
    if (!file.legacyClaimed && scopeId === V4_DRAFT_SCOPE_ROOT && scope?.projectId) {
      const legacy = readDraftFile(getV4ComposerDraftStorageKey(workspacePath, workspaceIdentity))
        .scopes[scopeId];
      if (legacy?.projectId === scope.projectId) return legacy;
    }
    return null;
  }
  return draft;
}

export function persistV4ComposerDraft(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  scopeId: string,
  draft: Omit<V4ComposerDraft, "updatedAt">,
  scope?: ComposerScope,
) {
  const key = draftStorageKey(workspacePath, workspaceIdentity, scopeId, scope);
  const file = readDraftFile(key);
  const hadDraft = Boolean(file.scopes[scopeId]);
  const savedGroupId = file.scopes[scopeId]?.taskGroupId;
  const savedProjectId = file.scopes[scopeId]?.projectId;
  const next = {
    ...draft,
    ...(draft.taskGroupId === undefined && savedGroupId !== undefined
      ? { taskGroupId: savedGroupId }
      : {}),
    ...(draft.projectId === undefined && savedProjectId !== undefined
      ? { projectId: savedProjectId }
      : {}),
  };
  if (scopeId !== V4_DRAFT_SCOPE_ROOT) {
    delete next.projectId;
    delete next.taskGroupId;
  }
  if (!next.text.trim()) {
    delete file.scopes[scopeId];
  } else {
    file.scopes[scopeId] = { ...next, updatedAt: Date.now() };
  }
  if (
    scopeId === V4_DRAFT_SCOPE_ROOT &&
    scope?.projectId &&
    (hadDraft ||
      Boolean(file.scopes[scopeId]) ||
      readDraftFile(getV4ComposerDraftStorageKey(workspacePath, workspaceIdentity)).scopes[scopeId]
        ?.projectId === scope.projectId)
  )
    file.legacyClaimed = true;
  return writeDraftFile(key, file);
}

export function clearV4ComposerDraftTaskGroup(
  workspacePath: string,
  workspaceIdentity?: string,
  scope?: ComposerScope,
) {
  const key = draftStorageKey(workspacePath, workspaceIdentity, V4_DRAFT_SCOPE_ROOT, scope);
  const file = readDraftFile(key);
  const draft = readV4ComposerDraft(workspacePath, workspaceIdentity, V4_DRAFT_SCOPE_ROOT, scope);
  if (!draft || draft.taskGroupId === undefined) return true;
  delete draft.taskGroupId;
  file.scopes[V4_DRAFT_SCOPE_ROOT] = draft;
  if (scope?.projectId) file.legacyClaimed = true;
  return writeDraftFile(key, file);
}

export function clearV4ComposerDraft(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  scopeId: string,
  scope?: ComposerScope,
) {
  const key = draftStorageKey(workspacePath, workspaceIdentity, scopeId, scope);
  const file = readDraftFile(key);
  const hadDraft = Boolean(file.scopes[scopeId]);
  delete file.scopes[scopeId];
  if (
    scopeId === V4_DRAFT_SCOPE_ROOT &&
    scope?.projectId &&
    (hadDraft ||
      Boolean(file.scopes[scopeId]) ||
      readDraftFile(getV4ComposerDraftStorageKey(workspacePath, workspaceIdentity)).scopes[scopeId]
        ?.projectId === scope.projectId)
  )
    file.legacyClaimed = true;
  return writeDraftFile(key, file);
}
