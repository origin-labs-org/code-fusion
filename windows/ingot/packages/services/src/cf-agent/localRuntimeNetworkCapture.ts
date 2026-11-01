import {
  networkCaptureBatchSchema,
  cfProtocolMethods,
  cfProtocolNotifications,
  type NetworkCaptureBatch,
} from "@origin-ai/cf-shared";
import type { IDisposable } from "@origin-ai/cf-rpc";
import type { CfProtocolClient } from "#src/cf-agent/cfProtocolClient.js";

export class LocalRuntimeNetworkCapture {
  private readonly clients = new Map<
    CfProtocolClient,
    { pid: number; subscription?: IDisposable }
  >();
  private captureId: string | null = null;
  private sink?: (batch: NetworkCaptureBatch) => void;

  register(client: CfProtocolClient, pid: number): () => void {
    this.clients.set(client, { pid });
    if (this.captureId) this.configure(client);
    return () => {
      this.clients.get(client)?.subscription?.dispose();
      this.clients.delete(client);
    };
  }

  setCaptureId(captureId: string | null, sink?: (batch: NetworkCaptureBatch) => void): void {
    this.captureId = captureId;
    this.sink = sink;
    for (const client of this.clients.keys()) this.configure(client);
  }

  private configure(client: CfProtocolClient): void {
    const entry = this.clients.get(client)!;
    entry.subscription?.dispose();
    entry.subscription = undefined;
    if (client.isDisposed) {
      this.clients.delete(client);
      return;
    }
    if (this.captureId) {
      entry.subscription = client.onNotification((message) => {
        if (message.method !== cfProtocolNotifications.processNetworkRequests) return;
        const result = networkCaptureBatchSchema.safeParse(message.params);
        if (!result.success || result.data.captureId !== this.captureId) return;
        this.sink?.({
          ...result.data,
          records: result.data.records.map((record) => ({
            ...record,
            pid: entry.pid,
            processType: "cli",
          })),
        });
      });
    }
    void client
      .notify(cfProtocolMethods.processNetworkCapture, { captureId: this.captureId })
      .catch(() => {
        
      });
  }
}

export const localRuntimeNetworkCapture = new LocalRuntimeNetworkCapture();
