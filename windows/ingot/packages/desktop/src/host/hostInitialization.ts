import type { HostApiNetworkTransport } from "@origin-ai/cf-services/node";
import { runHostShutdownPhases } from "./hostShutdownPhases.js";

const DEFAULT_UNOWNED_TRANSPORT_DISPOSE_TIMEOUT_MS = 3_500;

export async function initializeHostApiNetworkTransportOwner<T>(params: {
  transport: Pick<HostApiNetworkTransport, "disposeAndWait">;
  establishOwner: () => T;
  disposeTimeoutMs?: number;
  log: (message: string, details: Record<string, unknown>) => void;
}): Promise<T> {
  try {
    return await params.establishOwner();
  } catch (initializationError) {
    await runHostShutdownPhases(
      [
        {
          name: "unowned-host-api-network-transport-dispose",
          run: async () => {
            await params.transport.disposeAndWait();
          },
          timeoutMs: params.disposeTimeoutMs ?? DEFAULT_UNOWNED_TRANSPORT_DISPOSE_TIMEOUT_MS,
        },
      ],
      {
        phaseTimeoutMs: DEFAULT_UNOWNED_TRANSPORT_DISPOSE_TIMEOUT_MS,
        log: params.log,
      },
    );
    throw initializationError;
  }
}
