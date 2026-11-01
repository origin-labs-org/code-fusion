interface BrowserOperationResultLike {
  ok?: unknown;
  meta?: unknown;
  tab?: unknown;
}

export function browserOperationResetsResizeBaseline(command: unknown): boolean {
  if (!command || typeof command !== "object") return false;
  const method = Reflect.get(command, "method");
  if (method === "browserVisibilitySet") return Reflect.get(command, "visible") === true;
  return ["activateTab", "browserViewportReset", "browserViewportSet", "newTab"].includes(
    String(method),
  );
}

function readTabId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const tabId = Reflect.get(value, "tabId");
  return typeof tabId === "string" && tabId.length > 0 ? tabId : undefined;
}

export function resolveBrowserOperationTabId(
  command: unknown,
  result?: BrowserOperationResultLike,
): string | undefined {
  const requestedTabId = readTabId(command);
  if (requestedTabId) return requestedTabId;
  if (result?.ok !== true) return undefined;
  return readTabId(result.meta) ?? readTabId(result.tab);
}
