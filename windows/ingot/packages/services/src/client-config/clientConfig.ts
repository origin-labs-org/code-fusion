import {
  ServiceChannels,
  type ClientConfigReadOptions,
  type ClientConfigSnapshot,
} from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IClientConfigService {
  getSnapshot(options?: ClientConfigReadOptions): Promise<ClientConfigSnapshot>;
}

export const IClientConfigService = createServiceDescriptor<IClientConfigService>(
  ServiceChannels.ClientConfig,
);
