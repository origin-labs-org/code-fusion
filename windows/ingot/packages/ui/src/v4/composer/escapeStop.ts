export function shouldIgnoreEscapeForStopGeneration(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) {
    return true;
  }

  const path = event.composedPath();
  return path.some((target) => {
    if (!target || typeof target !== "object") {
      return false;
    }

    const maybeElement = target as {
      dataset?: { slot?: string };
      getAttribute?: (name: string) => string | null;
    };
    return (
      maybeElement.dataset?.slot === "dialog-content" ||
      maybeElement.getAttribute?.("role") === "dialog"
    );
  });
}
