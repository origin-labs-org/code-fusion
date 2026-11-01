import type { Logger, ModelRequestObservation } from "@origin-ai/cf-contracts";
import type { RegistryProviderConfig } from "@origin-ai/cf-provider";

export interface ModelRequestObservationSource {
  take(requestId: string): ModelRequestObservation[];
}

export interface ModelRequestSecurityPort extends ModelRequestObservationSource {
  protectTransport(input: {
    providerId: string;
    providerConfig: {
      access: RegistryProviderConfig["access"];
      baseURL: string;
      apiKey?: string;
      headers?: Record<string, string>;
    };
    transport: typeof globalThis.fetch;
  }): typeof globalThis.fetch;
}

export interface ModelRequestSecurityState {
  createExecution(options: { logger?: Logger }): ModelRequestSecurityPort;
}
