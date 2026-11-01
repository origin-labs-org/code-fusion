import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCfDataRootDir } from "@origin-ai/cf-services/node";
import type {
  MaterializeWorkflowArtifactFileRequest,
  MaterializeWorkflowArtifactFileResult,
} from "@origin-ai/cf-shared";

const WORKFLOW_ARTIFACT_DIR = "workflow-artifacts";

export const WORKFLOW_ARTIFACT_FILE_MAX_BYTES = 20 * 1024 * 1024;

const MAX_SEGMENT_LENGTH = 120;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/iu;

export async function materializeWorkflowArtifactFile(
  payload: MaterializeWorkflowArtifactFileRequest,
): Promise<MaterializeWorkflowArtifactFileResult> {
  const request = parseRequest(payload);
  const dir = join(
    getCfDataRootDir(),
    "tmp",
    WORKFLOW_ARTIFACT_DIR,
    identitySegment(request.runId),
    identitySegment(request.artifactId),
    `v${request.version}`,
  );
  const localPath = join(dir, sanitizeFileName(request.fileName, request.artifactId));

  await mkdir(dir, { recursive: true });
  const temporaryPath = join(dir, `.${randomUUID()}.partial`);
  await writeFile(temporaryPath, request.bytes, { flag: "wx" });
  try {
    await link(temporaryPath, localPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  return { localPath };
}

function parseRequest(payload: unknown): MaterializeWorkflowArtifactFileRequest {
  const fields = (payload ?? {}) as Partial<
    Record<keyof MaterializeWorkflowArtifactFileRequest, unknown>
  >;
  const { runId, artifactId, version, fileName, bytes } = fields;
  if (
    typeof runId !== "string" ||
    runId.trim().length === 0 ||
    typeof artifactId !== "string" ||
    artifactId.trim().length === 0 ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1 ||
    typeof fileName !== "string" ||
    !(bytes instanceof Uint8Array)
  ) {
    throw new Error("Workflow artifact file request is invalid");
  }
  if (bytes.byteLength > WORKFLOW_ARTIFACT_FILE_MAX_BYTES) {
    throw new Error(
      `Workflow artifact is too large to open as a file (${bytes.byteLength} bytes, cap ${WORKFLOW_ARTIFACT_FILE_MAX_BYTES})`,
    );
  }
  return { runId, artifactId, version, fileName, bytes };
}

function identitySegment(id: string): string {
  const digest = createHash("sha256").update(id, "utf8").digest("hex").slice(0, 8);
  return `${sanitizeSegment(id)}-${digest}`;
}

function sanitizeSegment(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]/gu, "_")
    .replace(/^\.+/u, "")
    .slice(0, MAX_SEGMENT_LENGTH);
  return cleaned.length === 0 ? "_" : cleaned;
}

function sanitizeFileName(fileName: string, artifactId: string): string {
  const leaf = fileName.split(/[\\/]/u).at(-1) ?? "";
  let cleaned = leaf
    .replace(/[<>:"|?*\u0000-\u001f]/gu, "_")
    .trim()
    .replace(/^\.+/u, "")
    .replace(/[. ]+$/u, "");
  if (cleaned.length === 0) cleaned = sanitizeSegment(artifactId);
  if (WINDOWS_RESERVED_NAME.test(cleaned)) cleaned = `_${cleaned}`;
  if (cleaned.length > MAX_SEGMENT_LENGTH) {
    const dot = cleaned.lastIndexOf(".");
    const extension = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : "";
    cleaned = cleaned.slice(0, MAX_SEGMENT_LENGTH - extension.length) + extension;
  }
  return cleaned;
}
