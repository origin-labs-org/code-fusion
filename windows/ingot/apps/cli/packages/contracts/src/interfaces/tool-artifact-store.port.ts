// ============================================================
// Tool Artifact Store Port - large tool result storage boundary
// ============================================================

import type { SessionId, ToolCallId, TurnId } from "./shared.js";
import type { TraceContext } from "../tracing/tracer.js";

export type ToolArtifactRetention = "session" | "project" | "temporary";

export interface ToolArtifactWriteRequest {
  sessionId: SessionId;
  turnId?: TurnId;
  toolCallId: ToolCallId | string;
  toolName: string;
  content: string;
  contentType?: string;
  retention?: ToolArtifactRetention;
  trace?: TraceContext;
}

export interface ToolBinaryArtifactWriteRequest {
  sessionId: SessionId;
  turnId?: TurnId;
  toolCallId: ToolCallId | string;
  toolName: string;
  content: Uint8Array;
  contentType: string;
  extension?: string;
  retention?: ToolArtifactRetention;
  trace?: TraceContext;
}

export interface ToolArtifactWriteResult {
  id: string;
  uri: string;
  path?: string;
  bytes: number;
  contentType: string;
  createdAt: Date;
}

export interface ToolArtifactReadRequest {
  uri: string;
  trace?: TraceContext;
}

export interface ToolArtifactReadResult {
  uri: string;
  content: string;
  contentType: string;
  bytes: number;
  path?: string;
}

export interface ToolBinaryArtifactReadResult {
  uri: string;
  bytes: Uint8Array;
  contentType: string;
  path?: string;
}

export interface ToolArtifactStatRequest {
  uri: string;
  trace?: TraceContext;
}

export interface ToolArtifactStatResult {
  uri: string;
  bytes: number;
  contentType: string;
  path?: string;
  mtimeMs?: number;
}

export interface ImageAttachmentPathPrimeRequest {
  uri: string;
  bytes: Uint8Array;
  mediaType: string;
}

export interface MediaAttachmentPathPrimeRequest {
  uri: string;
  bytes: Uint8Array;
  mediaType: string;
}

export interface MediaAttachmentPathEnsureRequest {
  uri: string;
  mediaType: string;
}

export type MediaAttachmentPathResult =
  | { status: "ready"; path: string }
  | { status: "unsupported" };

export interface ToolArtifactStorePort {
  writeToolResultArtifact(
    request: ToolArtifactWriteRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolArtifactWriteResult>;
  writeToolResultBinaryArtifact?(
    request: ToolBinaryArtifactWriteRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolArtifactWriteResult>;
  readToolResultArtifact(
    request: ToolArtifactReadRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolArtifactReadResult>;
  
  readToolResultBinaryArtifact?(
    request: ToolArtifactReadRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolBinaryArtifactReadResult>;
  statToolResultArtifact?(
    request: ToolArtifactStatRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ToolArtifactStatResult>;
  primeImageAttachmentPath?(
    request: ImageAttachmentPathPrimeRequest,
  ): Promise<MediaAttachmentPathResult>;
  primeMediaAttachmentPath?(
    request: MediaAttachmentPathPrimeRequest,
  ): Promise<MediaAttachmentPathResult>;
  ensureMediaAttachmentPath?(
    request: MediaAttachmentPathEnsureRequest,
  ): Promise<MediaAttachmentPathResult>;
}
