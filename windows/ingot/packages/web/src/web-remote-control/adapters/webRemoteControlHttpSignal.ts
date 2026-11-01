
export async function withWebRemoteControlHttpSignal<T>(
  signal: AbortSignal,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new DOMException("Request aborted", "AbortError");

  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    15_000,
  );
  try {
    return await request(controller.signal);
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
