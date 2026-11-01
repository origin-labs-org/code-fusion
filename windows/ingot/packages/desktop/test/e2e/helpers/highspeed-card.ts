import {
  E2E_BIGMODEL_PLAN_PROVIDER_ID,
  E2E_PLAN_FIRST_MODEL,
  restartIntoWorkspace,
  seedBigModelConnectionSelection,
  seedBigModelOAuthCredential,
  seedHighspeedLoginCredential,
  seedPersistedModelSelection,
  waitForSelectedModel,
} from "./model-provider-restart.js";
import { skipOccupationOnboardingIfPresent } from "./occupation-onboarding.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "./v4-conversation.js";

interface HighspeedEntranceProbe {
  observer: MutationObserver;
  state: { diffusionMounted: boolean };
}

interface HighspeedComposerProbe {
  observer: MutationObserver;
  state: { highspeedSeen: boolean };
}

export interface HighspeedEntranceSnapshot {
  
  diffusionMounted: boolean | null;
  entrance: string | null;
  modelIndicatorVisible: boolean;
  phase: string | null;
}

const HIGHSPEED_E2E_MODEL = E2E_PLAN_FIRST_MODEL;

declare global {
  interface Window {
    __cfHighspeedEntranceProbe?: HighspeedEntranceProbe;
    __cfHighspeedComposerProbe?: HighspeedComposerProbe;
  }
}

export async function prepareHighspeedDrawWorkspace() {
  await skipOccupationOnboardingIfPresent();
  await prepareV4ConversationE2E({ skipProvider: true });
  await seedBigModelOAuthCredential();
  await seedHighspeedLoginCredential();
  await seedBigModelConnectionSelection({
    kind: "team-coding-plan",
    productId: "product-team-a",
    organizationId: "org-team-a",
    projectId: "proj-team-a",
  });
  await seedPersistedModelSelection({
    modelId: HIGHSPEED_E2E_MODEL,
    providerId: E2E_BIGMODEL_PLAN_PROVIDER_ID,
    reasoningLevel: "high",
  });

  await restartIntoWorkspace();
  await waitForSelectedModel(E2E_BIGMODEL_PLAN_PROVIDER_ID, HIGHSPEED_E2E_MODEL);
}

export async function sendHighspeedTurnAndWaitCompleted(prompt: string, replyToken: string) {
  if (prompt.includes(replyToken)) {
    throw new Error(`Highspeed turn prompt 不能包含ReplyLabel记 ${replyToken}`);
  }
  await sendV4Prompt(prompt);
  await waitForV4TimelineContaining(replyToken);
  await waitForV4Pane(
    (snapshot) => !snapshot.canStop && snapshot.timelineText.includes(replyToken),
    `Pane remains in running state after Highspeed mock turn completes: ${replyToken}`,
    90000,
  );
}

export async function waitForHighspeedComposer(timeoutMsg: string) {
  await browser.waitUntil(
    async () =>
      browser.execute(() => Boolean(document.querySelector('[data-highspeed-composer="true"]'))),
    { timeout: 30000, timeoutMsg },
  );
}

export async function waitForHighspeedComposerCleared(timeoutMsg: string) {
  await browser.waitUntil(
    async () => browser.execute(() => !document.querySelector('[data-highspeed-composer="true"]')),
    { timeout: 30000, timeoutMsg },
  );
}

export async function startHighspeedEntranceProbe() {
  await browser.execute(() => {
    window.__cfHighspeedEntranceProbe?.observer.disconnect();
    const state = { diffusionMounted: false };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (
            node instanceof Element &&
            (node.matches('[data-testid="highspeed-diffusion-canvas"]') ||
              node.querySelector('[data-testid="highspeed-diffusion-canvas"]') !== null)
          ) {
            state.diffusionMounted = true;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__cfHighspeedEntranceProbe = { observer, state };
  });
}

export function takeHighspeedEntranceProbe(): Promise<HighspeedEntranceSnapshot> {
  return browser.execute(() => {
    const probe = window.__cfHighspeedEntranceProbe;
    probe?.observer.disconnect();
    delete window.__cfHighspeedEntranceProbe;
    const surface = document.querySelector<HTMLElement>('[data-highspeed-composer="true"]');
    return {
      diffusionMounted: probe ? probe.state.diffusionMounted : null,
      entrance: surface?.getAttribute("data-highspeed-entrance") ?? null,
      modelIndicatorVisible:
        document.querySelector('[data-highspeed-model-indicator="true"]') !== null,
      phase:
        surface
          ?.querySelector('[data-testid="highspeed-composer-background"]')
          ?.getAttribute("data-phase") ?? null,
    };
  });
}

export async function startHighspeedComposerProbe() {
  await browser.execute(() => {
    window.__cfHighspeedComposerProbe?.observer.disconnect();
    const state = {
      highspeedSeen: document.querySelector('[data-highspeed-composer="true"]') !== null,
    };
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-highspeed-composer="true"]')) state.highspeedSeen = true;
    });
    observer.observe(document.body, {
      attributeFilter: ["data-highspeed-composer"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    window.__cfHighspeedComposerProbe = { observer, state };
  });
}

export function takeHighspeedComposerProbe(): Promise<boolean | null> {
  return browser.execute(() => {
    const probe = window.__cfHighspeedComposerProbe;
    probe?.observer.disconnect();
    delete window.__cfHighspeedComposerProbe;
    return probe ? probe.state.highspeedSeen : null;
  });
}

export async function waitForHighspeedStatusTag(timeoutMsg: string) {
  await browser.waitUntil(
    async () =>
      browser.execute(() => Boolean(document.querySelector('[data-highspeed-status-tag="true"]'))),
    { timeout: 30000, timeoutMsg },
  );
}

export function countHighspeedStatusTags(): Promise<number> {
  return browser.execute(
    () => document.querySelectorAll('[data-highspeed-status-tag="true"]').length,
  );
}
