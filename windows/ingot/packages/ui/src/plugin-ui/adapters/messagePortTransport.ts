import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import type { PluginSandboxTransportPort } from "@origin-ai/cf-shared/mcp-apps";

export function createPluginUiMessagePortTransport(port: PluginSandboxTransportPort): Transport {
  let closed = false;
  const transport: Transport = {
    async start() {
      port.onmessage = (event) => {
        if (closed) return;
        const data = event.data;
        if (
          typeof data !== "object" ||
          data === null ||
          (data as { jsonrpc?: unknown }).jsonrpc !== "2.0"
        ) {
          transport.onerror?.(new Error("plugin-ui: non JSON-RPC frame on sandbox port"));
          return;
        }
        transport.onmessage?.(data as JSONRPCMessage);
      };
      port.start?.();
    },
    async send(message) {
      if (closed) throw new Error("plugin-ui: sandbox transport closed");
      port.postMessage(message);
    },
    async close() {
      if (closed) return;
      closed = true;
      port.onmessage = null;
      port.close();
      transport.onclose?.();
    },
  };
  return transport;
}
