import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Model,
  ModelRequestAuth,
  ModelRequestAuthSource,
  ModelRequestDependencies,
} from "@origin-ai/cf-contracts";
import { projectExecutionErrorPayload } from "../helpers/turn-errors.js";
import type { OffPeakLifecycle } from "./lifecycle.js";

export interface OffPeakModelBinding {
  readonly requestDependencies: ModelRequestDependencies;
  wrap(model: Model): Model;
  release(): void;
}

const bindings = new WeakMap<ModelRequestDependencies, OffPeakModelBinding>();
export function getOffPeakModelBinding(
  dependencies?: ModelRequestDependencies,
): OffPeakModelBinding | undefined {
  return dependencies ? bindings.get(dependencies) : undefined;
}

export class OffPeakTicketAuthority {
  private ticketId: string;
  private requestAuth: ModelRequestAuth | undefined;
  private readonly attempts = new AsyncLocalStorage<{ ticketId: string }>();

  constructor(
    private readonly lifecycle: OffPeakLifecycle,
    private readonly initial: {
      ticketId: string;
      requestAuth?: ModelRequestAuth;
      requestAuthSource?: ModelRequestAuthSource;
      providerId: string;
      providerErrorCode: string;
    },
  ) {
    this.ticketId = initial.ticketId;
    this.requestAuth = initial.requestAuth && structuredClone(initial.requestAuth);
  }

  replaceTicket(renewalId: number, ticketId: string, auth: ModelRequestAuth): boolean {
    if (!this.lifecycle.replaceTicket(renewalId, ticketId)) return false;
    this.ticketId = ticketId;
    this.requestAuth = structuredClone(auth);
    return true;
  }

  createBinding(): OffPeakModelBinding {
    const lease = this.lifecycle.retainIdleModelRound();
    let released = false;
    const requestDependencies: ModelRequestDependencies = {
      requestAuth: {
        source: {
          resolve: async (input) => {
            if (released) throw new Error("off_peak_round_completed");
            const ticketId = await this.lifecycle.waitForTicket(input.abortSignal);
            if (ticketId !== this.ticketId) throw new Error("off_peak_ticket_mismatch");
            const attempt = this.attempts.getStore();
            if (attempt) attempt.ticketId = ticketId;
            const auth = this.requestAuth ?? (await this.initial.requestAuthSource?.resolve(input));
            if (!auth) throw new Error("off_peak_request_auth_missing");
            if (ticketId !== this.ticketId)
              return requestDependencies.requestAuth!.source!.resolve(input);
            return structuredClone(auth);
          },
        },
      },
    };
    const retryExpired = (error: unknown, ticketId: string, signal?: AbortSignal): boolean => {
      if (signal?.aborted) return false;
      const attribution = projectExecutionErrorPayload(error).attribution;
      if (
        attribution?.providerId !== this.initial.providerId ||
        attribution.providerErrorCode !== this.initial.providerErrorCode
      )
        return false;
      if (ticketId !== this.ticketId && !this.lifecycle.ownedByUser && !this.lifecycle.terminal)
        return true;
      return this.lifecycle.ticketExpired(ticketId) !== undefined;
    };
    const { lifecycle, attempts } = this;
    const wrap = (model: Model): Model =>
      Object.freeze<Model>({
        providerId: model.providerId,
        modelId: model.modelId,
        displayName: model.displayName,
        properties: model.properties,
        optionSpecs: model.optionSpecs,
        options: model.options,
        bind: (options) => wrap(model.bind(options)),
        async generateText(request) {
          while (true) {
            if (released) throw new Error("off_peak_round_completed");
            const attempt = {
              ticketId: await lifecycle.waitForTicket(request.abortSignal),
            };
            try {
              return await attempts.run(attempt, () => model.generateText(request));
            } catch (error) {
              if (!retryExpired(error, attempt.ticketId, request.abortSignal)) throw error;
            }
          }
        },
        async *streamText(request) {
          while (true) {
            if (released) throw new Error("off_peak_round_completed");
            const attempt = {
              ticketId: await lifecycle.waitForTicket(request.abortSignal),
            };
            const controller = new AbortController();
            const abortSignal = request.abortSignal
              ? AbortSignal.any([request.abortSignal, controller.signal])
              : controller.signal;
            const iterator = model.streamText({ ...request, abortSignal })[Symbol.asyncIterator]();
            let delivered = false;
            try {
              while (true) {
                const next = await attempts.run(attempt, () => iterator.next());
                if (next.done) return;
                delivered = true;
                yield next.value;
              }
            } catch (error) {
              if (delivered || !retryExpired(error, attempt.ticketId, request.abortSignal))
                throw error;
            } finally {
              controller.abort();
              void Promise.resolve()
                .then(() => attempts.run(attempt, () => iterator.return?.()))
                .catch(() => {});
            }
          }
        },
      });
    const binding: OffPeakModelBinding = {
      requestDependencies,
      wrap,
      release() {
        if (released) return;
        released = true;
        lease.release();
      },
    };
    bindings.set(requestDependencies, binding);
    return binding;
  }
}
