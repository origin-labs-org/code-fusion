export interface ConfigCommandBarrier {
  enqueue<T>(command: () => Promise<T>): Promise<T>;
  wait(): Promise<void>;
}

export const CONFIG_COMMAND_SUPERSEDED = Symbol("config-command-superseded");

export interface LatestConfigCommandScheduler<T> {
  
  schedule(
    command: () => Promise<T>,
  ): Promise<T | typeof CONFIG_COMMAND_SUPERSEDED>;
  
  seal(): void;
}

export function createConfigCommandBarrier(): ConfigCommandBarrier {
  let pending: Promise<void> = Promise.resolve();

  return {
    enqueue<T>(command: () => Promise<T>): Promise<T> {
      const result = pending.then(command, command);
      pending = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    wait(): Promise<void> {
      return pending;
    },
  };
}

export function createLatestConfigCommandScheduler<T>(
  barrier: ConfigCommandBarrier,
): LatestConfigCommandScheduler<T> {
  interface Waiter {
    reject: (reason?: unknown) => void;
    resolve: (value: T | typeof CONFIG_COMMAND_SUPERSEDED) => void;
  }
  interface Slot {
    command: () => Promise<T>;
    waiter: Waiter;
  }

  let replaceableSlot: Slot | null = null;

  return {
    schedule(command) {
      return new Promise<T | typeof CONFIG_COMMAND_SUPERSEDED>(
        (resolve, reject) => {
          if (replaceableSlot) {
            replaceableSlot.waiter.resolve(CONFIG_COMMAND_SUPERSEDED);
            replaceableSlot.command = command;
            replaceableSlot.waiter = { reject, resolve };
            return;
          }

          const slot: Slot = {
            command,
            waiter: { reject, resolve },
          };
          replaceableSlot = slot;
          void barrier.enqueue(async () => {
            if (replaceableSlot === slot) {
              replaceableSlot = null;
            }
            const scheduledCommand = slot.command;
            const scheduledWaiter = slot.waiter;
            try {
              scheduledWaiter.resolve(await scheduledCommand());
            } catch (error) {
              scheduledWaiter.reject(error);
            }
          });
        },
      );
    },
    seal() {
      replaceableSlot = null;
    },
  };
}
