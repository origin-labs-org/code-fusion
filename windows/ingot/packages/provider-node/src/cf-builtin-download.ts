import { z } from "zod";
import { decodeCfBuiltinRelease, type CfBuiltinRelease } from "./cf-builtin-release.js";

const clientConfigSchema = z
  .object({
    code: z.literal(0),
    data: z
      .object({
        configs: z
          .object({
            builtin_provider_config_json: z
              .string()
              .url()
              .refine((value) => {
                const url = new URL(value);
                return url.protocol === "https:" && !url.username && !url.password;
              })
              .optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export interface CfBuiltinDownloadOptions {
  readonly endpointOrigin: string;
  readonly appVersion: string;
  readonly platform: string;
  readonly request: (url: string | URL, init: RequestInit) => Promise<Response>;
  readonly signal?: AbortSignal;
}

export async function downloadCfBuiltinRelease(
  options: CfBuiltinDownloadOptions,
): Promise<CfBuiltinRelease | null> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20_000);
  timer.unref?.();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  let stage = "client-config";
  try {
    const url = new URL("/api/v1/client/configs", options.endpointOrigin);
    url.searchParams.set("app_version", options.appVersion);
    url.searchParams.set("platform", options.platform);
    const payload = clientConfigSchema.parse(await readJson(url));
    const downloadUrl = payload.data.configs.builtin_provider_config_json;
    if (downloadUrl === undefined) return null;
    stage = "cdn";
    return decodeCfBuiltinRelease(await readJson(new URL(downloadUrl)));
  } catch (error) {
    const reason = signal.aborted
      ? timedOut
        ? "timeout"
        : "cancelled"
      : error instanceof DownloadBoundaryError
        ? error.message
        : error instanceof z.ZodError
          ? `invalid schema at ${error.issues[0]?.path.join(".") || "root"} (${error.issues[0]?.code})`
          : "invalid response";
    throw new Error(`CodeFusion Built-in ${stage}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  async function readJson(url: URL): Promise<unknown> {
    signal.throwIfAborted();
    const response = await abortable(
      options
        .request(url, { method: "GET", signal, credentials: "omit", redirect: "error" })
        .then((value) => {
          if (signal.aborted) {
            void value.body?.cancel().catch(() => {});
            signal.throwIfAborted();
          }
          return value;
        }),
      signal,
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new DownloadBoundaryError(`HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new DownloadBoundaryError("empty body");
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await abortable(reader.read(), signal);
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 10_000_000) throw new DownloadBoundaryError("body limit exceeded");
        chunks.push(decoder.decode(part.value, { stream: true }));
      }
      chunks.push(decoder.decode());
      signal.throwIfAborted();
      return JSON.parse(chunks.join("")) as unknown;
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
}

class DownloadBoundaryError extends Error {}

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
