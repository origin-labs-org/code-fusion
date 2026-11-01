import type {
  ModelRequestAdmission,
  ModelRequestAdmissionTicket,
  ModelRequestTarget,
} from "@origin-ai/cf-contracts";

export interface AttemptAdmission {
  
  readonly ticket?: ModelRequestAdmissionTicket;
  
  release(): void;
}

const NO_ADMISSION: AttemptAdmission = { release() {} };

export async function admitAttempt(input: {
  admission?: ModelRequestAdmission;
  model: ModelRequestTarget;
  signal?: AbortSignal;
  onQueued?: () => Promise<void>;
  onAdmitted?: (queuedMs: number) => Promise<void>;
}): Promise<AttemptAdmission> {
  if (input.admission === undefined) return NO_ADMISSION;
  const hasFastPath = typeof input.admission.tryAcquire === "function";
  let ticket = hasFastPath ? input.admission.tryAcquire!({ model: input.model }) : undefined;
  if (ticket === undefined) {
    const queuedAt = Date.now();
    if (hasFastPath) await input.onQueued?.();
    ticket = await input.admission.acquire({
      model: input.model,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (hasFastPath) await input.onAdmitted?.(Date.now() - queuedAt);
  }
  let released = false;
  return {
    ticket,
    release() {
      if (released) return;
      released = true;
      ticket.release();
    },
  };
}
