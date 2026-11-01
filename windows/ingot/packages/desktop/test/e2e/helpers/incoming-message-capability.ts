import { ModelConfig, ModelPropertiesConfig } from "@origin-ai/cf-provider";
import { NodePersonalProviderConfigRepository } from "@origin-ai/cf-provider-node";
import { getE2EAppDataPaths, seedSettings } from "./desktop-app.js";
import {
  ensureUpstreamModelForE2E,
  ensureUpstreamProviderForE2E,
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
} from "./upstream-provider.js";
import { prepareV4ConversationE2E, switchV4Model } from "./v4-conversation.js";

export const INCOMING_MESSAGE_MODES = [
  { label: "MCS", mcs: true },
  { label: "non-MCS", mcs: false },
] as const;

export async function prepareIncomingMessageCapability(
  mcs: boolean,
  interactionBehavior: "guide" | "queue" = "guide",
): Promise<void> {
  await prepareV4ConversationE2E({ resetDraftBeforeProvider: true, skipProvider: true });
  await ensureUpstreamProviderForE2E({ skipToolbarSelection: true });
  await ensureUpstreamModelForE2E("claude-opus-4-8");
  await ensureUpstreamModelForE2E(UPSTREAM_MODEL);
  const repository = new NodePersonalProviderConfigRepository({
    filePath: getE2EAppDataPaths().configFile,
    pollingIntervalMs: false,
  });
  try {
    await repository.update((current) => {
      let models = current.models;
      for (const [modelId, supported] of [
        ["claude-opus-4-8", true],
        [UPSTREAM_MODEL, false],
      ] as const) {
        models = models.setExact(
          UPSTREAM_PROVIDER_ID,
          modelId,
          (models.getExact(UPSTREAM_PROVIDER_ID, modelId) ?? new ModelConfig()).overlay(
            new ModelConfig({
              properties: new ModelPropertiesConfig({ supportsMidConversationSystem: supported }),
            }),
          ),
        );
      }
      return { ...current, models };
    });
  } finally {
    repository.dispose();
  }
  await seedSettings({ cfInteractionBehavior: interactionBehavior });
  await browser.reloadSession();
  await prepareV4ConversationE2E({ resetDraftBeforeProvider: true, skipProvider: true });
  await switchIncomingMessageCapability(mcs);
}

export async function switchIncomingMessageCapability(mcs: boolean): Promise<void> {
  await switchV4Model(UPSTREAM_PROVIDER_ID, mcs ? "claude-opus-4-8" : UPSTREAM_MODEL, "");
}
