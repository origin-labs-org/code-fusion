import { randomUUID } from "node:crypto";
import {
  providerProvisioningErrorCodeSchema,
  type ProviderProvisioningResult,
  type ProviderProvisioningErrorCode,
} from "@origin-ai/cf-shared";
import type { IProviderProvisioningTargetService, IServiceAccessor } from "@origin-ai/cf-services";
import {
  getProviderProvisioningSource,
  type ProviderProvisioningSource,
} from "@origin-ai/cf-services/node";
import type { ServiceCollection } from "@origin-ai/cf-services";

export interface RemoteProviderProvisioningExecutor {
  syncLocalToRemote(): Promise<ProviderProvisioningResult>;
}

const executors = new WeakMap<ServiceCollection, RemoteProviderProvisioningExecutor>();

export function getRemoteProviderProvisioningExecutor(
  services: ServiceCollection,
): RemoteProviderProvisioningExecutor | undefined {
  return executors.get(services);
}

export function registerRemoteProviderProvisioningExecutor(
  services: ServiceCollection,
  executor: RemoteProviderProvisioningExecutor,
): void {
  executors.set(services, executor);
}

export function createRemoteProviderProvisioningExecutor(options: {
  source?: ProviderProvisioningSource;
  target?: IProviderProvisioningTargetService;
}): RemoteProviderProvisioningExecutor {
  const syncLocalToRemote = async (): Promise<ProviderProvisioningResult> => {
    const syncId = randomUUID();
    if (!options.source || !options.target) {
      return unsupportedResult(syncId, "Local/Remote Provider Provisioning capability unavailable.");
    }
    let errorCode: ProviderProvisioningErrorCode = "source-read-failed";
    try {
      const envelope = await options.source.read(syncId);
      errorCode = "target-call-failed";
      const { errorCode: remoteErrorCode, ...result } = await options.target.apply(envelope);
      if (result.status === "applied" || result.status === "already-applied") return result;
      const parsedCode = providerProvisioningErrorCodeSchema.safeParse(remoteErrorCode);
      return { ...result, errorCode: parsedCode.success ? parsedCode.data : "target-apply-failed" };
    } catch (error) {
      return {
        syncId,
        status: "failed",
        personalProviderCount: 0,
        credentialCount: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode,
        rolledBack: true,
      } satisfies ProviderProvisioningResult;
    }
  };

  return { syncLocalToRemote };
}

export function createRemoteProviderProvisioningExecutorFromWorkspace(options: {
  connectionServices: IServiceAccessor;
  sourceServices?: ServiceCollection;
}): RemoteProviderProvisioningExecutor {
  const source = options.sourceServices
    ? getProviderProvisioningSource(options.sourceServices)
    : undefined;
  const target = (
    options.connectionServices as IServiceAccessor & {
      providerProvisioningTargetService?: IProviderProvisioningTargetService;
    }
  ).providerProvisioningTargetService;
  return createRemoteProviderProvisioningExecutor({ source, target });
}

function unsupportedResult(syncId: string, errorMessage: string): ProviderProvisioningResult {
  return {
    syncId,
    status: "unsupported",
    personalProviderCount: 0,
    credentialCount: 0,
    errorMessage,
    errorCode: "capability-unavailable",
    rolledBack: false,
  };
}
