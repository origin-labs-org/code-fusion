import { Emitter, type Event } from "@origin-ai/cf-rpc";

interface CloseEventController {
  event: Event<number>;
  fire(code: number): void;
}

export function createCloseEventController(): CloseEventController {
  const emitter = new Emitter<number>();
  let closed = false;
  let closeCode = 0;

  const event: Event<number> = (listener) => {
    if (closed) {
      queueMicrotask(() => {
        listener(closeCode);
      });
      return { dispose() {} };
    }

    return emitter.event(listener);
  };

  const fire = (code: number) => {
    if (closed) {
      return;
    }
    closed = true;
    closeCode = code;
    emitter.fire(code);
    emitter.dispose();
  };

  return { event, fire };
}
