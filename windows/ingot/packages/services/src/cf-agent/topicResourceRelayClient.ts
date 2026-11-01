import { createHash } from "node:crypto";
import { CancellationTokenSource, type IChannel } from "@origin-ai/cf-rpc";
import {
  TOPIC_RESOURCE_RELAY_CHUNK_BYTES,
  cfTopicResourceRelayRequestSchema,
  cfTopicResourceRelayMetadataSchema,
  cfTopicResourceRelayChunkSchema,
  type CfPromptAttachment,
} from "@origin-ai/cf-shared";

export async function validateTopicResourceFromRelay(
  channel: Pick<IChannel, "call">,
  value: unknown,
  signal: AbortSignal,
): Promise<void> {
  const request = cfTopicResourceRelayRequestSchema.parse(value);
  signal.throwIfAborted();
  const cancellation = new CancellationTokenSource();
  const abort = () => cancellation.cancel();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const result = await channel.call<{ valid?: boolean }>("validate", request, cancellation.token);
    signal.throwIfAborted();
    if (result?.valid !== true) throw new Error("Topic resource authorization unavailable");
  } finally {
    signal.removeEventListener("abort", abort);
    cancellation.dispose();
  }
}

export async function readTopicResourceFromRelay(
  channel: Pick<IChannel, "call">,
  value: unknown,
  signal: AbortSignal,
): Promise<CfPromptAttachment> {
  const request = cfTopicResourceRelayRequestSchema.parse(value);
  const key = { requestId: request.requestId, taskId: request.taskId };
  signal.throwIfAborted();
  const cancellation = new CancellationTokenSource();
  const abort = () => cancellation.cancel();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const metadata = cfTopicResourceRelayMetadataSchema.parse(
      await channel.call("begin", request, cancellation.token),
    );
    signal.throwIfAborted();
    if (metadata.totalChunks !== Math.ceil(metadata.bytes / TOPIC_RESOURCE_RELAY_CHUNK_BYTES))
      throw new Error("Invalid topic resource chunk count");
    const chunks: Buffer[] = [];
    const hash = createHash("sha256");
    for (let index = 0; index < metadata.totalChunks; index++) {
      signal.throwIfAborted();
      const { dataBase64 } = cfTopicResourceRelayChunkSchema.parse(
        await channel.call("chunk", { ...key, index }, cancellation.token),
      );
      signal.throwIfAborted();
      const bytes = Buffer.from(dataBase64, "base64");
      const expected = Math.min(
        TOPIC_RESOURCE_RELAY_CHUNK_BYTES,
        metadata.bytes - index * TOPIC_RESOURCE_RELAY_CHUNK_BYTES,
      );
      if (bytes.length !== expected || bytes.toString("base64") !== dataBase64)
        throw new Error("Invalid topic resource chunk encoding or size");
      chunks.push(bytes);
      hash.update(bytes);
    }
    if (`sha256:${hash.digest("hex")}` !== metadata.checksum)
      throw new Error("Topic resource checksum mismatch");
    const result = await channel.call<{ completed?: boolean }>("finish", key, cancellation.token);
    signal.throwIfAborted();
    if (result?.completed !== true) throw new Error("Topic resource completion unavailable");
    return {
      kind: "file",
      filename: metadata.fileName,
      mimeType: metadata.mime,
      sizeBytes: metadata.bytes,
      dataBase64: Buffer.concat(chunks, metadata.bytes).toString("base64"),
    };
  } catch (error) {
    void channel.call("cancel", key).catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    cancellation.dispose();
  }
}
