// ============================================================
// ============================================================
//
//

import type { ModelRequestAdmission } from "@origin-ai/cf-contracts";
import { refToString, type InstanceRef } from "@origin-ai/cf-dynamic-workflow";

export interface SeatGateSubagent {
  
  toolsInFlight(): number;
}

export interface SeatGateStats {
  limit: number;
  working: number;
  parked: number;
}

export interface WorkflowRunSeatGate {
  
  setLimit(limit: number): void;
  
  askStarted(key: string, instance: InstanceRef): void;
  
  askSettled(instance: InstanceRef): void;
  
  wrap(
    key: string,
    subagent: SeatGateSubagent,
    inner: ModelRequestAdmission | undefined,
  ): ModelRequestAdmission | undefined;
  stats(): SeatGateStats;
}

interface ParkedSeat {
  key: string;
  grant: () => void;
  refuse: (reason: unknown) => void;
}

export function createWorkflowRunSeatGate(input: { limit: number }): WorkflowRunSeatGate {
  let limit = Math.max(1, Math.floor(input.limit));
  
  const working = new Set<string>();
  
  const parked: ParkedSeat[] = [];
  
  const instances = new Map<string, string>();

  const parkedIndexOf = (key: string): number => parked.findIndex((seat) => seat.key === key);

  
  const unpark = (): void => {
    while (working.size < limit && parked.length > 0) {
      const seat = parked.shift()!;
      working.add(seat.key);
      seat.grant();
    }
  };

  
  const needsSeat = (key: string, subagent: SeatGateSubagent): boolean =>
    working.has(key) && subagent.toolsInFlight() === 0;

  const acquireSeat = async (key: string, signal: AbortSignal | undefined): Promise<void> => {
    if (working.size <= limit) return;
    if (signal?.aborted === true) throw signal.reason;
    working.delete(key);
    return await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const index = parkedIndexOf(key);
        if (index >= 0) {
          parked.splice(index, 1);
          //
          working.add(key);
        }
        reject(signal?.reason);
      };
      const seat: ParkedSeat = {
        key,
        grant: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        refuse: (reason) => {
          signal?.removeEventListener("abort", onAbort);
          reject(reason);
        },
      };
      parked.push(seat);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  return {
    setLimit: (next) => {
      limit = Math.max(1, Math.floor(next));
      unpark();
    },

    askStarted: (key, instance) => {
      instances.set(refToString(instance), key);
      if (parkedIndexOf(key) >= 0) return;
      working.add(key);
    },

    askSettled: (instance) => {
      const ref = refToString(instance);
      const key = instances.get(ref);
      if (key === undefined) return;
      instances.delete(ref);
      const parkedIndex = parkedIndexOf(key);
      if (parkedIndex >= 0) {
        const [seat] = parked.splice(parkedIndex, 1);
        seat?.refuse(new Error("workflow ask settled while waiting for a concurrency seat"));
        return;
      }
      if (!working.delete(key)) return;
      unpark();
    },

    wrap: (key, subagent, inner) => {
      if (inner === undefined) return undefined;
      return {
        tryAcquire: (request) => {
          if (needsSeat(key, subagent) && working.size > limit) return undefined;
          return inner.tryAcquire?.(request);
        },
        acquire: async (request) => {
          if (needsSeat(key, subagent)) await acquireSeat(key, request.signal);
          return await inner.acquire(request);
        },
      };
    },

    stats: () => ({ limit, working: working.size, parked: parked.length }),
  };
}
