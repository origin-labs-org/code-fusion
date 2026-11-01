import type { UtilityProcess as ElectronUtilityProcess } from "electron";
import {
  HostMessageTypes,
  HostResponseTypes,
  broadcastMessageSchema,
  formatZodError,
  hostResponseMessageSchema,
} from "@origin-ai/cf-shared";
import type { BroadcastMessage } from "@origin-ai/cf-services";
import { logger } from "./logger.js";

const MAX_BROADCAST_CLAIMS = 1_024;
const BROADCAST_CLAIM_RESERVATION_TTL_MS = 5_000;
const BROADCAST_CLAIM_RETRY_MS = 250;
let claimTokenSequence = 0;

type BroadcastClaimRecord = {
  token: string;
  ownerWindowId: number;
  status: "reserved" | "committed";
  expiresAt: number | null;
};

function createClaimToken(windowId: number, requestId: string): string {
  claimTokenSequence += 1;
  return `${windowId}:${requestId}:${claimTokenSequence}`;
}

export class BroadcastHub {
  private processes = new Map<number, ElectronUtilityProcess>();
  
  private readonly claims = new Map<string, BroadcastClaimRecord>();

  
  collectMemoryDiagnostics(): Record<string, number> {
    return { claims: this.claims.size, processes: this.processes.size };
  }

  
  register(windowId: number, child: ElectronUtilityProcess): void {
    this.processes.set(windowId, child);

    child.on("message", (msg: unknown) => {
      const result = hostResponseMessageSchema.safeParse(msg);
      if (!result.success) {
        logger.warn("[BroadcastHub] invalid host response message:", formatZodError(result.error));
        return;
      }
      if (result.data.type === HostResponseTypes.Broadcast) {
        this.relay(windowId, result.data.message);
        return;
      }
      if (result.data.type === HostResponseTypes.BroadcastClaimRequest) {
        this.handleClaim(windowId, child, result.data.requestId, result.data.key);
        return;
      }
      if (result.data.type === HostResponseTypes.BroadcastClaimCommit) {
        this.handleClaimCommit(windowId, result.data.key, result.data.claimToken);
        return;
      }
      if (result.data.type === HostResponseTypes.BroadcastClaimRelease) {
        this.handleClaimRelease(windowId, result.data.key, result.data.claimToken);
      }
    });
  }

  
  unregister(windowId: number): void {
    this.processes.delete(windowId);
    for (const [key, claim] of this.claims) {
      if (claim.ownerWindowId === windowId && claim.status === "reserved") {
        this.claims.delete(key);
      }
    }
  }

  private pruneExpiredReservations(now = Date.now()): void {
    for (const [key, claim] of this.claims) {
      if (claim.status === "reserved" && claim.expiresAt !== null && claim.expiresAt <= now) {
        this.claims.delete(key);
      }
    }
    while (this.claims.size > MAX_BROADCAST_CLAIMS) {
      const oldest = this.claims.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.claims.delete(oldest);
    }
  }

  
  private handleClaim(
    windowId: number,
    source: ElectronUtilityProcess,
    requestId: string,
    key: string,
  ): void {
    const now = Date.now();
    this.pruneExpiredReservations(now);
    const existing = this.claims.get(key);
    if (existing?.status === "committed") {
      source.postMessage({
        type: HostMessageTypes.BroadcastClaimResult,
        requestId,
        status: "committed",
      });
      return;
    }
    if (existing) {
      source.postMessage({
        type: HostMessageTypes.BroadcastClaimResult,
        requestId,
        status: "busy",
        retryAfterMs: Math.max(
          0,
          Math.min(BROADCAST_CLAIM_RETRY_MS, (existing.expiresAt ?? now) - now),
        ),
      });
      return;
    }

    const claimToken = createClaimToken(windowId, requestId);
    this.claims.set(key, {
      token: claimToken,
      ownerWindowId: windowId,
      status: "reserved",
      expiresAt: now + BROADCAST_CLAIM_RESERVATION_TTL_MS,
    });
    this.pruneExpiredReservations(now);
    source.postMessage({
      type: HostMessageTypes.BroadcastClaimResult,
      requestId,
      status: "acquired",
      claimToken,
    });
  }

  private handleClaimCommit(windowId: number, key: string, claimToken: string): void {
    this.pruneExpiredReservations();
    const current = this.claims.get(key);
    if (
      current?.status === "reserved" &&
      current.ownerWindowId === windowId &&
      current.token === claimToken
    ) {
      this.claims.set(key, { ...current, status: "committed", expiresAt: null });
    }
  }

  private handleClaimRelease(windowId: number, key: string, claimToken: string): void {
    this.pruneExpiredReservations();
    const current = this.claims.get(key);
    if (
      current?.status === "reserved" &&
      current.ownerWindowId === windowId &&
      current.token === claimToken
    ) {
      this.claims.delete(key);
    }
  }

  
  private relay(sourceWindowId: number, message: BroadcastMessage): void {
    const result = broadcastMessageSchema.safeParse(message);
    if (!result.success) {
      logger.warn("[BroadcastHub] invalid broadcast message:", formatZodError(result.error));
      return;
    }

    const enriched: BroadcastMessage = { ...result.data, sourceWindowId };

    for (const [id, proc] of this.processes) {
      if (id !== sourceWindowId) {
        proc.postMessage({ type: HostMessageTypes.Broadcast, message: enriched });
      }
    }
  }
}
