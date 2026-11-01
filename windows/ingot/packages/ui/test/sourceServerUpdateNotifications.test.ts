import { Emitter } from "@origin-ai/cf-rpc";
import type {
  SourceServerManagementSnapshot,
  SourceServerManagementStateDelta,
  RemoteTarget,
} from "@origin-ai/cf-shared";
import type { ISourceServerManagementService } from "@origin-ai/cf-services";
import { describe, expect, it, vi } from "vitest";
import { createSourceServerUpdateNotificationController } from "@/root/sourceServerUpdateNotifications.js";
import { createSourceServerUpdatePreferences } from "@/lib/sourceServerUpdatePreferences.js";
import type { ToastOptions } from "@/components/ui/toast.js";

const profileId = "17ef20b3-622d-4a53-98c1-0cdff29f3e6d";
const sourceServerId = "3cd4f9da-cd79-426c-9d70-75f36e9f6a87";

function createSnapshot(
  availableVersion = "3.9.0",
  overrides: Partial<SourceServerManagementSnapshot["states"][number]> = {},
): SourceServerManagementSnapshot {
  return {
    generation: 1,
    profiles: [
      {
        profileId,
        sourceServerId,
        transport: "ssh",
        target: { kind: "ssh", host: "example.com", username: "alice" },
        createdAt: 1,
        lifecycleState: "active",
      },
    ],
    servers: [
      {
        sourceServerId,
        displayName: "Build Server",
        installState: "installed",
      },
    ],
    workspaceHistory: [],
    states: [
      {
        profileId,
        sourceServerId,
        state: "online",
        updateAvailability: "available",
        currentVersion: "3.8.0",
        availableVersion,
        minimumVersion: "3.8.0",
        upgradeTarget: "server",
        updatedAt: 1,
        ...overrides,
      },
    ],
    failedPathCount: 0,
    abandonedPathCount: 0,
    migrationCounts: [],
  };
}

describe("Source Server update notifications", () => {
  it("Optional updates do not trigger toasts after connection or version changes", async () => {
    const emitter = new Emitter<SourceServerManagementStateDelta>();
    let snapshot = createSnapshot();
    const management = {
      onDidChangeState: emitter.event,
      getSnapshot: vi.fn(async () => snapshot),
    } as unknown as ISourceServerManagementService;
    const showToast = vi.fn();
    const formatMessage = vi.fn(
      (id: string, values?: Record<string, string | number>) =>
        `${id}:${values?.source ?? ""}:${values?.current ?? ""}:${values?.available ?? ""}`,
    );

    const controller = createSourceServerUpdateNotificationController({
      preferences: createSourceServerUpdatePreferences(null),
      management,
      formatMessage,
      showToast,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(showToast).not.toHaveBeenCalled();
    snapshot = createSnapshot("3.10.0");
    emitter.fire({ generation: 3, state: snapshot.states[0]! });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(showToast).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("Reconnecting, switching connections, or restarting notification controller will not repeatedly prompt for the same device and version", async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    let snapshot = createSnapshot("4.0", {
      state: "needs-upgrade",
      updateAvailability: "required",
    });
    const emitter = new Emitter<SourceServerManagementStateDelta>();
    const showToast = vi.fn();
    const options = {
      management: {
        getSnapshot: async () => snapshot,
        onDidChangeState: emitter.event,
      } as unknown as ISourceServerManagementService,
      showToast,
      formatMessage: (id: string) => id,
    };
    const first = createSourceServerUpdateNotificationController({
      ...options,
      preferences: createSourceServerUpdatePreferences(storage),
    });
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce());
    snapshot = { ...snapshot, states: [] };
    emitter.fire({ generation: 2, state: createSnapshot().states[0]! });
    await new Promise((resolve) => setTimeout(resolve, 0));
    snapshot = createSnapshot("4.0", {
      state: "needs-upgrade",
      updateAvailability: "required",
      profileId: "alternate",
    });
    emitter.fire({ generation: 3, state: snapshot.states[0]! });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(showToast).toHaveBeenCalledOnce();
    first.dispose();
    const restarted = createSourceServerUpdateNotificationController({
      ...options,
      preferences: createSourceServerUpdatePreferences(storage),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(showToast).toHaveBeenCalledOnce();
    snapshot = createSnapshot("4.1", { state: "needs-upgrade", updateAvailability: "required" });
    restarted.refresh();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledTimes(2));
    restarted.dispose();
  });

  it("Provide Server update action directly in startup prompt when version is incompatible", async () => {
    const snapshot = createSnapshot("3.9.0", {
      state: "needs-upgrade",
      updateAvailability: "required",
      minimumVersion: "3.9.0",
    });
    const management = {
      onDidChangeState: new Emitter<SourceServerManagementStateDelta>().event,
      getSnapshot: vi.fn(async () => snapshot),
      updateSource: vi.fn(async () => snapshot),
    } as unknown as ISourceServerManagementService;
    const showToast = vi.fn();
    const controller = createSourceServerUpdateNotificationController({
      preferences: createSourceServerUpdatePreferences(null),
      management,
      formatMessage: (id) => id,
      showToast,
    });

    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce());
    expect(showToast).toHaveBeenCalledWith(
      "sourceServer.updateRequiredToast",
      expect.objectContaining({
        variant: "source-server-update",
        position: "top-center",
        actionLabel: "settings.source.updateNow",
        onAction: expect.any(Function),
      }),
    );
    const onAction = showToast.mock.calls[0]?.[1]?.onAction as (() => void) | undefined;
    onAction?.();
    await vi.waitFor(() =>
      expect(management.updateSource).toHaveBeenCalledWith({
        profileId,
        force: false,
      }),
    );
    controller.dispose();
  });
});

function createNotificationHarness() {
  const emitter = new Emitter<SourceServerManagementStateDelta>();
  let snapshot = createSnapshot("3.12.2", {
    state: "needs-upgrade",
    updateAvailability: "required",
    currentVersion: "3.12.1",
  });
  let connectionTarget: RemoteTarget | null = null;
  let nextId = 0;
  const active = new Map<number, { message: string; options?: ToastOptions }>();
  const showToast = vi.fn((message: string, options?: ToastOptions) => {
    const id = ++nextId;
    active.set(id, { message, options });
    return id;
  });
  const dismissToast = vi.fn((id: unknown) => active.delete(id as number));
  const management = {
    onDidChangeState: emitter.event,
    getSnapshot: vi.fn(async () => snapshot),
    updateSource: vi.fn(async () => snapshot),
  } as unknown as ISourceServerManagementService;
  const controller = createSourceServerUpdateNotificationController({
    preferences: createSourceServerUpdatePreferences(null),
    management,
    showToast,
    dismissToast,
    formatMessage: (id) => id,
    getConnectionTarget: () => connectionTarget,
  });
  return {
    controller,
    management,
    active,
    showToast,
    dismissToast,
    publish(next: SourceServerManagementSnapshot) {
      snapshot = next;
      emitter.fire({ generation: next.generation, state: next.states[0]! });
    },
    handleTarget(target: RemoteTarget | null) {
      connectionTarget = target;
      controller.refresh();
    },
    readSnapshot: () => snapshot,
  };
}

describe("Source Server 更新提示与连接向导协调", () => {
  it.each(["controller"])("向导不抑制 %s 正常提示", async (kind) => {
    const h = createNotificationHarness();
    try {
      h.handleTarget({ kind: "ssh", host: "example.com", username: "alice" });
      h.publish(
        createSnapshot(
          "3.12.2",
          kind === "available"
            ? {}
            : {
                state: "needs-upgrade",
                updateAvailability: "required",
                upgradeTarget: "controller",
              },
        ),
      );
      await vi.waitFor(() => expect(h.active.size).toBe(1));
      expect(h.active.get(1)?.message).toBe(
        kind === "available"
          ? "sourceServer.updateAvailableToast"
          : "sourceServer.controllerUpdateAvailableToast",
      );
      if (kind === "controller") expect(h.active.get(1)?.options?.onAction).toBeUndefined();
    } finally {
      h.controller.dispose();
    }
  });

  it.each(["updating", "online", "removed"])(
    "Dismiss old update now prompt when entering %s",
    async (nextState) => {
      const h = createNotificationHarness();
      try {
        await vi.waitFor(() => expect(h.active.size).toBe(1));
        const snapshot = h.readSnapshot();
        h.publish({
          ...snapshot,
          states:
            nextState === "removed"
              ? []
              : [
                  {
                    ...snapshot.states[0]!,
                    state: nextState === "updating" ? "updating" : "online",
                    updateAvailability: nextState === "updating" ? "required" : "none",
                  },
                ],
        });
        await vi.waitFor(() => expect(h.active.size).toBe(0));
        expect(h.dismissToast).toHaveBeenCalledWith(1);
      } finally {
        h.controller.dispose();
      }
    },
  );

  it("Wizard synchronously takes over target; multiple connections or failed reconnections for the same device will not repeatedly prompt", async () => {
    const h = createNotificationHarness();
    try {
      h.handleTarget({ kind: "ssh", host: "example.com", username: "alice" });
      const snapshot = h.readSnapshot();
      h.publish({
        ...snapshot,
        profiles: [
          ...snapshot.profiles,
          {
            ...snapshot.profiles[0]!,
            profileId: "other",
            target: { kind: "ssh", host: "other.example.com", username: "alice" },
          },
        ],
        states: [...snapshot.states, { ...snapshot.states[0]!, profileId: "other" }],
      });
      await vi.waitFor(() => expect(h.showToast).toHaveBeenCalledOnce());
      expect(h.active.size).toBe(1);
      h.handleTarget(null);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.showToast).toHaveBeenCalledOnce();
      h.publish({ ...snapshot, states: [{ ...snapshot.states[0]!, state: "updating" }] });
      await vi.waitFor(() => expect(h.active.size).toBe(0));
      h.publish(snapshot);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.active.size).toBe(0);
      expect(h.showToast).toHaveBeenCalledOnce();
    } finally {
      h.controller.dispose();
    }
  });

  it("Dismiss immediately after taking over existing prompt; captured button can no longer submit updates", async () => {
    const h = createNotificationHarness();
    try {
      await vi.waitFor(() => expect(h.active.size).toBe(1));
      const action = h.active.get(1)!.options!.onAction!;
      h.handleTarget({ kind: "ssh", host: "example.com", username: "alice" });
      await vi.waitFor(() => expect(h.active.size).toBe(0));
      action();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.management.updateSource).not.toHaveBeenCalled();
    } finally {
      h.controller.dispose();
    }
  });

  it("Recheck Host snapshot on click; expired buttons during update will not request updates again", async () => {
    const h = createNotificationHarness();
    try {
      await vi.waitFor(() => expect(h.active.size).toBe(1));
      const action = h.active.get(1)!.options!.onAction!;
      const snapshot = h.readSnapshot();
      vi.mocked(h.management.getSnapshot).mockResolvedValue({
        ...snapshot,
        states: [{ ...snapshot.states[0]!, state: "updating" }],
      });
      action();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.management.updateSource).not.toHaveBeenCalled();
    } finally {
      h.controller.dispose();
    }
  });

  it("Rapid repeated clicks on the same prompt submit only once and clean up prompt on destruction", async () => {
    const h = createNotificationHarness();
    try {
      await vi.waitFor(() => expect(h.active.size).toBe(1));
      const action = h.active.get(1)!.options!.onAction!;
      action();
      action();
      await vi.waitFor(() => expect(h.management.updateSource).toHaveBeenCalledOnce());
    } finally {
      h.controller.dispose();
    }
    expect(h.dismissToast).toHaveBeenCalledWith(1);
  });
});

it("Starting update only locates progress; explicit details action in failure toast opens error details", async () => {
  const snapshot = createSnapshot("4.0.0", {
    state: "needs-upgrade",
    updateAvailability: "required",
  });
  const completion = Promise.withResolvers<SourceServerManagementSnapshot>();
  const onProgress = vi.fn();
  const onDetails = vi.fn();
  const showToast = vi.fn((_message: string, _options?: ToastOptions) => 1);
  const controller = createSourceServerUpdateNotificationController({
    management: {
      getSnapshot: async () => snapshot,
      onDidChangeState: new Emitter<SourceServerManagementStateDelta>().event,
      updateSource: () => completion.promise,
    } as never,
    preferences: createSourceServerUpdatePreferences(null),
    formatMessage: (id) => id,
    showToast,
    onProgress,
    onDetails,
  });
  try {
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce());
    showToast.mock.calls[0]![1]!.onAction!();
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith(sourceServerId));
    expect(onDetails).not.toHaveBeenCalled();
    completion.reject(new Error("update failed"));
    await vi.waitFor(() =>
      expect(
        showToast.mock.calls.some(([message]) => message === "sourceServer.updateFailedToast"),
      ).toBe(true),
    );
    showToast.mock.calls.find(([message]) => message === "sourceServer.updateFailedToast")![1]!
      .onAction!();
    expect(onDetails).toHaveBeenCalledWith(sourceServerId);
  } finally {
    controller.dispose();
  }
});
