import { AsyncLocalStorage } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";
import type { ClientRequest } from "node:http";
import {
  sanitizeNetworkCaptureUrl,
  type NetworkCaptureBatch,
  type NetworkRequestRecord,
} from "../networkCapture.js";

const excluded = new AsyncLocalStorage<boolean>();

export function withoutNetworkCapture<T>(operation: () => T): T {
  return excluded.run(true, operation);
}

export function createNodeNetworkCapture(
  processType: NetworkRequestRecord["processType"],
  onBatch: (batch: NetworkCaptureBatch) => void,
): { setCaptureId(captureId: string | null): void } {
  let captureId: string | null = null;
  let records: NetworkRequestRecord[] = [];
  let dropped = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (!captureId) return;
    const batch = { captureId, records, dropped };
    records = [];
    dropped = 0;
    try {
      onBatch(batch);
    } catch {
      
    }
  };
  const record = (method: string, rawUrl: string) => {
    if (!captureId || excluded.getStore() || method === "CONNECT") return;
    if (records.length >= 100) {
      dropped++;
      return;
    }
    const url = sanitizeNetworkCaptureUrl(rawUrl);
    if (!url) return;
    records.push({
      timestamp: Date.now(),
      processType,
      pid: process.pid,
      method: method.slice(0, 32),
      url,
    });
    timer ??= setTimeout(flush, 250);
    timer.unref();
  };
  const undici = (message: unknown) => {
    try {
      const { request } = message as {
        request: { method: string; origin: string; path: string; upgrade?: string };
      };
      const url = new URL(request.path, request.origin);
      if (request.upgrade?.toLowerCase() === "websocket")
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      record(request.method, url.href);
    } catch {
      
    }
  };
  const http = (message: unknown) => {
    try {
      const { request } = message as { request: ClientRequest };
      const url = new URL(
        request.path,
        `${request.protocol}//${String(request.getHeader("host") ?? request.host)}`,
      );
      if (String(request.getHeader("upgrade")).toLowerCase() === "websocket")
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      record(request.method, url.href);
    } catch {
      
    }
  };
  return {
    setCaptureId(next) {
      if (captureId === next) return;
      if (captureId) {
        channel("undici:request:create").unsubscribe(undici);
        channel("http.client.request.start").unsubscribe(http);
      }
      if (timer) clearTimeout(timer);
      timer = undefined;
      records = [];
      dropped = 0;
      captureId = next;
      if (captureId) {
        channel("undici:request:create").subscribe(undici);
        channel("http.client.request.start").subscribe(http);
      }
    },
  };
}
