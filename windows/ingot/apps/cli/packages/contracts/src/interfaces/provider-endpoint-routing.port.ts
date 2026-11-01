import type { TraceContext } from "../tracing/tracer.js";

export interface ProviderEndpointRoutingDecision {
  headers?: Readonly<Record<string, string>>;
  routed: boolean;
  url: string;
}

export interface ProviderEndpointRoutingResolveOptions {
  apiKeyId?: string;
  signal?: AbortSignal;
  trace?: TraceContext;
}

export interface ProviderEndpointRoutingPort {
  resolve(
    requestUrl: string,
    options?: ProviderEndpointRoutingResolveOptions,
  ): Promise<ProviderEndpointRoutingDecision>;
}
