import { useEffect, useMemo, useRef, useState } from "react";
import { PROTOCOL_V4_LIMITS } from "@origin-ai/cf-shared/cf-protocol-v4";
import { logger } from "@/logger.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";

const CHUNK_BYTES = PROTOCOL_V4_LIMITS.attachmentChunkMaxBytes;

const MAX_CHUNKS = 96;

interface WorkflowRunArtifactBytesState {
  bytes: Uint8Array<ArrayBuffer> | null;
  blob: Blob | null;
  
  objectUrl: string | null;
  
  mediaType: string | null;
  totalBytes: number | null;
  loading: boolean;
  error: string | null;
  
  bytesVersion: number | null;
}

function emptyState(): WorkflowRunArtifactBytesState {
  return {
    bytes: null,
    blob: null,
    objectUrl: null,
    mediaType: null,
    totalBytes: null,
    loading: false,
    error: null,
    bytesVersion: null,
  };
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function encodeBytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  const step = 0x2000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
}

export function useWorkflowRunArtifactBytes(options: {
  sessionId: string;
  runId: string;
  artifactId: string;
  version: number;
  
  enabled?: boolean;
}): WorkflowRunArtifactBytesState {
  const { workflowRunArtifactRead } = useV4Conversation();
  const [state, setState] = useState<WorkflowRunArtifactBytesState>(emptyState);
  const objectUrlRef = useRef<string | null>(null);

  const { artifactId, runId, sessionId, version } = options;
  const enabled =
    options.enabled !== false &&
    sessionId.length > 0 &&
    runId.length > 0 &&
    artifactId.length > 0 &&
    version > 0;

  useEffect(() => {
    const revokePrevious = () => {
      if (objectUrlRef.current !== null) {
        if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(objectUrlRef.current);
        }
        objectUrlRef.current = null;
      }
    };
    revokePrevious();
    setState(emptyState());
    if (!enabled) return;

    let alive = true;
    setState((current) => ({ ...current, loading: true }));
    void (async () => {
      try {
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let offset = 0;
        let mediaType = "application/octet-stream";
        let totalBytes = 0;
        for (let index = 0; index < MAX_CHUNKS; index += 1) {
          const result = await workflowRunArtifactRead({
            sessionId,
            runId,
            artifactId,
            version,
            offset,
            limit: CHUNK_BYTES,
          });
          if (!alive) return;
          mediaType = result.mediaType;
          totalBytes = result.totalBytes;
          chunks.push(decodeBase64(result.dataBase64));
          if (result.nextOffset === null) break;
          offset = result.nextOffset;
        }
        if (!alive) return;
        const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const bytes = new Uint8Array(size);
        let cursor = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, cursor);
          cursor += chunk.length;
        }
        const blob = new Blob([bytes], { type: mediaType });
        const objectUrl =
          typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(blob)
            : null;
        objectUrlRef.current = objectUrl;
        setState({
          bytes,
          blob,
          objectUrl,
          mediaType,
          totalBytes,
          loading: false,
          error: null,
          bytesVersion: version,
        });
      } catch (caught) {
        if (!alive) return;
        const message = caught instanceof Error ? caught.message : String(caught);
        logger.warn("[workflow-artifacts] 读取产物字节失败", {
          artifactId,
          error: message,
          runId,
          sessionId,
          version,
        });
        setState({ ...emptyState(), error: message });
      }
    })();

    return () => {
      alive = false;
      revokePrevious();
    };
  }, [artifactId, enabled, runId, sessionId, version, workflowRunArtifactRead]);

  return useMemo(() => state, [state]);
}
