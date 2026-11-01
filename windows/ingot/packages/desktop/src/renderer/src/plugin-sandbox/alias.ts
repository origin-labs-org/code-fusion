import { App, LATEST_PROTOCOL_VERSION, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { CF_GLOBALS_EVENT, createPluginSandboxAliasRuntime } from "./aliasRuntime.js";
import { OPENAI_SET_GLOBALS_EVENT } from "./openaiAlias.js";

const app = new App(
  { name: "cf-alias", version: "1" },
  {},
  { autoResize: false },
);

const runtime = createPluginSandboxAliasRuntime({
  app,
  transport: new PostMessageTransport(window.parent, window.parent),
  protocolVersion: LATEST_PROTOCOL_VERSION,
  onChange: (globals) => {
    window.dispatchEvent(new CustomEvent(CF_GLOBALS_EVENT));
    window.dispatchEvent(new CustomEvent(OPENAI_SET_GLOBALS_EVENT, { detail: { globals } }));
  },
});

window.addEventListener("message", (event) => {
  if (runtime.connecting || event.source !== window.parent) return;
  const data = event.data as { jsonrpc?: unknown } | null;
  if (data && typeof data === "object" && data.jsonrpc === "2.0") runtime.markForeignApp();
});

Object.defineProperty(window, "cf", {
  value: runtime.cf,
  writable: false,
  configurable: false,
  enumerable: true,
});
if (!("openai" in window)) {
  Object.defineProperty(window, "openai", {
    value: runtime.openai,
    writable: false,
    configurable: false,
    enumerable: true,
  });
}
