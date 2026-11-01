// ============================================================
// ============================================================
//
//

import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import {
  isFileSystemPortError,
  type FileSystemPort,
  type FileSystemReadBytesResult,
  type SessionId,
  type ToolArtifactStorePort,
  type ToolArtifactWriteResult,
} from "@origin-ai/cf-contracts";
import {
  ARTIFACT_CAPS,
  ARTIFACT_ID_PATTERN,
  WorkflowError,
  type ArtifactPublishRequest,
  type ArtifactVersionRecord,
} from "@origin-ai/cf-dynamic-workflow";
import { resolveWithinWorkspace, toWorkspaceRelative } from "./workflow-world-read.js";

interface ArtifactPublishDeps {
  
  readonly fileSystemPort: FileSystemPort;
  
  readonly cwd: string;
  
  readonly artifactStore?: ToolArtifactStorePort;
  
  readonly parentSessionId?: SessionId;
}

export async function executeArtifactPublish(
  deps: ArtifactPublishDeps,
  request: ArtifactPublishRequest,
): Promise<ArtifactVersionRecord> {
  assertArtifactId(request);
  const opts = artifactPublishOptions(request);
  const store = requireArtifactStore(deps, request);
  const payload =
    request.op === "file"
      ? await readFilePayload(deps, request, opts)
      : markdownPayload(request);
  const written = await writePayload(store, request, payload);
  return {
    id: request.id,
    kind: request.op,
    version: request.version,
    ...(opts.title === undefined ? {} : { title: opts.title }),
    ...(opts.description === undefined ? {} : { description: opts.description }),
    contentType: payload.contentType,
    bytes: written.bytes,
    uri: written.uri,
    ...(payload.kind === "binary" ? { sourcePath: payload.sourcePath } : {}),
    publishedAt: Date.now(),
  };
}

interface ArtifactPublishOptions {
  title?: string;
  description?: string;
  
  contentType?: string;
}

function assertArtifactId(request: ArtifactPublishRequest): void {
  const { id } = request;
  if (id.length > ARTIFACT_CAPS.maxIdLength || !ARTIFACT_ID_PATTERN.test(id)) {
    throw new WorkflowError(
      "DriverError",
      `artifact.${request.op}: id '${id}' is not a valid artifact id. Use at most ` +
        `${ARTIFACT_CAPS.maxIdLength} characters from [A-Za-z0-9_.-].`,
    );
  }
}

function artifactPublishOptions(request: ArtifactPublishRequest): ArtifactPublishOptions {
  const raw = request.opts;
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new WorkflowError(
      "DriverError",
      `artifact.${request.op}: opts must be an options object, got ${describeArg(raw)}. ` +
        `Pass an object or omit the argument.`,
    );
  }
  const bag = raw as { title?: unknown; description?: unknown; contentType?: unknown };
  const title = optionalText(request, "title", bag.title, ARTIFACT_CAPS.maxTitleLength);
  const description = optionalText(
    request,
    "description",
    bag.description,
    ARTIFACT_CAPS.maxDescriptionLength,
  );
  const contentType = request.op === "file" ? optionalContentType(request, bag.contentType) : undefined;
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(contentType === undefined ? {} : { contentType }),
  };
}

function optionalText(
  request: ArtifactPublishRequest,
  name: string,
  value: unknown,
  max: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new WorkflowError(
      "DriverError",
      `artifact.${request.op}: opts.${name} must be a string, got ${describeArg(value)}.`,
    );
  }
  if (value.length > max) {
    throw new WorkflowError(
      "ArtifactTooLarge",
      `artifact.${request.op}: opts.${name} is ${value.length} characters, over the cap of ` +
        `${max}. Shorten it.`,
    );
  }
  return value;
}

function optionalContentType(request: ArtifactPublishRequest, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new WorkflowError(
      "DriverError",
      `artifact.file: opts.contentType must be a string, got ${describeArg(value)}.`,
    );
  }
  if (!CONTENT_TYPE_PATTERN.test(value)) {
    throw new WorkflowError(
      "DriverError",
      `artifact.file: opts.contentType '${value}' is not a bare MIME type such as ` +
        `'application/pdf'. Drop any parameters ('; charset=...'); the viewer dispatches on ` +
        `the exact string.`,
    );
  }
  return value;
}

type ArtifactPayload =
  | {
      readonly kind: "binary";
      readonly bytes: Uint8Array;
      readonly contentType: string;
      
      readonly extension?: string;
      
      readonly sourcePath: string;
    }
  | { readonly kind: "text"; readonly text: string; readonly contentType: "text/markdown" };

async function readFilePayload(
  deps: ArtifactPublishDeps,
  request: ArtifactPublishRequest,
  opts: ArtifactPublishOptions,
): Promise<ArtifactPayload> {
  const given = request.path;
  if (typeof given !== "string" || given === "") {
    throw new WorkflowError(
      "DriverError",
      `artifact.file: path must be a non-empty string, got ${describeArg(given)}. Pass the ` +
        `workspace-relative path the subagent wrote.`,
    );
  }
  const { real, relative } = await resolveWorkspaceFile(deps, given);
  const bytes = await readCappedBytes(deps, given, real);
  const extension = fileExtension(real);
  return {
    kind: "binary",
    bytes,
    contentType:
      opts.contentType ??
      (extension === undefined ? undefined : EXTENSION_CONTENT_TYPES[extension]) ??
      "application/octet-stream",
    ...(extension === undefined ? {} : { extension }),
    sourcePath: relative,
  };
}

async function resolveWorkspaceFile(
  deps: ArtifactPublishDeps,
  given: string,
): Promise<{ real: string; relative: string }> {
  const resolved = resolveWithinWorkspace(deps.cwd, given);
  if (resolved === undefined) throw outsideWorkspace(given);
  const relative = toWorkspaceRelative(deps.cwd, resolved);

  let realCwd: string;
  let real: string;
  try {
    realCwd = await realpath(deps.cwd);
  } catch (cause) {
    throw new WorkflowError(
      "DriverError",
      `artifact.file: cannot resolve the workspace root '${deps.cwd}': ${errorText(cause)}`,
      { cause },
    );
  }
  try {
    real = await realpath(resolved);
  } catch (cause) {
    throw sourceMissing(given, cause);
  }
  if (resolveWithinWorkspace(realCwd, real) === undefined) throw outsideWorkspace(given);
  return { real, relative };
}

async function readCappedBytes(
  deps: ArtifactPublishDeps,
  given: string,
  path: string,
): Promise<Uint8Array> {
  const cap = ARTIFACT_CAPS.maxFileBytes;
  let result: FileSystemReadBytesResult;
  try {
    result = await deps.fileSystemPort.readBinaryFile({ path, maxBytes: cap + 1 });
  } catch (cause) {
    if (isFileSystemPortError(cause)) {
      if (cause.code === "too_large") throw tooLarge(given, cap);
      if (cause.code === "not_found" || cause.code === "is_directory" || cause.code === "not_file") {
        throw sourceMissing(given, cause);
      }
    }
    throw new WorkflowError(
      "DriverError",
      `artifact.file: failed to read '${given}': ${errorText(cause)}`,
      { cause },
    );
  }
  if (result.content.byteLength > cap) throw tooLarge(given, cap);
  return result.content;
}

function markdownPayload(request: ArtifactPublishRequest): ArtifactPayload {
  const content = request.content;
  if (typeof content !== "string") {
    throw new WorkflowError(
      "DriverError",
      `artifact.markdown: content must be a string, got ${describeArg(content)}.`,
    );
  }
  const bytes = Buffer.byteLength(content, "utf8");
  const cap = ARTIFACT_CAPS.maxMarkdownBytes;
  if (bytes > cap) {
    throw new WorkflowError(
      "ArtifactTooLarge",
      `artifact.markdown: content is ${bytes} bytes, over the cap of ${cap} bytes. Shorten ` +
        `it, or write the long content to a workspace file and publish it with artifact.file.`,
    );
  }
  return { kind: "text", text: content, contentType: "text/markdown" };
}

interface ArtifactStoreTarget {
  readonly store: ToolArtifactStorePort;
  readonly sessionId: SessionId;
}

function requireArtifactStore(
  deps: ArtifactPublishDeps,
  request: ArtifactPublishRequest,
): ArtifactStoreTarget {
  const store = deps.artifactStore;
  if (store === undefined) {
    throw new WorkflowError(
      "ArtifactStoreUnavailable",
      `artifact.${request.op}: cannot publish "${request.id}" because this assembly has no ` +
        `artifact store.`,
    );
  }
  if (request.op === "file" && store.writeToolResultBinaryArtifact === undefined) {
    throw new WorkflowError(
      "ArtifactStoreUnavailable",
      `artifact.file: cannot publish "${request.id}" because this assembly's artifact store ` +
        `does not support binary writes.`,
    );
  }
  const sessionId = deps.parentSessionId;
  if (sessionId === undefined || sessionId === "") {
    throw new WorkflowError(
      "ArtifactStoreUnavailable",
      `artifact.${request.op}: cannot publish "${request.id}" because the artifact store has ` +
        `no session scope (parent session id not wired).`,
    );
  }
  return { store, sessionId };
}

async function writePayload(
  target: ArtifactStoreTarget,
  request: ArtifactPublishRequest,
  payload: ArtifactPayload,
): Promise<ToolArtifactWriteResult> {
  const common = {
    sessionId: target.sessionId,
    toolCallId: `${request.runId}:${request.siteId}@${request.ordinal}`,
    toolName: ARTIFACT_TOOL_NAME,
    retention: "project" as const,
  };
  try {
    if (payload.kind === "text") {
      return await target.store.writeToolResultArtifact({
        ...common,
        content: payload.text,
        contentType: payload.contentType,
      });
    }
    const writeBinary = target.store.writeToolResultBinaryArtifact;
    if (writeBinary === undefined) {
      throw new WorkflowError(
        "ArtifactStoreUnavailable",
        `artifact.file: cannot publish "${request.id}" because this assembly's artifact store ` +
          `does not support binary writes.`,
      );
    }
    return await writeBinary.call(target.store, {
      ...common,
      content: payload.bytes,
      contentType: payload.contentType,
      ...(payload.extension === undefined ? {} : { extension: payload.extension }),
    });
  } catch (cause) {
    if (cause instanceof WorkflowError) throw cause;
    throw new WorkflowError(
      "DriverError",
      `artifact.${request.op}: writing "${request.id}" v${request.version} to the artifact ` +
        `store failed: ${errorText(cause)}`,
      { cause },
    );
  }
}

const ARTIFACT_TOOL_NAME = "CreateWorkflow";

const EXTENSION_CONTENT_TYPES: Readonly<Record<string, string>> = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  htm: "text/html",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  markdown: "text/markdown",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const CONTENT_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;

function fileExtension(path: string): string | undefined {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return undefined;
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]+$/.test(ext) ? ext : undefined;
}

function outsideWorkspace(given: string): WorkflowError {
  return new WorkflowError(
    "ArtifactPathOutsideWorkspace",
    `artifact.file: path '${given}' resolves outside the workspace (symlinks are judged by ` +
      `their real path). Only files inside the workspace can be published.`,
  );
}

function sourceMissing(given: string, cause: unknown): WorkflowError {
  return new WorkflowError(
    "ArtifactSourceMissing",
    `artifact.file: '${given}' does not exist or is not a regular file. Confirm the subagent ` +
      `actually wrote it before publishing.`,
    { cause },
  );
}

function tooLarge(given: string, cap: number): WorkflowError {
  return new WorkflowError(
    "ArtifactTooLarge",
    `artifact.file: '${given}' is over the cap of ${cap} bytes. Publish a smaller artifact ` +
      `(a summary, a slice, or a compressed version).`,
  );
}

function describeArg(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
