

import { Event, Emitter, IDisposable, DisposableStore } from "./foundation.js";
import { IChannel, IServerChannel } from "./channels.js";

// ============================================================================
// ProxyChannel
// ============================================================================

export namespace ProxyChannel {
  
  export function fromService<TContext>(
    service: unknown,
    disposables?: DisposableStore,
  ): IServerChannel<TContext> {
    const handler = service as { [key: string]: unknown };

    const eventMap = new Map<string, Event<unknown>>();
    for (const key in handler) {
      if (isEvent(key) && !isDynamicEvent(key) && typeof handler[key] === "function") {
        eventMap.set(key, bufferEvent(handler[key] as Event<unknown>));
      }
    }

    return {
      listen<T>(_ctx: TContext, event: string, arg?: any): Event<T> {
        const cached = eventMap.get(event);
        if (cached) {
          return cached as Event<T>;
        }

        const target = handler[event];
        if (typeof target === "function") {
          if (isDynamicEvent(event)) {
            return target.call(handler, arg);
          }
          if (isEvent(event)) {
            eventMap.set(event, bufferEvent(handler[event] as Event<unknown>));
            return eventMap.get(event) as Event<T>;
          }
        }

        throw new Error(`Event not found: ${event}`);
      },

      call<T>(_ctx: TContext, command: string, args?: any[]): Promise<T> {
        const target = handler[command];
        if (typeof target === "function") {
          let result = target.apply(handler, args || []);
          if (!(result instanceof Promise)) {
            result = Promise.resolve(result);
          }
          return result;
        }
        throw new Error(`Method not found: ${command}`);
      },
    };
  }

  
  export function toService<T extends object>(
    channel: IChannel,
    options?: { context?: unknown },
  ): T {
    return new Proxy({} as T, {
      get(target: T, propKey: PropertyKey, receiver: object) {
        if (typeof propKey === "symbol") {
          return Reflect.get(target as object, propKey, receiver);
        }

        if (typeof propKey === "string") {
          if (propKey === "then") {
            return undefined;
          }

          if (isDynamicEvent(propKey)) {
            return (arg: unknown) => channel.listen(propKey, arg);
          }

          if (isEvent(propKey)) {
            return channel.listen(propKey);
          }

          return async (...args: unknown[]) => {
            const methodArgs = options?.context !== undefined ? [options.context, ...args] : args;
            return channel.call(propKey, methodArgs);
          };
        }

        return Reflect.get(target as object, propKey, receiver);
      },
    });
  }
}

// ============================================================================
// ============================================================================

function isEvent(name: string): boolean {
  return (
    name.length >= 3 &&
    name[0] === "o" &&
    name[1] === "n" &&
    name.charCodeAt(2) >= 65 && // A
    name.charCodeAt(2) <= 90
  ); // Z
}

function isDynamicEvent(name: string): boolean {
  return (
    name.length >= 10 &&
    name.startsWith("onDynamic") &&
    name.charCodeAt(9) >= 65 &&
    name.charCodeAt(9) <= 90
  );
}

function bufferEvent<T>(event: Event<T>): Event<T> {
  let buffer: T[] = [];
  let flushing = false;
  let listener: IDisposable | undefined;

  const emitter = new Emitter<T>({
    onWillAddFirstListener: () => {
      listener = event((e) => {
        if (flushing) {
          emitter.fire(e);
        } else {
          buffer.push(e);
        }
      });
    },
    onDidRemoveLastListener: () => {
      listener?.dispose();
      listener = undefined;
      buffer = [];
    },
  });

  const originalEvent = emitter.event;
  return (listener_fn) => {
    const disposable = originalEvent(listener_fn);
    if (!flushing) {
      flushing = true;
      for (const item of buffer) {
        emitter.fire(item);
      }
      buffer = [];
    }
    return disposable;
  };
}
