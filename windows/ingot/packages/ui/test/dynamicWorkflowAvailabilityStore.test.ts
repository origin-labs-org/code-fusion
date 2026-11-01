import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ICodingPlanSubscriptionService } from "@origin-ai/cf-services";
import {
  applyDynamicWorkflowUserMode,
  createDynamicWorkflowClientConfig,
  type DynamicWorkflowClientConfig,
} from "@origin-ai/cf-shared";
import {
  resetDynamicWorkflowAvailabilityStoreForTests,
  useDynamicWorkflowAvailabilityStore,
} from "@/store/dynamicWorkflowAvailabilityStore.js";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
}));

const ENABLED: DynamicWorkflowClientConfig = createDynamicWorkflowClientConfig(
  "alwaysOn",
  "remote",
);
const DISABLED: DynamicWorkflowClientConfig = createDynamicWorkflowClientConfig(
  "disabled",
  "remote",
);

function serviceReturning(config: DynamicWorkflowClientConfig): ICodingPlanSubscriptionService & {
  getDynamicWorkflowClientConfig: ReturnType<typeof vi.fn>;
} {
  return {
    getDynamicWorkflowClientConfig: vi.fn(async () => config),
  } as unknown as ICodingPlanSubscriptionService & {
    getDynamicWorkflowClientConfig: ReturnType<typeof vi.fn>;
  };
}

function serviceFailing(): ICodingPlanSubscriptionService & {
  getDynamicWorkflowClientConfig: ReturnType<typeof vi.fn>;
} {
  return {
    getDynamicWorkflowClientConfig: vi.fn(async () => {
      throw new Error("host unreachable");
    }),
  } as unknown as ICodingPlanSubscriptionService & {
    getDynamicWorkflowClientConfig: ReturnType<typeof vi.fn>;
  };
}

describe("dynamicWorkflowAvailabilityStore", () => {
  beforeEach(() => {
    warn.mockClear();
  });
  afterEach(() => {
    resetDynamicWorkflowAvailabilityStoreForTests();
  });

  it("Initial value is loading + disabled: fail-closed on unknown, entry won\'t flash before collapsing", () => {
    const state = useDynamicWorkflowAvailabilityStore.getState();
    expect(state.status).toBe("loading");
    expect(state.enabled).toBe(false);
    expect(state.config).toBeNull();
  });

  it("Singleflight: concurrent ensureLoaded sends only one RPC, results written to snapshot", async () => {
    const service = serviceReturning(ENABLED);
    const { ensureLoaded } = useDynamicWorkflowAvailabilityStore.getState();

    await Promise.all([ensureLoaded(service), ensureLoaded(service), ensureLoaded(service)]);

    expect(service.getDynamicWorkflowClientConfig).toHaveBeenCalledTimes(1);
    const state = useDynamicWorkflowAvailabilityStore.getState();
    expect(state.status).toBe("ready");
    expect(state.enabled).toBe(true);
    expect(state.config).toEqual(ENABLED);
  });

  it("Do not re-request if the same service has returned results (fetch once per app session)", async () => {
    const service = serviceReturning(ENABLED);
    const { ensureLoaded } = useDynamicWorkflowAvailabilityStore.getState();

    await ensureLoaded(service);
    await ensureLoaded(service);

    expect(service.getDynamicWorkflowClientConfig).toHaveBeenCalledTimes(1);
  });

  it("Server sends disabled → enabled false, source retained in snapshot for log distinction", async () => {
    const service = serviceReturning(DISABLED);
    await useDynamicWorkflowAvailabilityStore.getState().ensureLoaded(service);

    const state = useDynamicWorkflowAvailabilityStore.getState();
    expect(state.status).toBe("ready");
    expect(state.enabled).toBe(false);
    expect(state.config?.source).toBe("remote");
  });

  it("Request failed → fail-closed to disabled and log a warn, without throwing exception to caller", async () => {
    const service = serviceFailing();

    await expect(
      useDynamicWorkflowAvailabilityStore.getState().ensureLoaded(service),
    ).resolves.toBeUndefined();

    const state = useDynamicWorkflowAvailabilityStore.getState();
    expect(state.status).toBe("ready");
    expect(state.enabled).toBe(false);
    expect(state.config).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("Failure is not sticky: switching service (accessor changes after phone/remote bridge) retries and corrects", async () => {
    const failing = serviceFailing();
    await useDynamicWorkflowAvailabilityStore.getState().ensureLoaded(failing);
    expect(useDynamicWorkflowAvailabilityStore.getState().enabled).toBe(false);

    const bridged = serviceReturning(ENABLED);
    await useDynamicWorkflowAvailabilityStore.getState().ensureLoaded(bridged);

    expect(bridged.getDynamicWorkflowClientConfig).toHaveBeenCalledTimes(1);
    expect(useDynamicWorkflowAvailabilityStore.getState().enabled).toBe(true);
  });

  it("refresh bypasses latch with forceRefresh to re-fetch after settings change", async () => {
    const service = serviceReturning(DISABLED);
    await useDynamicWorkflowAvailabilityStore.getState().ensureLoaded(service);
    service.getDynamicWorkflowClientConfig.mockResolvedValue(ENABLED);

    await useDynamicWorkflowAvailabilityStore.getState().refresh(service);

    expect(service.getDynamicWorkflowClientConfig).toHaveBeenCalledTimes(2);
    expect(service.getDynamicWorkflowClientConfig).toHaveBeenLastCalledWith({
      forceRefresh: true,
    });
    expect(useDynamicWorkflowAvailabilityStore.getState().enabled).toBe(true);
  });

  it("reload bypasses latch without forceRefresh, reading effective value after Host applies user selection", async () => {
    const service = serviceReturning(ENABLED);
    await useDynamicWorkflowAvailabilityStore.getState().ensureLoaded(service);
    service.getDynamicWorkflowClientConfig.mockResolvedValue(
      applyDynamicWorkflowUserMode(ENABLED, "disabled"),
    );

    await useDynamicWorkflowAvailabilityStore.getState().reload(service);

    expect(service.getDynamicWorkflowClientConfig).toHaveBeenCalledTimes(2);
    expect(service.getDynamicWorkflowClientConfig).toHaveBeenLastCalledWith({});
    const state = useDynamicWorkflowAvailabilityStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.config).toMatchObject({ mode: "disabled", offeredMode: "alwaysOn" });
  });
});
