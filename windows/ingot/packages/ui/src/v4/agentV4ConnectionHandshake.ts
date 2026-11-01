import type { ICfAgentService } from "@origin-ai/cf-services";
import {
  V4_WIRE_PROTOCOL_VERSION,
  helloMessageSchema,
  hostSupportsWorkflowRunDeltas,
  type ClientHello,
  type HelloMessage,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { getV4ClientId } from "@/v4/commandFactory.js";

type AgentV4HandshakeService = Pick<
  ICfAgentService,
  "helloConversationV4" | "initializeConversationV4"
>;

const handshakes = new WeakMap<object, Promise<HelloMessage>>();
export function ensureAgentV4ConnectionHandshake(
  service: AgentV4HandshakeService,
): Promise<HelloMessage> {
  const key = service as object;
  const existing = handshakes.get(key);
  if (existing) return existing;

  const handshake = (async () => {
    const hello = helloMessageSchema.parse(await service.helloConversationV4());
    const capabilities: NonNullable<ClientHello["capabilities"]> = {
      workspaceHookReviewUi: true,
      ...(hello.capabilities.historyFirst === true ? { historyFirst: true } : {}),
      ...(hostSupportsWorkflowRunDeltas(hello.capabilities) ? { workflowRunDeltas: true } : {}),
    };
    await service.initializeConversationV4({
      kind: "clientHello",
      protocolVersion: V4_WIRE_PROTOCOL_VERSION,
      clientId: getV4ClientId(),
      clientKind: hello.clientMode === "desktop-continuous" ? "desktop" : "web",
      appVersion: "unknown",
      capabilities,
    });
    return hello;
  })();
  handshakes.set(key, handshake);
  void handshake.catch(() => {
    if (handshakes.get(key) === handshake) handshakes.delete(key);
  });
  return handshake;
}
