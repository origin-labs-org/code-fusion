

export const FACADE_STREAM_SEGMENT = String.raw`
/**
 * A stream of typed items between two stages: one stage send()s, another drains it with
 * for await. Unbounded, first-in-first-out, each item to exactly one receiver.
 */
declare interface Channel<T> extends AsyncIterable<T> {
  /** Enqueue one item; synchronous, never waits. Throws ChannelClosed after close(). */
  send(item: T): void;
  /**
   * End the stream: receivers get the remaining items, then their loops exit. Idempotent.
   * A channel nobody closes fails the run as ChannelDeadlock, naming it, once nothing in
   * flight could send to it again.
   */
  close(): void;
}

/**
 * Create a channel. The name labels the deadlock message; it is not an identity. A receiver
 * on an empty, open channel waits until a send or the close.
 */
declare function channel<T>(name?: string): Channel<T>;

/**
 * Run an async block as a concurrent stage. It starts immediately, not when awaited, and
 * returns its promise.
 */
declare function future<T>(body: () => Promise<T>): Promise<T>;
`;
