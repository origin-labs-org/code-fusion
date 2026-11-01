/**
 * TypeScript client SDK for the CodeFusion runtime: spawn the
 * `cf-jsonrpc-agent` runtime as a subprocess and drive agent turns over
 * stdio JSON-RPC. `CodeFusion` is the high-level run API;
 * `HarnessClient` is the lower-level protocol client. A pure library — it
 * registers nothing on a Cordis context; the runtime process it spawns is a
 * complete harness configured by its own `cordis.yml`.
 *
 * @module @origin-ai/cf-sdk-client
 */

export { CodeFusion, HarnessSession } from './api.ts'
export type { RunOptions } from './api.ts'
export {
  HarnessClient,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
} from './client.ts'
export type { NotificationSubscription } from './client.ts'
export { JsonRpcResponseError } from '@origin-ai/cf-sdk-protocol'
export type {
  ContentBlock,
  CodeFusionOptions,
  HarnessClientOptions,
  HarnessNotification,
  NotificationFilter,
  RunResult,
} from './types.ts'
