import { describe, expect, it, vi } from "vitest";
import { buildRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { createSessionCreateReporter } from "@/lib/sessionCreateTelemetry.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";

describe("session_create", () => {
  it.each(["group", "project", "session"] as const)(
    "保留 %s 来源且不泄露路径/计费 projectId",
    async (source) => {
      const report = createSessionCreateReporter();
      const platform = { reportTelemetryEvent: vi.fn(async () => {}) };
      await report(platform, {
        sessionId: "s1",
        messageId: "first-command",
        workspacePath: "/private/repo",
        source,
        clientKind: "desktop",
      });
      expect(platform.reportTelemetryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          elementName: "session_create",
          eventRegion: "app",
          eventType: "result",
          talkId: "s1",
          messageId: "first-command",
          eventExtraDetail: {
            create_source: source,
            client_kind: "desktop",
            workspace_kind: "local",
            remote_kind: "",
          },
        }),
      );
      expect(JSON.stringify(platform.reportTelemetryEvent.mock.calls)).not.toContain(
        "/private/repo",
      );
      expect(JSON.stringify(platform.reportTelemetryEvent.mock.calls)).not.toContain("project_id");
    },
  );

  it("Mobile and SSH are two independent dimensions; same path with different remotes counts separately, duplicate callbacks are deduplicated", async () => {
    const report = createSessionCreateReporter();
    const platform = { reportTelemetryEvent: vi.fn(async () => {}) };
    const input = {
      sessionId: "s1",
      messageId: "first-command",
      workspacePath: "/repo",
      source: "session",
      clientKind: "mobile",
    } as const;
    for (const host of ["one", "one", "two"]) {
      await report(platform, {
        ...input,
        workspaceIdentity: buildRemoteWorkspaceIdentity("/repo", {
          kind: "ssh",
          host,
          username: "tester",
        }),
      });
    }
    expect(platform.reportTelemetryEvent).toHaveBeenCalledTimes(2);
    expect(platform.reportTelemetryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventExtraDetail: expect.objectContaining({
          client_kind: "mobile",
          workspace_kind: "remote",
          remote_kind: "ssh",
        }),
      }),
    );
  });

  it("上报失败不传播到创建动作", async () => {
    await expect(
      createSessionCreateReporter()(
        { reportTelemetryEvent: vi.fn().mockRejectedValue(new Error("offline")) },
        {
          sessionId: "s1",
          messageId: "first-command",
          workspacePath: "/repo",
          source: "session",
          clientKind: "desktop",
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("Default empty state uses session; explicit Project source takes effect and defaults back to session next time", () => {
    const store = useCfSessionStore.getState();
    expect(store.getWorkspaceState("/telemetry-source-test").draftCreateSource).toBe("session");
    store.startDraft("/telemetry-source-test", undefined, undefined, { createSource: "project" });
    expect(store.getWorkspaceState("/telemetry-source-test").draftCreateSource).toBe("project");
    store.startDraft("/telemetry-source-test");
    expect(store.getWorkspaceState("/telemetry-source-test").draftCreateSource).toBe("session");
  });
});
