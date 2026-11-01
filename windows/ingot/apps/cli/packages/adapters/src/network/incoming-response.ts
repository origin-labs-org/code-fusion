import type http from "node:http";
import { Readable } from "node:stream";

const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

const MIN_WEB_RESPONSE_STATUS = 200;
const MAX_WEB_RESPONSE_STATUS = 599;

const MISSING_STATUS = 502;

export const UNSUPPORTED_HTTP_STATUS_CODE = "CF_UNSUPPORTED_HTTP_STATUS";

export interface IncomingResponse {
  status: number;
  statusText: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

export class UnsupportedHttpStatusError extends TypeError {
  readonly code = UNSUPPORTED_HTTP_STATUS_CODE;

  constructor(readonly status: number) {
    super(
      `HTTP response status ${status} is outside ${MIN_WEB_RESPONSE_STATUS}-${MAX_WEB_RESPONSE_STATUS} and cannot be returned as a fetch Response`,
    );
  }
}

export function readIncomingResponse(message: http.IncomingMessage): IncomingResponse {
  const status = message.statusCode ?? MISSING_STATUS;
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.append(name, String(value));
    }
  }
  const nullBody = NULL_BODY_STATUSES.has(status);
  if (nullBody) message.resume();
  return {
    body: nullBody ? null : (Readable.toWeb(message) as ReadableStream<Uint8Array>),
    headers,
    status,
    statusText: message.statusMessage ?? "",
  };
}

export function toWebResponse(incoming: IncomingResponse): Response {
  if (incoming.status < MIN_WEB_RESPONSE_STATUS || incoming.status > MAX_WEB_RESPONSE_STATUS) {
    throw new UnsupportedHttpStatusError(incoming.status);
  }
  return new Response(incoming.body, {
    headers: incoming.headers,
    status: incoming.status,
    statusText: incoming.statusText,
  });
}
