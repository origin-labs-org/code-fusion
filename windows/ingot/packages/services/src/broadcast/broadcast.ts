import type { Event } from "@origin-ai/cf-rpc";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface BroadcastMessage {
  
  channel: string;
  
  payload: unknown;
  
  sourceWindowId?: number;
}

export interface BroadcastClaimLease {
  key: string;
  token: string;
}

export type BroadcastClaimAcquireResult =
  | { status: "acquired"; lease: BroadcastClaimLease }
  | { status: "busy"; retryAfterMs: number }
  | { status: "committed" }
  | { status: "unavailable" };

export interface IBroadcastService {
  
  send(message: BroadcastMessage): Promise<void>;
  
  acquireClaim(key: string): Promise<BroadcastClaimAcquireResult>;
  
  commitClaim(lease: BroadcastClaimLease): Promise<void>;
  
  releaseClaim(lease: BroadcastClaimLease): Promise<void>;
  
  tryClaim(key: string): Promise<boolean>;
  
  onMessage: Event<BroadcastMessage>;
}

export const IBroadcastService = createServiceDescriptor<IBroadcastService>(
  ServiceChannels.Broadcast,
);
