import { Emitter, type Event, type IDisposable } from "@origin-ai/cf-rpc";
import {
  createCfAgentConnectionScope,
  ICfAgentService,
  ServiceCollection,
  type ICfAgentService as ICfAgentServiceType,
} from "@origin-ai/cf-services";
import type {
  AgentLaneResourceSample,
  CfMcpTelemetryEvent,
  CfMcpResourceSample,
  CfToolExecResource,
} from "@origin-ai/cf-shared";
import { HostResponseTypes } from "@origin-ai/cf-shared";
import { describe, expect, it, vi } from "vitest";
import { registerHostServiceResourceTelemetry } from "../src/host/hostServiceResourceTelemetry.js";
import { createWindowHostAttachmentRegistry } from "../src/host/windowHostAttachmentRegistry.js";

const remoteSample: AgentLaneResourceSample = {
  arch: "x64",
  cpuCores: 1.5,
  cpuPercent: 18.75,
  heapUsedKb: 52_000,
  instanceToken: "remote-instance-01",
  intervalMs: 60_000,
  lane: "chat",
  logicalCpuCount: 8,
  platform: "linux",
  rssKb: 132_000,
  totalMemoryGb: 16,
  uptimeMinutes: 11,
};

const remoteMcpEvent: CfMcpTelemetryEvent = {
  arch: "x64",
  kind: "memory",
  mcpId: "builtin:node_repl",
  mcpInstanceId: "mcp-instance-remote-1",
  mcpIsolation: "workspace",
  mcpSource: "builtin",
  memoryKb: 64_000,
  memoryScope: "process_tree",
  occurredAt: 2_000,
  orphanSuspected: false,
  ownerSessionCount: 1,
  platform: "linux",
  unownedSeconds: 0,
};

function createRemoteWorkspaceServicesStub() {
  const samples = new Emitter<AgentLaneResourceSample>();
  const toolSamples = new Emitter<CfToolExecResource>();
  const mcpSamples = new Emitter<CfMcpResourceSample[]>();
  const mcpEvents = new Emitter<CfMcpTelemetryEvent>();
  const subscriptions = { added: 0, disposed: 0 };
  const counted = <T>(event: Event<T>): Event<T> => {
    return (listener) => {
      subscriptions.added += 1;
      const registration = event(listener);
      return {
        dispose: () => {
          subscriptions.disposed += 1;
          registration.dispose();
        },
      };
    };
  };
  const agentService = {
    onDynamicProcessResourceSample: vi.fn(() => counted(samples.event)),
    onDynamicToolExecResource: vi.fn(() => counted(toolSamples.event)),
    onDynamicMcpResourceSamples: vi.fn(() => counted(mcpSamples.event)),
    onDynamicMcpTelemetry: vi.fn(() => counted(mcpEvents.event)),
  } as unknown as ICfAgentServiceType;
  const services = new ServiceCollection().register(ICfAgentService, agentService);
  return { agentService, toolSamples, mcpSamples, mcpEvents, samples, services, subscriptions };
}

describe("registerHostServiceResourceTelemetry", () => {
  it("Standalone Server skips subscriptions completely when resource capability is not declared; service connection is unaffected", () => {
    const remote = createRemoteWorkspaceServicesStub();
    const getOptional = vi.spyOn(remote.services, "getOptional");
    const postMessage = vi.fn();
    const onError = vi.fn();

    const telemetry = registerHostServiceResourceTelemetry({
      services: remote.services,
      postMessage,
      runtimeSurface: "remote",
      telemetrySupported: false,
      onError,
    });
    remote.samples.fire(remoteSample);
    remote.mcpEvents.fire(remoteMcpEvent);
    telemetry.dispose();
    telemetry.dispose();

    expect(getOptional).not.toHaveBeenCalled();
    expect(remote.subscriptions).toEqual({ added: 0, disposed: 0 });
    expect(postMessage).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("远端 service collection 建立后订阅资源遥测，CLI 样本与 MCP 事件都带 runtime_surface=remote", () => {
    const remote = createRemoteWorkspaceServicesStub();
    const postMessage = vi.fn();

    const telemetry = registerHostServiceResourceTelemetry({
      services: remote.services,
      postMessage,
      runtimeSurface: "remote",
      telemetrySupported: true,
      environmentKey: "remote-environment-01",
    });

    remote.samples.fire(remoteSample);
    remote.mcpEvents.fire(remoteMcpEvent);
    telemetry.dispose();

    expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
      {
        type: HostResponseTypes.AgentResourceSample,
        runtimeSurface: "remote",
        environmentKey: "remote-environment-01",
        sample: remoteSample,
      },
      {
        type: HostResponseTypes.McpTelemetry,
        runtimeSurface: "remote",
        event: remoteMcpEvent,
      },
    ]);
  });

  it("MCP resource array is forwarded along remote collection and released with connection", () => {
    const remote = createRemoteWorkspaceServicesStub();
    const postMessage = vi.fn();
    const telemetry = registerHostServiceResourceTelemetry({
      services: remote.services,
      postMessage,
      runtimeSurface: "remote",
      environmentKey: "remote-environment-01",
    });
    const samples: CfMcpResourceSample[] = [
      {
        mcpId: "builtin:node_repl",
        instanceToken: "cli-instance-01",
        sampledAt: 300000,
        intervalMs: 300000,
        processCount: 1,
        rssKbTotal: 100,
        rssKbMaxProcess: 100,
        cpuTimeMsDelta: 0,
        uptimeMinutes: 5,
        platform: "linux",
        arch: "x64",
        logicalCpuCount: 8,
        totalMemoryGb: 32,
      },
    ];
    remote.mcpSamples.fire(samples);
    telemetry.dispose();
    remote.mcpSamples.fire(samples);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "mcp-resource-samples",
      runtimeSurface: "remote",
      environmentKey: "remote-environment-01",
      samples,
    });
  });

  it("Release subscriptions when remote connection disconnects without leaking listeners", () => {
    const remote = createRemoteWorkspaceServicesStub();
    const postMessage = vi.fn();

    const telemetry = registerHostServiceResourceTelemetry({
      services: remote.services,
      postMessage,
      runtimeSurface: "remote",
    });
    expect(remote.subscriptions).toEqual({ added: 4, disposed: 0 });

    telemetry.dispose();
    telemetry.dispose();
    remote.samples.fire(remoteSample);
    remote.mcpEvents.fire(remoteMcpEvent);

    expect(remote.subscriptions).toEqual({ added: 4, disposed: 4 });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("Do not subscribe or throw when remote services lack Agent service", () => {
    const postMessage = vi.fn();

    const telemetry = registerHostServiceResourceTelemetry({
      services: new ServiceCollection(),
      postMessage,
      runtimeSurface: "remote",
    });

    expect(() => telemetry.dispose()).not.toThrow();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("When an individual subscription fails, release established subscriptions and delegate to onError without affecting remote connection result", () => {
    const samples = new Emitter<AgentLaneResourceSample>();
    let samplesDisposed = 0;
    const agentService = {
      onDynamicProcessResourceSample:
        () => (listener: (sample: AgentLaneResourceSample) => void) => {
          const registration = samples.event(listener);
          return {
            dispose: () => {
              samplesDisposed += 1;
              registration.dispose();
            },
          };
        },
      onDynamicMcpTelemetry: () => {
        throw new Error("remote channel closed");
      },
    } as unknown as ICfAgentServiceType;
    const services = new ServiceCollection().register(ICfAgentService, agentService);
    const postMessage = vi.fn();
    const onError = vi.fn();

    const telemetry = registerHostServiceResourceTelemetry({
      services,
      postMessage,
      runtimeSurface: "remote",
      onError,
    });
    samples.fire(remoteSample);

    expect(samplesDisposed).toBe(1);
    expect(onError).toHaveBeenCalledOnce();
    expect(postMessage).not.toHaveBeenCalled();
    expect(() => telemetry.dispose()).not.toThrow();
  });

  it("No resource telemetry subscription after mobile remote control attachment is established", () => {
    const remote = createRemoteWorkspaceServicesStub();
    const postMessage = vi.fn();
    const telemetry = registerHostServiceResourceTelemetry({
      services: remote.services,
      postMessage,
      runtimeSurface: "remote",
    });
    const subscriptionsAfterConnect = { ...remote.subscriptions };
    const attachmentSamples: AgentLaneResourceSample[] = [];
    const closeListeners: (() => void)[] = [];
    // packages/services/test/cfAgentConnectionScope.test.ts。
    const attachmentRegistry = createWindowHostAttachmentRegistry<
      ServiceCollection,
      { once(event: "close", listener: () => void): unknown }
    >({
      resolveScope: () => ({ services: remote.services, generation: 1 }),
      expose: ({ services, clientMode }) => {
        const scope = createCfAgentConnectionScope(services.get(ICfAgentService), {
          connectionId: `host-rpc-${clientMode}`,
          clientMode,
        });
        const subscription: IDisposable = scope.service.onDynamicProcessResourceSample()((sample) =>
          attachmentSamples.push(sample),
        );
        return {
          dispose: () => {
            subscription.dispose();
            void scope.dispose();
          },
        };
      },
    });

    attachmentRegistry.attach({
      requestId: "mobile-request-1",
      attachmentId: "mobile-attachment-1",
      clientMode: "web-remote-replayable",
      scope: {
        kind: "remote",
        remoteSessionId: "remote-session-1",
        workspacePath: "/home/dev/project",
        workspaceIdentity: "ssh://dev@remote-host/home/dev/project",
      },
      port: { once: (_event, listener) => closeListeners.push(listener) },
    });
    remote.samples.fire(remoteSample);

    expect(attachmentSamples).toEqual([]);
    expect(remote.subscriptions).toEqual(subscriptionsAfterConnect);
    expect(postMessage).toHaveBeenCalledOnce();

    attachmentRegistry.dispose();
    telemetry.dispose();
  });
});

it("Bash completion facts register and release with collection, preserving runtime surface", () => {
  const remote = createRemoteWorkspaceServicesStub();
  const postMessage = vi.fn();
  const handle = registerHostServiceResourceTelemetry({
    services: remote.services,
    postMessage,
    runtimeSurface: "local",
  });
  const sample: CfToolExecResource = {
    platform: "win32",
    toolName: "bash",
    durationMs: 40000,
    exitKind: "completed",
    sampleCount: 0,
    cliRssKb: 1024,
    systemFreeMemoryKb: 2048,
  };
  remote.toolSamples.fire(sample);
  handle.dispose();
  remote.toolSamples.fire(sample);
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({
    type: "tool-exec-resource",
    runtimeSurface: "local",
    sample,
  });
});
