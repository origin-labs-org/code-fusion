import {
  ApiError,
  DEFAULT_CF_ENDPOINT_ORIGIN,
  normalizeCfEndpointOrigin,
  rewriteCfEndpointUrl,
  type ApiClient,
  type ApiRequestInit,
} from "@origin-ai/cf-shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { buildCfSourceHeaders } from "../sourceHeaders.js";
import { withRequestIdHeader } from "./requestIdHeaders.js";

const log = createServiceLogger("node-api-client");

interface NodeApiClientOptions {
  fetchImpl?: typeof fetch;
  onCfJwtInvalid?: (input: string | URL, headers: Headers) => void;
  isCfJwtRequest?: (input: string | URL, headers: Headers) => boolean | Promise<boolean>;
  isBusinessUnauthorizedRequest?: (
    input: string | URL,
    headers: Headers,
  ) => boolean | Promise<boolean>;
  businessUnauthorizedObservationTimeoutMs?: number;
  resolveBusinessCredentialValidationRequest?: (
    input: string | URL,
    headers: Headers,
  ) => Promise<{ url: string; authorization: string; emptyBodyMeansInvalid: boolean } | null>;
  resolveCfEndpointOrigin?: () => Promise<string> | string;
  
  resolveClientLanguage?: () => string | undefined;
}

const DEFAULT_BUSINESS_UNAUTHORIZED_OBSERVATION_TIMEOUT_MS = 1000;
const MAX_BUSINESS_UNAUTHORIZED_OBSERVATION_BYTES = 64 * 1024;

function waitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) {
      cleanup();
      abort();
    }
  });
}

function readChunkWithinTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  signal?: AbortSignal | null,
): Promise<{ done: boolean; value?: Uint8Array } | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  return waitWithAbort(Promise.race([reader.read(), timeout]), signal)
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}

function resolveMethod(init?: ApiRequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

function resolveUrl(input: string | URL): string {
  return typeof input === "string" ? input : input.toString();
}

async function readBusinessAuthenticationResponse(
  response: Response,
  timeoutMs: number,
  signal?: AbortSignal | null,
): Promise<"unauthorized" | "empty" | null> {
  if (response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream"))
    return null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (signal?.aborted) return null;
    const body = response.clone().body;
    if (!body) return "empty";
    reader = body.getReader();
    const decoder = new TextDecoder();
    const deadline = Date.now() + timeoutMs;
    let bytes = 0;
    let text = "";
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return null;
      const result = await readChunkWithinTimeout(reader, remainingMs, signal);
      if (!result) return null;
      if (result.done) break;
      if (!result.value) return null;
      bytes += result.value.byteLength;
      if (bytes > MAX_BUSINESS_UNAUTHORIZED_OBSERVATION_BYTES) return null;
      text += decoder.decode(result.value, { stream: true });
    }
    text += decoder.decode();
    if (bytes === 0) return "empty";
    const payload: unknown = JSON.parse(text);
    return typeof payload === "object" &&
      payload !== null &&
      "code" in payload &&
      payload.code === 401
      ? "unauthorized"
      : null;
  } catch {
    return null;
  } finally {
    if (reader) void reader.cancel().catch(() => undefined);
  }
}

function readHeaderKeys(headers: RequestInit["headers"] | undefined): string[] {
  if (!headers) {
    return [];
  }
  return [...new Headers(headers).keys()].sort();
}

function isRequestForEndpoint(input: string | URL, endpointOrigin: string): boolean {
  try {
    return new URL(resolveUrl(input)).origin === normalizeCfEndpointOrigin(endpointOrigin);
  } catch {
    return false;
  }
}

function withCfEndpointHeaders(
  headers: RequestInit["headers"] | undefined,
  endpointOrigin: string,
  clientLanguage: string | undefined,
): RequestInit["headers"] {
  const next = new Headers(buildCfSourceHeaders({ clientLanguage }));
  if (headers) {
    new Headers(headers).forEach((value, key) => {
      next.set(key, value);
    });
  }

  if (next.get("HTTP-Referer") === DEFAULT_CF_ENDPOINT_ORIGIN) {
    next.set("HTTP-Referer", endpointOrigin);
  }
  return next;
}

function resolveRequestHeaders(
  requestInput: string | URL,
  headers: RequestInit["headers"] | undefined,
  endpointOrigin: string,
  clientLanguage: string | undefined,
): RequestInit["headers"] | undefined {
  if (!isRequestForEndpoint(requestInput, endpointOrigin)) {
    return headers;
  }

  return withCfEndpointHeaders(headers, endpointOrigin, clientLanguage);
}

export class NodeApiClient implements ApiClient {
  private readonly fetchImpl?: typeof fetch;
  private readonly resolveCfEndpointOrigin?: () => Promise<string> | string;
  private readonly resolveClientLanguage?: NodeApiClientOptions["resolveClientLanguage"];
  private readonly onCfJwtInvalid?: (input: string | URL, headers: Headers) => void;
  private readonly isCfJwtRequest?: NodeApiClientOptions["isCfJwtRequest"];
  private readonly isBusinessUnauthorizedRequest?: NodeApiClientOptions["isBusinessUnauthorizedRequest"];
  private readonly businessUnauthorizedObservationTimeoutMs: number;
  private readonly resolveBusinessCredentialValidationRequest?: NodeApiClientOptions["resolveBusinessCredentialValidationRequest"];
  private readonly businessValidations = new Map<
    string,
    {
      promise: Promise<boolean>;
      controller: AbortController;
      subscribers: number;
    }
  >();

  constructor(options: NodeApiClientOptions = {}) {
    this.fetchImpl = options.fetchImpl;
    this.onCfJwtInvalid = options.onCfJwtInvalid;
    this.isCfJwtRequest = options.isCfJwtRequest;
    this.isBusinessUnauthorizedRequest = options.isBusinessUnauthorizedRequest;
    this.resolveBusinessCredentialValidationRequest =
      options.resolveBusinessCredentialValidationRequest;
    this.businessUnauthorizedObservationTimeoutMs =
      options.businessUnauthorizedObservationTimeoutMs ??
      DEFAULT_BUSINESS_UNAUTHORIZED_OBSERVATION_TIMEOUT_MS;
    this.resolveCfEndpointOrigin = options.resolveCfEndpointOrigin;
    this.resolveClientLanguage = options.resolveClientLanguage;
  }

  private async confirmBusinessCredentialInvalid(
    input: string | URL,
    headers: Headers,
    response: Response,
    evidence: "unauthorized" | "empty" | null,
    signal?: AbortSignal | null,
  ): Promise<boolean> {
    if (signal?.aborted) return false;
    const check = await this.resolveBusinessCredentialValidationRequest?.(input, headers);
    if (!check || signal?.aborted) return false;
    const requestUrl = new URL(input),
      identityUrl = new URL(check.url);
    if (requestUrl.origin === identityUrl.origin && requestUrl.pathname === identityUrl.pathname)
      return response.status === 200 && evidence === "empty" && check.emptyBodyMeansInvalid;
    const key = JSON.stringify([check.url, check.authorization]);
    let entry = this.businessValidations.get(key);
    if (!entry) {
      const controller = new AbortController();
      const validationSignal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(this.businessUnauthorizedObservationTimeoutMs),
      ]);
      const validation = Promise.resolve()
        .then(async () => {
          try {
            const identity = await waitWithAbort(
              (this.fetchImpl ?? globalThis.fetch)(check.url, {
                method: "GET",
                redirect: "error",
                headers: withRequestIdHeader({
                  Authorization: check.authorization,
                  "Content-Type": "application/json",
                }),
                signal: validationSignal,
              }),
              validationSignal,
            );
            if (identity.status === 401) return true;
            if (identity.status !== 200 && identity.status !== 403) return false;
            const result = await readBusinessAuthenticationResponse(
              identity,
              this.businessUnauthorizedObservationTimeoutMs,
              validationSignal,
            );
            return (
              result === "unauthorized" ||
              (identity.status === 200 && result === "empty" && check.emptyBodyMeansInvalid)
            );
          } catch {
            return false;
          }
        })
        .finally(() => {
          if (this.businessValidations.get(key)?.promise === validation)
            this.businessValidations.delete(key);
        });
      entry = { promise: validation, controller, subscribers: 0 };
      this.businessValidations.set(key, entry);
    }
    entry.subscribers += 1;
    try {
      return await waitWithAbort(entry.promise, signal);
    } finally {
      entry.subscribers -= 1;
      if (entry.subscribers === 0) {
        entry.controller.abort();
        if (this.businessValidations.get(key) === entry) this.businessValidations.delete(key);
      }
    }
  }

  async request(input: string | URL, init?: ApiRequestInit): Promise<Response> {
    const endpointOrigin = this.resolveCfEndpointOrigin
      ? await this.resolveCfEndpointOrigin()
      : undefined;
    const activeEndpointOrigin = endpointOrigin ?? DEFAULT_CF_ENDPOINT_ORIGIN;
    const requestInput = rewriteCfEndpointUrl(input, activeEndpointOrigin);
    const url = resolveUrl(requestInput);
    const method = resolveMethod(init);
    const timeoutMs = init?.timeoutMs;
    const controller = timeoutMs && timeoutMs > 0 ? new AbortController() : null;
    let didTimeout = false;
    const timer =
      controller && timeoutMs
        ? setTimeout(() => {
            didTimeout = true;
            controller.abort();
          }, timeoutMs)
        : null;

    try {
      const signal = controller
        ? init?.signal
          ? AbortSignal.any([init.signal, controller.signal])
          : controller.signal
        : init?.signal;
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const fetchImpl = this.fetchImpl ?? globalThis.fetch;
      const requestHeaders = withRequestIdHeader(
        resolveRequestHeaders(
          requestInput,
          init?.headers,
          activeEndpointOrigin,
          this.resolveClientLanguage?.(),
        ),
      );
      if (isRequestForEndpoint(requestInput, activeEndpointOrigin)) {
        log.debug(undefined, "cf endpoint request headers prepared", {
          headerKeys: readHeaderKeys(requestHeaders),
          method,
          url,
        });
      }
      const response = await fetchImpl(requestInput, {
        ...init,
        headers: requestHeaders,
        ...(signal ? { signal } : {}),
      });
      if ([200, 401, 403].includes(response.status) && this.onCfJwtInvalid) {
        try {
          await waitWithAbort(
            (async () => {
              const requestHeadersForObservation = new Headers(requestHeaders);
              const isCurrentCfJwtRequest = await this.isCfJwtRequest?.(
                requestInput,
                requestHeadersForObservation,
              );
              if (isCurrentCfJwtRequest) {
                let invalid = response.status === 401;
                if (
                  !invalid &&
                  (await this.isBusinessUnauthorizedRequest?.(
                    requestInput,
                    requestHeadersForObservation,
                  ))
                ) {
                  const evidence = await readBusinessAuthenticationResponse(
                    response,
                    this.businessUnauthorizedObservationTimeoutMs,
                    signal,
                  );
                  invalid = evidence === "unauthorized";
                  if (
                    !invalid &&
                    (response.status === 403 || (response.status === 200 && evidence === "empty"))
                  )
                    invalid = await this.confirmBusinessCredentialInvalid(
                      requestInput,
                      requestHeadersForObservation,
                      response,
                      evidence,
                      signal,
                    );
                }
                if (invalid && !signal?.aborted)
                  this.onCfJwtInvalid?.(requestInput, requestHeadersForObservation);
              }
            })(),
            signal,
          );
        } catch (error) {
          if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
          log.warn("cf jwt invalid response observation failed", { error });
        }
      }
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      return response;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError({
          message:
            didTimeout && timeoutMs ? `Request timed out after ${timeoutMs}ms` : error.message,
          url,
          method,
          cause: error,
        });
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError({
        message,
        url,
        method,
        cause: error,
      });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

export function createNodeApiClient(options: NodeApiClientOptions = {}): ApiClient {
  return new NodeApiClient(options);
}
