import type { HttpClientPort, Logger } from "@origin-ai/cf-contracts";

export interface ProviderEndpointRoutingFactoryOptions {
  endpointOrigin: string;
  appVersion?: string;
  httpClient: HttpClientPort;
  logger?: Logger;
  readCfJwt?: () => Promise<string | null>;
  sourceHeaders?: () =>
    | Promise<Readonly<Record<string, string>>>
    | Readonly<Record<string, string>>;
}
