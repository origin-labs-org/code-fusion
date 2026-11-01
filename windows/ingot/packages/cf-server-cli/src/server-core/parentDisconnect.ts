export interface ParentDisconnectSource {
  once(event: "disconnect", listener: () => void): unknown;
  off(event: "disconnect", listener: () => void): unknown;
}

export function installParentDisconnectHandler(
  onDisconnect: () => void | Promise<void>,
  source: ParentDisconnectSource = process,
): () => void {
  const handler = (): void => {
    void onDisconnect();
  };
  source.once("disconnect", handler);
  return () => source.off("disconnect", handler);
}
