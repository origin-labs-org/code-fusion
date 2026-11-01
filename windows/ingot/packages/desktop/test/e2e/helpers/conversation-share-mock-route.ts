import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiClient } from "@origin-ai/cf-shared";

export function createConversationShareMockRoute() {
  let client: ApiClient | undefined;
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if (!request.url?.startsWith("/api/v1/shares")) return false;
    const origin = `http://${request.headers.host}`;
    const fixtureUrl = new URL(
      "../../../../services/test/helpers/conversationShareMockApiClient.ts",
      import.meta.url,
    );
    const { ConversationShareMockApiClient } = await import(fixtureUrl.href);
    client ??= new ConversationShareMockApiClient({
      shareBaseUrl: `${origin}/cn/share`,
      contentBlockVersions: { workflow: 2, "tool-presentation": 1 },
    });
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const headers = Object.fromEntries(
      Object.entries(request.headers).flatMap(([name, value]) =>
        typeof value === "string" ? [[name, value]] : [],
      ),
    );
    const result = await client!.request(new URL(request.url, origin), {
      method: request.method,
      headers,
      ...(chunks.length ? { body: Buffer.concat(chunks).toString("utf8") } : {}),
    });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
    return true;
  };
}
