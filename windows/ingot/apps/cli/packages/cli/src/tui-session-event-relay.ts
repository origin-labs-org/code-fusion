//
import type { SessionEvent } from "@origin-ai/cf-contracts";

type SessionEventSubscriberReader = (
  runtime: unknown,
) => ((sink: { onSessionEvent: (event: SessionEvent) => void }) => () => void) | undefined;

interface TuiSessionEventRelay {
  
  addSink: (sink: (event: SessionEvent) => void) => () => void;
  
  reattach: () => void;
  
  detach: () => void;
  
  isAttached: () => boolean;
}

export function createTuiSessionEventRelay(input: {
  
  currentRuntime: () => unknown;
  readSubscriber: SessionEventSubscriberReader;
}): TuiSessionEventRelay {
  const sinks = new Set<(event: SessionEvent) => void>();
  let detachCurrent: (() => void) | undefined;

  const detach = (): void => {
    detachCurrent?.();
    detachCurrent = undefined;
  };

  const reattach = (): void => {
    detach();
    if (sinks.size === 0) return;
    const subscribe = input.readSubscriber(input.currentRuntime());
    detachCurrent = subscribe?.({
      onSessionEvent: (event) => {
        for (const sink of sinks) sink(event);
      },
    });
  };

  return {
    addSink: (sink) => {
      sinks.add(sink);
      if (sinks.size === 1) reattach();
      return () => {
        sinks.delete(sink);
        if (sinks.size === 0) detach();
      };
    },
    reattach,
    detach,
    isAttached: () => detachCurrent !== undefined,
  };
}
