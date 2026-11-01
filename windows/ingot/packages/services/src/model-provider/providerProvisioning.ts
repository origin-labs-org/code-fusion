import type { ProviderProvisioningEnvelope, ProviderProvisioningResult } from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IProviderProvisioningTargetService {
  apply(envelope: ProviderProvisioningEnvelope): Promise<ProviderProvisioningResult>;
}

export const IProviderProvisioningTargetService =
  createServiceDescriptor<IProviderProvisioningTargetService>(
    ServiceChannels.ProviderProvisioningTarget,
  );
