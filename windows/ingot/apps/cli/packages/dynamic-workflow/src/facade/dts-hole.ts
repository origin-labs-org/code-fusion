

export const FACADE_HOLE_SEGMENT = String.raw`
/**
 * A typed gap: code you write later, once an earlier step's findings are in. When the run
 * reaches an unfilled hole, that branch waits while you write the body (FillWorkflowHole);
 * the rest of the run keeps going. prompt is the message you will receive, so interpolate
 * the values the decision needs. The body runs in the hole's place, sees the bindings
 * declared before it, and returns the hole's value. The filled form passes the body last.
 */
declare function hole<T>(name: string, prompt?: string): Promise<T>;
declare function hole<T>(name: string, body: () => Promise<T>): Promise<T>;
declare function hole<T>(name: string, prompt: string, body: () => Promise<T>): Promise<T>;
`;
