import type {
  ListResourceTemplatesResult,
  ListResourcesResult,
  ReadResourceResult,
} from "@modelcontextprotocol/client";
import { INVALID_PARAMS, ProtocolError } from "@modelcontextprotocol/client";
import type { IPluginUiBridgeService, PluginUiPluginScope } from "@origin-ai/cf-services";
import type { PluginUiHostBridge } from "./pluginUiHostBridge.js";

export interface PluginUiResourceSubscriptionsDeps {
  bridge: Pick<
    IPluginUiBridgeService,
    | "readResource"
    | "listResources"
    | "listResourceTemplates"
    | "subscribeResource"
    | "unsubscribeResource"
  >;
  pluginScope(): PluginUiPluginScope;
  scopeId: string;
  
  currentGeneration(): number | undefined;
  isDisposed(): boolean;
}

export interface PluginUiResourceSubscriptions {
  
  install(bridge: PluginUiHostBridge): void;
  
  has(uri: string): boolean;
  unsubscribeAll(): void;
}

export function createPluginUiResourceSubscriptions(
  deps: PluginUiResourceSubscriptionsDeps,
): PluginUiResourceSubscriptions {
  const subscribed = new Map<string, number>();
  const inflight = new Map<string, Promise<void>>();
  const params = (uri: string, generation: number) => ({
    ...deps.pluginScope(),
    scopeId: deps.pluginScope().instance.token,
    generation,
    uri,
  });
  const unsubscribeQuietly = (uri: string, generation: number) => {
    void deps.bridge.unsubscribeResource(params(uri, generation)).catch(() => undefined);
  };

  const assertCurrent = () => {
    if (deps.isDisposed()) throw new Error("MCP App instance was closed");
  };
  const subscribe = (uri: string): Promise<void> => {
    assertCurrent();
    const generation = deps.currentGeneration();
    if (generation === undefined) {
      throw new ProtocolError(INVALID_PARAMS, "sandbox is not attached");
    }
    if (subscribed.get(uri) === generation) return Promise.resolve();
    let run = inflight.get(uri);
    if (!run) {
      const bound = params(uri, generation);
      run = deps.bridge
        .subscribeResource(bound)
        .then(() => {
          if (deps.isDisposed() || deps.currentGeneration() !== generation) {
            void deps.bridge.unsubscribeResource(bound).catch(() => undefined);
            return;
          }
          subscribed.set(uri, generation);
        })
        .finally(() => {
          if (inflight.get(uri) === run) inflight.delete(uri);
        });
      inflight.set(uri, run);
    }
    return run;
  };

  return {
    install(bridge) {
      bridge.onreadresource = async (request) => {
        assertCurrent();
        return (await deps.bridge.readResource({
          ...deps.pluginScope(),
          uri: request.uri,
        })) as unknown as ReadResourceResult;
      };
      bridge.onlistresources = async (request) => {
        assertCurrent();
        return (await deps.bridge.listResources({
          ...deps.pluginScope(),
          ...(request?.cursor ? { cursor: request.cursor } : {}),
        })) as unknown as ListResourcesResult;
      };
      bridge.onlistresourcetemplates = async (request) => {
        assertCurrent();
        return (await deps.bridge.listResourceTemplates({
          ...deps.pluginScope(),
          ...(request?.cursor ? { cursor: request.cursor } : {}),
        })) as unknown as ListResourceTemplatesResult;
      };
      bridge.setRequestHandler("resources/subscribe", async (request) => {
        await subscribe(request.params.uri);
        return {};
      });
      bridge.setRequestHandler("resources/unsubscribe", async (request) => {
        const uri = request.params.uri;
        const generation = subscribed.get(uri);
        if (generation === undefined) return {};
        subscribed.delete(uri);
        await deps.bridge.unsubscribeResource(params(uri, generation));
        return {};
      });
    },
    has: (uri) => subscribed.has(uri),
    unsubscribeAll() {
      for (const [uri, generation] of subscribed) unsubscribeQuietly(uri, generation);
      subscribed.clear();
    },
  };
}
