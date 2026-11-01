import type {
  V4InteractionAnswer,
  V4InteractionRegistrationOptions,
} from "../cf-protocol-v4/interaction-registry.js";
import type { CfProtocolAgentServerContext } from "./server-types.js";

export async function raceClientRequestWithV4Interaction<T>(
  context: CfProtocolAgentServerContext,
  interactionId: string,
  outerSignal: AbortSignal | undefined,
  startRequest: (signal: AbortSignal) => Promise<T>,
  mapAnswer: (answer: V4InteractionAnswer) => T,
  registrationOptions?: V4InteractionRegistrationOptions,
  onRegistered?: () => void,
): Promise<T> {
  const controller = new AbortController();
  let fullAccessFailure: Promise<void> | undefined;
  let finishAnswer!: () => void;
  const answerReady = new Promise<void>((resolve) => {
    finishAnswer = resolve;
  });
  const forwardAbort = () => {
    controller.abort();
    finishAnswer();
  };
  if (outerSignal?.aborted) {
    controller.abort();
  } else {
    outerSignal?.addEventListener("abort", forwardAbort, { once: true });
  }

  let v4Answer: { answer: V4InteractionAnswer } | undefined;
  const unregister = context.v4Interactions.register(
    interactionId,
    (answer) => {
      v4Answer = { answer };
      controller.abort();
      finishAnswer();
    },
    registrationOptions?.fullAccess
      ? {
          ...registrationOptions,
          fullAccess: async () => {
            let notifyFailure!: () => void;
            const failure = new Promise<void>((resolve) => {
              notifyFailure = resolve;
            });
            fullAccessFailure = failure;
            try {
              await registrationOptions.fullAccess!();
            } catch (error) {
              if (fullAccessFailure === failure) fullAccessFailure = undefined;
              notifyFailure();
              throw error;
            }
          },
        }
      : registrationOptions,
  );

  const waitForFullAccess = async () => {
    while (fullAccessFailure && !v4Answer && !outerSignal?.aborted) {
      await Promise.race([fullAccessFailure, answerReady]);
    }
  };

  try {
    onRegistered?.();
    const result = await startRequest(controller.signal);
    if (fullAccessFailure) {
      await waitForFullAccess();
      if (v4Answer) return mapAnswer(v4Answer.answer);
      outerSignal?.throwIfAborted();
    }
    return result;
  } catch (error) {
    if (fullAccessFailure) await waitForFullAccess();
    if (v4Answer) {
      return mapAnswer(v4Answer.answer);
    }
    throw error;
  } finally {
    unregister();
    outerSignal?.removeEventListener("abort", forwardAbort);
  }
}
