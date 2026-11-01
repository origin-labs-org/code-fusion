// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ICodingPlanSubscriptionService } from "@origin-ai/cf-services";
import {
  applyDynamicWorkflowUserMode,
  createDynamicWorkflowClientConfig,
  type DynamicWorkflowMode,
} from "@origin-ai/cf-shared";
import { useDynamicWorkflowUserModeSync } from "@/hooks/useDynamicWorkflowAvailability.js";
import {
  resetDynamicWorkflowAvailabilityStoreForTests,
  useDynamicWorkflowAvailabilityStore,
} from "@/store/dynamicWorkflowAvailabilityStore.js";

vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const OFFER = createDynamicWorkflowClientConfig("alwaysOn", "remote");

function setup() {
  const events: string[] = [];
  let currentChoice: DynamicWorkflowMode | undefined;
  const cfAgentService = {
    syncDynamicWorkflowUserMode: vi.fn(async (params: { mode?: DynamicWorkflowMode }) => {
      events.push(`sync:${params.mode ?? "follow"}`);
    }),
  };
  const codingPlanSubscriptionService = {
    getDynamicWorkflowClientConfig: vi.fn(async () => {
      events.push("reload");
      return applyDynamicWorkflowUserMode(OFFER, currentChoice);
    }),
  } as unknown as ICodingPlanSubscriptionService;
  const hook = renderHook(
    (props: { settingsLoaded: boolean; userMode: DynamicWorkflowMode | undefined }) => {
      currentChoice = props.userMode;
      useDynamicWorkflowUserModeSync({
        ...props,
        cfAgentService,
        codingPlanSubscriptionService,
      });
    },
    { initialProps: { settingsLoaded: false, userMode: undefined } },
  );
  return { events, hook, cfAgentService };
}

describe("useDynamicWorkflowUserModeSync（DWG-22）", () => {
  afterEach(() => {
    cleanup();
    resetDynamicWorkflowAvailabilityStoreForTests();
  });

  it("No signal emitted when settings are not loaded or on initial read", () => {
    const { events, hook } = setup();
    hook.rerender({ settingsLoaded: true, userMode: "onDemand" });
    expect(events).toEqual([]);
  });

  it("Selection change: prompt Host to resend policy, then re-read snapshot; emit signal without mode when reverting to follow", async () => {
    const { events, hook } = setup();
    hook.rerender({ settingsLoaded: true, userMode: undefined });
    hook.rerender({ settingsLoaded: true, userMode: "disabled" });
    await waitFor(() => expect(events).toEqual(["sync:disabled", "reload"]));
    expect(useDynamicWorkflowAvailabilityStore.getState()).toMatchObject({
      status: "ready",
      enabled: false,
      config: { mode: "disabled", offeredMode: "alwaysOn" },
    });

    hook.rerender({ settingsLoaded: true, userMode: undefined });
    await waitFor(() =>
      expect(events).toEqual(["sync:disabled", "reload", "sync:follow", "reload"]),
    );
    expect(useDynamicWorkflowAvailabilityStore.getState().enabled).toBe(true);
  });

  it("Serialize two consecutive changes: second signal emitted only after first re-read", async () => {
    const { events, hook } = setup();
    hook.rerender({ settingsLoaded: true, userMode: undefined });
    hook.rerender({ settingsLoaded: true, userMode: "disabled" });
    hook.rerender({ settingsLoaded: true, userMode: "onDemand" });
    await waitFor(() =>
      expect(events).toEqual(["sync:disabled", "reload", "sync:onDemand", "reload"]),
    );
    expect(useDynamicWorkflowAvailabilityStore.getState().config).toMatchObject({
      mode: "onDemand",
    });
  });

  it("Snapshot is re-read even if Host sync fails (snapshot takes current Host result as truth)", async () => {
    const { events, hook, cfAgentService } = setup();
    cfAgentService.syncDynamicWorkflowUserMode.mockRejectedValueOnce(new Error("host gone"));
    hook.rerender({ settingsLoaded: true, userMode: undefined });
    hook.rerender({ settingsLoaded: true, userMode: "disabled" });
    await waitFor(() => expect(events).toEqual(["reload"]));
  });
});
