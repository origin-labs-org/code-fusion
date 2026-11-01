import type { IBroadcastService } from "#src/broadcast/broadcast.js";
import type { IWindowProjectChangesService } from "#src/window-project-directory/contract.js";

export function createWindowProjectChangesService(
  broadcast: Pick<IBroadcastService, "onMessage">,
): IWindowProjectChangesService {
  return {
    getCapabilities: async () => ({ version: 1 }),
    onDidChange: (listener) =>
      broadcast.onMessage((event) => {
        if (event.channel === "state:projects") listener();
      }),
  };
}
