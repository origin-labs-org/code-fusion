import type { RemoteConnectionFlowOptions } from "@/remote-connection-flow/contract.js";

export function projectConnectionOptions(
  ports: Pick<RemoteConnectionFlowOptions, "onConnect" | "onCancelSession" | "onSelectProject">,
  chooseAndSaveProject: (connectionId: string) => Promise<void>,
): RemoteConnectionFlowOptions {
  return { ...ports, onConnectionReady: chooseAndSaveProject };
}
