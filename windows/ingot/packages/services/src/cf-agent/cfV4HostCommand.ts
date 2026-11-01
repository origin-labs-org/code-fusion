//
import { randomBytes } from "node:crypto";
import {
  COMMANDS_REQUIRING_BASE_REVISION,
  ROW_TARGETING_COMMANDS,
  type CommandAck,
  type CommandEnvelope,
  type CommandPayloadMap,
  type CommandType,
} from "@origin-ai/cf-shared/cf-protocol-v4";

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = BigInt(now);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  let hex = "";
  for (const byte of bytes) hex += HEX[byte];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const hostV4ClientId = `host-services-${uuidv7()}`;

export function getHostV4ClientId(): string {
  return hostV4ClientId;
}

export interface CreateHostCommandEnvelopeInput<T extends CommandType> {
  type: T;
  payload: CommandPayloadMap[T];
  
  sessionId: string | null;
  
  commandId?: string;
  
  clientId?: string;
  baseRevision?: number;
  baseLogEpoch?: string;
}

export function createHostCommandEnvelope<T extends CommandType>(
  input: CreateHostCommandEnvelopeInput<T>,
): CommandEnvelope {
  if (COMMANDS_REQUIRING_BASE_REVISION.has(input.type) && input.baseRevision === undefined) {
    throw new Error(
      `command ${input.type} Yes CAS Command，必须携带 baseRevision（10-protocol-spec §6.4）`,
    );
  }
  if (ROW_TARGETING_COMMANDS.has(input.type) && !input.baseLogEpoch) {
    throw new Error(
      `command ${input.type} Yes row target Command，必须携带 baseLogEpoch`,
    );
  }
  return {
    commandId: input.commandId ?? uuidv7(),
    clientId: input.clientId ?? hostV4ClientId,
    sessionId: input.sessionId,
    ...(input.baseRevision !== undefined
      ? { baseRevision: input.baseRevision }
      : {}),
    ...(input.baseLogEpoch ? { baseLogEpoch: input.baseLogEpoch } : {}),
    type: input.type,
    payload: input.payload,
    issuedAt: Date.now(),
  };
}

export class CfV4CommandRejectedError extends Error {
  readonly code = "CF_V4_COMMAND_REJECTED";

  constructor(
    readonly commandType: CommandType,
    readonly ack: CommandAck,
    contextMessage: string,
  ) {
    super(
      `v4 command ${commandType} ${ack.status}` +
        `${ack.reasonCode ? ` (${ack.reasonCode})` : ""}` +
        `${ack.message ? `: ${ack.message}` : ""} — ${contextMessage}`,
    );
    this.name = "CfV4CommandRejectedError";
  }
}

export function assertV4CommandAckOk(
  commandType: CommandType,
  ack: CommandAck,
  contextMessage: string,
): CommandAck {
  if (ack.status === "accepted" || ack.status === "duplicate" || ack.status === "noop") {
    return ack;
  }
  throw new CfV4CommandRejectedError(commandType, ack, contextMessage);
}

export async function sendHostCasCommandV4<T extends CommandType>(input: {
  send: (envelope: CommandEnvelope) => Promise<CommandAck>;
  type: T;
  payload: CommandPayloadMap[T];
  sessionId: string;
  contextMessage: string;
  maxAttempts?: number;
}): Promise<CommandAck> {
  const maxAttempts = input.maxAttempts ?? 4;
  let baseRevision = 0;
  let lastAck: CommandAck | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ack = await input.send(
      createHostCommandEnvelope({
        type: input.type,
        payload: input.payload,
        sessionId: input.sessionId,
        baseRevision,
      }),
    );
    if (ack.status === "stale") {
      lastAck = ack;
      baseRevision = ack.revisionAtDecision;
      continue;
    }
    return assertV4CommandAckOk(input.type, ack, input.contextMessage);
  }
  throw new CfV4CommandRejectedError(
    input.type,
    lastAck ?? {
      commandId: "",
      status: "stale",
      revisionAtDecision: baseRevision,
    },
    `${input.contextMessage}（连续 stale，放弃Retry）`,
  );
}
