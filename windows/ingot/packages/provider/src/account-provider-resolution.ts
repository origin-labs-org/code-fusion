import {
  ProviderConfig,
  ProviderConfigMap,
  ZhipuAccountAccessConfig,
  type ModelId,
  type ProviderId,
} from "./config/index.js";
import type {
  AccountProviderResolveInput,
  AccountProviderResolver,
} from "./account-provider-service.js";
import type {
  AccountProviderState,
  AccountProviderUnavailableReason,
} from "./account-provider-state.js";

export type AccountProviderConnectionResult = {
  
  readonly resetPrevious?: boolean;
  
  readonly entitlementSourceProviderId?: ProviderId;
  readonly current?: boolean;
  readonly connectionKey?: string;
  readonly effectiveAt?: number;
} & (
  | {
      readonly providerId: ProviderId;
      readonly status: "available" | "pending";
      readonly models?: readonly ModelId[];
    }
  | {
      readonly providerId: ProviderId;
      readonly status: "unavailable" | "unknown";
      
      readonly unavailableReason?: AccountProviderUnavailableReason;
    }
);

export interface ResolveAccountProviderConfigsInput {
  readonly configuredProviders: ProviderConfigMap;
  readonly previousProviders: ProviderConfigMap;
  readonly connections: readonly AccountProviderConnectionResult[];
}

export type AccountProviderConnectionResolver = (
  input: Omit<AccountProviderResolveInput, "previousProviders">,
) => Promise<readonly AccountProviderConnectionResult[]>;

export function createAccountProviderConfigResolver(
  resolveConnections: AccountProviderConnectionResolver,
): AccountProviderResolver {
  return async (input) => {
    const connections = await resolveConnections({
      configRevision: input.configRevision,
      configuredProviders: input.configuredProviders,
      reasons: input.reasons ?? [],
    });
    const providers = resolveAccountProviderConfigs({
      configuredProviders: input.configuredProviders,
      previousProviders: input.previousProviders,
      connections,
    });
    const states: Record<string, AccountProviderState> = {};
    const connectionByProviderId = indexConnections(input.configuredProviders, connections);
    const resolveState = (connection: AccountProviderConnectionResult): AccountProviderState => {
      const existing = states[connection.providerId];
      if (existing) return existing;
      const previous = connection.resetPrevious
        ? undefined
        : input.previousStates?.[connection.providerId];
      const access = providers.get(connection.providerId)?.access;
      const sourceId = connection.entitlementSourceProviderId;
      const sourceConnection = sourceId ? connectionByProviderId.get(sourceId) : undefined;
      const inheritedState = sourceConnection ? resolveState(sourceConnection) : undefined;
      const unavailableReason = inheritedState
        ? inheritedState.unavailableReason
        : connection.status === "unknown" && previous
          ? previous.unavailableReason
          : connection.status === "unavailable"
            ? connection.unavailableReason
            : undefined;
      const availability = inheritedState
        ? inheritedState.entitled
          ? "available"
          : "unavailable"
        : connection.status === "unknown" && previous
          ? previous.availability
          : connection.status;
      const state = Object.freeze({
        ...(connection.status === "unknown" && !inheritedState ? previous : {}),
        availability,
        entitled: access?.type === "zhipu-account" && access.entitled === true,
        ...(unavailableReason === undefined ? {} : { unavailableReason }),
        ...(connection.current === undefined ? {} : { current: connection.current }),
        connectionKey: connection.connectionKey,
        ...(connection.effectiveAt === undefined ? {} : { effectiveAt: connection.effectiveAt }),
      });
      states[connection.providerId] = state;
      return state;
    };
    for (const connection of connections) resolveState(connection);
    return Object.freeze({ providers, states: Object.freeze(states) });
  };
}

export function resolveAccountProviderConfigs(
  input: ResolveAccountProviderConfigsInput,
): ProviderConfigMap {
  const connectionByProviderId = indexConnections(input.configuredProviders, input.connections);
  const resolvedByProviderId = new Map<ProviderId, ProviderConfig>();
  const resolving = new Set<ProviderId>();
  const resolveProvider = (providerId: ProviderId): ProviderConfig | undefined => {
    const existing = resolvedByProviderId.get(providerId);
    if (existing) return existing;
    const configured = input.configuredProviders.get(providerId);
    if (!configured || configured.access?.type !== "zhipu-account") return undefined;
    if (resolving.has(providerId)) {
      throw new Error(`Account Provider Entitlements继承存在循环: ${providerId}`);
    }
    resolving.add(providerId);
    const connection = connectionByProviderId.get(providerId) ?? {
      providerId,
      status: "unknown" as const,
    };
    let resolved: ProviderConfig;
    if (connection.entitlementSourceProviderId) {
      const source = resolveProvider(connection.entitlementSourceProviderId);
      resolved = createEntitlementOverlay(
        source?.access?.type === "zhipu-account" && source.access.entitled === true,
      );
    } else if (connection.status === "available" || connection.status === "pending") {
      if (configured.access.mode === "start-plan") {
        resolved = new ProviderConfig({
          access: new ZhipuAccountAccessConfig({ entitled: connection.status === "available" }),
          builtinModelIds: normalizeModelIds(connection.models),
        });
      } else {
        resolved = createEntitlementOverlay(connection.status === "available");
      }
    } else if (connection.status === "unavailable") {
      resolved = createEntitlementOverlay(false);
    } else {
      resolved =
        (connection.resetPrevious ? undefined : input.previousProviders.get(providerId)) ??
        createEntitlementOverlay(false);
    }
    resolving.delete(providerId);
    resolvedByProviderId.set(providerId, resolved);
    return resolved;
  };

  const resolved: Array<readonly [ProviderId, ProviderConfig]> = [];
  for (const [providerId, configured] of input.configuredProviders.entries()) {
    if (configured.access?.type !== "zhipu-account") continue;
    const provider = resolveProvider(providerId);
    if (provider) resolved.push([providerId, provider]);
  }
  return new ProviderConfigMap(resolved);
}

function createEntitlementOverlay(entitled: boolean): ProviderConfig {
  return new ProviderConfig({ access: new ZhipuAccountAccessConfig({ entitled }) });
}

function indexConnections(
  configuredProviders: ProviderConfigMap,
  connections: readonly AccountProviderConnectionResult[],
): ReadonlyMap<ProviderId, AccountProviderConnectionResult> {
  const result = new Map<ProviderId, AccountProviderConnectionResult>();
  for (const connection of connections) {
    if (result.has(connection.providerId)) {
      throw new Error(`重复 Account Provider ConnectResult: ${connection.providerId}`);
    }
    const configured = configuredProviders.get(connection.providerId);
    if (!configured) {
      throw new Error(`Account ConnectPoint to向未Configuration Provider: ${connection.providerId}`);
    }
    if (!isAccountConstrainedProvider(configured)) {
      throw new Error(`Account ConnectPoint to向非 Account Provider: ${connection.providerId}`);
    }
    const sourceId = connection.entitlementSourceProviderId;
    if (sourceId === connection.providerId) {
      throw new Error(`Account Provider 不能继承自身Entitlements: ${connection.providerId}`);
    }
    if (sourceId && !configuredProviders.get(sourceId)) {
      throw new Error(`Account Provider Entitlements母体未Configuration: ${connection.providerId} -> ${sourceId}`);
    }
    result.set(connection.providerId, connection);
  }
  return result;
}

function isAccountConstrainedProvider(config: ProviderConfig): boolean {
  return config.access?.type === "zhipu-account";
}

function normalizeModelIds(values: readonly ModelId[] | null | undefined): readonly ModelId[] {
  const result: ModelId[] = [];
  for (const value of values ?? []) {
    const modelId = value.trim();
    if (!modelId) continue;
    result.push(modelId);
  }
  return Object.freeze(result);
}
