import type { CollaborationMode, ModelSelection } from "@origin-ai/cf-contracts";
import type {
  CommandEnvelope,
  CommandPayloadMap,
  CommandResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { V4CommandNoopError } from "../../v4-gateway.js";
import { runSessionModelConfigMutation } from "../../model-config-mutation.js";
import { requireRecord } from "../record-access.js";
import type { V4CommandCoreHost, V4SessionRecordView } from "../types.js";

const CONFIG_UNCHANGED = "config.unchanged";

class V4ProviderNotInRegistryError extends Error {
  readonly reasonCode = "provider.notInRegistry";
  constructor(providerId: string) {
    super(`provider "${providerId}" is not in the workspace model registry`);
  }
}

async function ensureProviderClientReady(
  host: V4CommandCoreHost,
  sessionId: string,
  providerId: string,
): Promise<void> {
  if (!host.ensureProviderAvailable) return;
  const outcome = await host.ensureProviderAvailable(sessionId, providerId);
  if (!outcome.available && outcome.reason === "provider_not_in_registry") {
    throw new V4ProviderNotInRegistryError(providerId);
  }
}

function createModelSelection(provider: string, model: string, thought: string | undefined) {
  return {
    providerId: provider,
    modelId: model,
    ...(thought ? { options: { reasoningLevel: thought } } : {}),
  };
}

function readActualThought(
  record: V4SessionRecordView,
  fallbackSelection?: ModelSelection,
): string {
  const thought = record.app.getThoughtLevel();
  if (thought !== undefined) return thought;
  return fallbackSelection?.options?.reasoningLevel ?? "";
}

const SWITCHABLE_MODES: ReadonlySet<string> = new Set(["build", "edit", "plan", "yolo", "guarded"]);

async function switchModelConfig(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["switchModelConfig"];
  const record = requireRecord(host, envelope.sessionId);
  return runSessionModelConfigMutation(record.app, async () => {
    const previousSelection = record.app.runtime.getSessionModelSelection();
    const previousModelSelection =
      previousSelection &&
      createModelSelection(
        previousSelection.providerId,
        previousSelection.modelId,
        previousSelection.options?.reasoningLevel,
      );
    const previousThought = readActualThought(record, previousSelection);
    const modelIdentityChanged =
      previousSelection?.providerId !== payload.provider ||
      previousSelection?.modelId !== payload.model;
    const requestedThought = payload.thought.trim();
    const thoughtChanged =
      Boolean(requestedThought) && requestedThought !== previousSelection?.options?.reasoningLevel;
    if (!modelIdentityChanged && !thoughtChanged) {
      throw new V4CommandNoopError(CONFIG_UNCHANGED);
    }
    await ensureProviderClientReady(host, record.app.sessionId, payload.provider);
    let actualThought = previousThought;
    let nextModelSelection: ModelSelection;
    if (modelIdentityChanged) {
      const result = await record.app.setModel(`${payload.provider}/${payload.model}`);
      actualThought = result.thoughtLevel ?? readActualThought(record);
      if (requestedThought && record.app.listThoughtLevels().includes(requestedThought)) {
        const thoughtResult = await record.app.setThoughtLevel(requestedThought);
        actualThought = thoughtResult.thoughtLevel;
      }
      nextModelSelection = createModelSelection(
        payload.provider,
        payload.model,
        requestedThought && record.app.listThoughtLevels().includes(requestedThought)
          ? requestedThought
          : undefined,
      );
    } else {
      const result = await record.app.setThoughtLevel(requestedThought);
      actualThought = result.thoughtLevel;
      nextModelSelection = createModelSelection(payload.provider, payload.model, actualThought);
    }
    await record.app.runtime.emitModelSelected({
      modelSelection: nextModelSelection,
      ...(actualThought ? { effectiveReasoningLevel: actualThought } : {}),
      previousModelSelection,
      supportedThoughtLevels: record.app.listThoughtLevels(),
      traceContext: record.traceContext,
    });
    return undefined;
  });
}

async function switchCollaborationMode(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["switchCollaborationMode"];
  const record = requireRecord(host, envelope.sessionId);
  const mode = payload.mode as CollaborationMode;
  const previousMode = record.app.getMode();
  if (previousMode === mode && !record.app.runtime.getPlanEnabled()) {
    throw new V4CommandNoopError(CONFIG_UNCHANGED);
  }
  await record.app.setMode(mode);
  return undefined;
}

export async function applyRequestedSessionConfig(
  host: V4CommandCoreHost,
  record: V4SessionRecordView,
  config: NonNullable<CommandPayloadMap["createSession"]["config"]>,
): Promise<void> {
  await runSessionModelConfigMutation(record.app, async () => {
    const previousSelection = record.app.runtime.getSessionModelSelection();
    const previousModelSelection =
      previousSelection &&
      createModelSelection(
        previousSelection.providerId,
        previousSelection.modelId,
        previousSelection.options?.reasoningLevel,
      );
    const previousThought = readActualThought(record, previousSelection);
    const requestedSelection = config.modelSelection;
    const targetProvider =
      requestedSelection?.providerId ?? config.provider?.trim() ?? previousSelection?.providerId;
    const targetModel =
      requestedSelection?.modelId ?? config.model?.trim() ?? previousSelection?.modelId;
    const targetThought =
      requestedSelection?.options?.reasoningLevel ?? config.thought?.trim() ?? "";
    const modelIdentityChanged =
      targetProvider !== previousSelection?.providerId ||
      targetModel !== previousSelection?.modelId;
    const thoughtChanged =
      Boolean(targetThought) &&
      targetThought !==
        (requestedSelection ? previousSelection?.options?.reasoningLevel : previousThought);
    if (targetProvider && targetModel && (modelIdentityChanged || thoughtChanged)) {
      await ensureProviderClientReady(host, record.app.sessionId, targetProvider);
      let actualThought = previousThought;
      if (modelIdentityChanged) {
        const result = await record.app.setModel(`${targetProvider}/${targetModel}`);
        actualThought = result.thoughtLevel ?? readActualThought(record);
      }
      if (targetThought && record.app.listThoughtLevels().includes(targetThought)) {
        const result = await record.app.setThoughtLevel(targetThought);
        actualThought = result.thoughtLevel;
      } else if (requestedSelection?.options?.reasoningLevel) {
        await record.app.setThoughtLevel(targetThought);
      }
      if (modelIdentityChanged || actualThought !== previousThought) {
        await record.app.runtime.emitModelSelected({
          modelSelection: createModelSelection(
            targetProvider,
            targetModel,
            targetThought && record.app.listThoughtLevels().includes(targetThought)
              ? targetThought
              : undefined,
          ),
          ...(actualThought ? { effectiveReasoningLevel: actualThought } : {}),
          previousModelSelection,
          supportedThoughtLevels: record.app.listThoughtLevels(),
          traceContext: record.traceContext,
        });
      }
    }
  });

  const mode = config.mode;
  if ((mode && SWITCHABLE_MODES.has(mode)) || config.planEnabled !== undefined) {
    await record.app.runtime.setExecutionState(
      {
        ...(mode && SWITCHABLE_MODES.has(mode) ? { mode } : {}),
        ...(config.planEnabled !== undefined ? { planEnabled: config.planEnabled } : {}),
      },
      record.traceContext,
    );
  }

  if (config.followupMode && config.followupMode !== "queue") {
    await record.app.setFollowupMode(config.followupMode);
  }
}

export const modelConfigHandlers = { switchModelConfig, switchCollaborationMode };
