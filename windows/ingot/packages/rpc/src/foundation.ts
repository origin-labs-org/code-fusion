

// ============================================================================
// ============================================================================

export interface IDisposable {
  dispose(): void;
}

export function toDisposable(fn: () => void): IDisposable {
  return { dispose: once(fn) };
}

function once(fn: () => void): () => void {
  let called = false;
  return () => {
    if (!called) {
      called = true;
      fn();
    }
  };
}

export class DisposableStore implements IDisposable {
  private items = new Set<IDisposable>();
  private isDisposed = false;

  add<T extends IDisposable>(item: T): T {
    if (this.isDisposed) {
      console.warn("Adding to a disposed DisposableStore");
      item.dispose();
      return item;
    }
    this.items.add(item);
    return item;
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    for (const item of this.items) {
      item.dispose();
    }
    this.items.clear();
  }
}

// ============================================================================
// ============================================================================

export type Event<T> = (listener: (e: T) => void) => IDisposable;

export namespace Event {
  
  export const None: Event<any> = () => ({ dispose() {} });

  
  export function once<T>(event: Event<T>): Event<T> {
    return (listener) => {
      let fired = false;
      const disposable = event((e) => {
        if (!fired) {
          fired = true;
          disposable.dispose();
          listener(e);
        }
      });
      return disposable;
    };
  }

  
  export function toPromise<T>(event: Event<T>): Promise<T> {
    return new Promise((resolve) => once(event)(resolve));
  }

  
  export function filter<T>(event: Event<T>, fn: (e: T) => boolean): Event<T> {
    return (listener) =>
      event((e) => {
        if (fn(e)) {
          listener(e);
        }
      });
  }

  
  export function map<T, R>(event: Event<T>, fn: (e: T) => R): Event<R> {
    return (listener) => event((e) => listener(fn(e)));
  }
}

export class Emitter<T> implements IDisposable {
  private listeners = new Set<(e: T) => void>();
  private disposed = false;
  private options?: EmitterOptions;

  constructor(options?: EmitterOptions) {
    this.options = options;
  }

  get event(): Event<T> {
    return (listener: (e: T) => void) => {
      if (this.disposed) {
        return { dispose() {} };
      }

      const isFirst = this.listeners.size === 0;
      this.listeners.add(listener);

      if (isFirst) {
        this.options?.onWillAddFirstListener?.();
      }

      return toDisposable(() => {
        this.listeners.delete(listener);
        if (this.listeners.size === 0) {
          this.options?.onDidRemoveLastListener?.();
        }
      });
    };
  }

  fire(event: T): void {
    if (this.disposed) {
      return;
    }
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

interface EmitterOptions {
  onWillAddFirstListener?: () => void;
  onDidRemoveLastListener?: () => void;
}

export class Relay<T> implements IDisposable {
  private emitter = new Emitter<T>();
  private inputDisposable: IDisposable = { dispose() {} };

  readonly event = this.emitter.event;

  set input(event: Event<T>) {
    this.inputDisposable.dispose();
    this.inputDisposable = event((e) => this.emitter.fire(e));
  }

  dispose(): void {
    this.inputDisposable.dispose();
    this.emitter.dispose();
  }
}

export class EventMultiplexer<T> implements IDisposable {
  private readonly emitter = new Emitter<T>();
  private readonly disposables: IDisposable[] = [];

  readonly event = this.emitter.event;

  add(event: Event<T>): IDisposable {
    const d = event((e) => this.emitter.fire(e));
    this.disposables.push(d);
    return d;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.emitter.dispose();
  }
}

// ============================================================================
// ============================================================================

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: Event<void>;
}

export namespace CancellationToken {
  export const None: CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: Event.None,
  };
}

export class CancellationTokenSource implements IDisposable {
  private _token?: CancellationToken;
  private emitter = new Emitter<void>();
  private _isCancelled = false;

  get token(): CancellationToken {
    if (!this._token) {
      this._token = {
        isCancellationRequested: false,
        onCancellationRequested: this.emitter.event,
      };
    }
    return this._token;
  }

  cancel(): void {
    if (!this._isCancelled) {
      this._isCancelled = true;
      this.emitter.fire();
    }
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
