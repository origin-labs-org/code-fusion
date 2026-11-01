import { createPluginSandboxRelay, resolvePluginSandboxShellIdentity } from "./relay.js";

const root = document.getElementById("root") ?? document.body;
const errorNode = document.getElementById("error");
const identity = resolvePluginSandboxShellIdentity(window.location.href);
let frameElement: HTMLIFrameElement | null = null;

function showError(message: string): void {
  if (errorNode) {
    errorNode.textContent = message;
    errorNode.hidden = false;
  }
}

if (!identity) {
  showError(`Plugin sandbox: unexpected shell origin ${window.location.origin}`);
} else {
  const relay = createPluginSandboxRelay({
    ...identity,
    createPluginFrame(src, allow) {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
      if (allow) iframe.setAttribute("allow", allow);
      iframe.setAttribute("referrerpolicy", "no-referrer");
      iframe.title = "plugin";
      iframe.src = src;
      iframe.addEventListener("error", () =>
        console.warn(`[plugin-sandbox-shell] frame error src=${src}`),
      );
      root.appendChild(iframe);
      frameElement = iframe;
      return {
        postMessage(message, targetOrigin) {
          iframe.contentWindow?.postMessage(message, targetOrigin);
        },
        remove() {
          iframe.remove();
          if (frameElement === iframe) frameElement = null;
        },
      };
    },
    showError,
    log: (message) => console.warn(message),
  });

  window.addEventListener("message", (event) => {
    if (event.source === window && event.origin === window.location.origin) {
      relay.handleInit(
        event.data,
        event.ports as unknown as Parameters<typeof relay.handleInit>[1],
      );
      return;
    }
    if (
      frameElement &&
      event.source === frameElement.contentWindow &&
      event.origin === identity.pluginOrigin
    ) {
      relay.handleFrameMessage(event.data);
      return;
    }
    console.warn(
      `[plugin-sandbox-shell] dropped message origin=${event.origin} expected=${identity.pluginOrigin} fromFrame=${String(
        Boolean(frameElement && event.source === frameElement.contentWindow),
      )}`,
    );
  });

  window.addEventListener("beforeunload", () => relay.dispose());
}
