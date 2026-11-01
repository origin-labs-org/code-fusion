import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ILegacyTaskService } from "@origin-ai/cf-services";
import {
  resolveWorkspaceProviderConfigCfService,
  useWorkspaceProviderConfigFile,
} from "@/hooks/useWorkspaceProviderConfigFile.js";

const { stableWorkspaceCfService } = vi.hoisted(() => ({
  stableWorkspaceCfService: {
    getWorkspaceProviderConfigFile: vi.fn(),
  },
}));

vi.mock("@/hooks/useCfTaskService.js", () => ({
  useCfTaskService: () => stableWorkspaceCfService,
}));

vi.mock("@/hooks/useResolvedRemoteWorkspaceSessionId.js", () => ({
  useResolvedRemoteWorkspaceSessionId: () => null,
}));

vi.mock("@/store/remoteWorkspaceSessionStore.js", () => ({
  useRemoteWorkspaceSessionStore: (
    selector: (state: { baseServices: null }) => unknown,
  ) => selector({ baseServices: null }),
}));

function createMockCfService(tag: string): ILegacyTaskService {
  return {
    __tag: tag,
  } as unknown as ILegacyTaskService;
}

function createMinimalElement(ownerDocument: Document, tagName = "div") {
  const element = {
    addEventListener: () => {},
    appendChild: (child: { parentNode?: unknown }) => {
      child.parentNode = element;
      return child;
    },
    childNodes: [] as unknown[],
    getAttribute: () => null,
    insertBefore: (child: { parentNode?: unknown }) => {
      child.parentNode = element;
      return child;
    },
    nodeName: tagName.toUpperCase(),
    nodeType: 1,
    ownerDocument,
    parentNode: null as unknown,
    removeAttribute: () => {},
    removeChild: (child: { parentNode?: unknown }) => {
      child.parentNode = null;
      return child;
    },
    removeEventListener: () => {},
    setAttribute: () => {},
    style: {},
    tagName: tagName.toUpperCase(),
  };
  return element as unknown as Element;
}

function installMinimalDom() {
  const documentMock = {
    addEventListener: () => {},
    createElement: (tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createTextNode: (nodeValue: string) => ({
      nodeType: 3,
      nodeValue,
      ownerDocument: documentMock,
      parentNode: null,
    }),
    nodeType: 9,
    removeEventListener: () => {},
  } as unknown as Document;
  const windowMock = {
    addEventListener: () => {},
    document: documentMock,
    HTMLIFrameElement: function HTMLIFrameElement() {},
    HTMLElement: function HTMLElement() {},
    Node: function Node() {},
    removeEventListener: () => {},
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentMock,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowMock,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  return createMinimalElement(documentMock);
}

describe("resolveWorkspaceProviderConfigCfService", () => {
  afterEach(() => {
    stableWorkspaceCfService.getWorkspaceProviderConfigFile.mockReset();
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("workspace Scope始End使用 workspace CodeFusion session service", () => {
    const workspaceCfService = createMockCfService("workspace");
    const baseCfService = createMockCfService("base");

    const resolved = resolveWorkspaceProviderConfigCfService({
      configuredServiceScope: "workspace",
      workspaceCfService,
      baseCfService,
      remoteSessionId: "remote-session-1",
    });

    expect(resolved).toBe(workspaceCfService);
  });

  it("base Scope优先使用 base CodeFusion session service", () => {
    const workspaceCfService = createMockCfService("workspace");
    const baseCfService = createMockCfService("base");

    const resolved = resolveWorkspaceProviderConfigCfService({
      configuredServiceScope: "base",
      workspaceCfService,
      baseCfService,
      remoteSessionId: "remote-session-1",
    });

    expect(resolved).toBe(baseCfService);
  });

  it("base Scope在RemoteSession且 base service 缺失时Back null，避免误回退Remote路径", () => {
    const workspaceCfService = createMockCfService("workspace");

    const resolved = resolveWorkspaceProviderConfigCfService({
      configuredServiceScope: "base",
      workspaceCfService,
      baseCfService: null,
      remoteSessionId: "remote-session-1",
    });

    expect(resolved).toBeNull();
  });

  it("base Scope在LocalSession且 base service 缺失时回退 workspace service", () => {
    const workspaceCfService = createMockCfService("workspace");

    const resolved = resolveWorkspaceProviderConfigCfService({
      configuredServiceScope: "base",
      workspaceCfService,
      baseCfService: null,
      remoteSessionId: null,
    });

    expect(resolved).toBe(workspaceCfService);
  });

  it("memoizes the returned provider config object across parent rerenders when fields are unchanged", () => {
    const observedResults: Array<ReturnType<typeof useWorkspaceProviderConfigFile>> = [];
    const root: Root = createRoot(installMinimalDom());

    function Probe({ tick }: { tick: number }) {
      const result = useWorkspaceProviderConfigFile(
        "/workspace",
        "codex",
        null,
        undefined,
        { enabled: false },
      );
      observedResults.push(result);
      return createElement("span", null, tick);
    }

    act(() => {
      root.render(createElement(Probe, { tick: 1 }));
    });
    act(() => {
      root.render(createElement(Probe, { tick: 2 }));
    });

    expect(observedResults).toHaveLength(3);
    expect(observedResults[2]).toBe(observedResults[1]);

    act(() => {
      root.unmount();
    });
  });
});
