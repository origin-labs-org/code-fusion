import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { acquireFileLock } from "@origin-ai/cf-shared/node";
import { CF_FILE_LOCK_TIMEOUT_ERROR_CODE } from "@origin-ai/cf-shared";
import type { SharedCfCredentialStore } from "../auth/shared-credentials.js";
import { isRecord, mcpOAuthCredentialKey } from "./oauth-credentials.js";

export const MCP_OAUTH_PENDING_AUTHORIZATION_KEY = "pending_authorization";

const AUTHORIZATION_LEASE_MAX_WAIT_MS = 250;
const AUTHORIZATION_LEASE_RETRY_DELAYS_MS = [25] as const;
const AUTHORIZATION_LEASE_OWNERLESS_GRACE_MS = 100;

export interface McpOAuthAuthorizationLease {
  attemptId: string;
  release(): Promise<void>;
}

export function resolveAuthorizationLeasePath(
  credentialsFilePath: string,
  keyPrefix: string,
): string {
  return join(dirname(credentialsFilePath), `${sanitizeKeyPrefix(keyPrefix)}.authz`);
}

export function sanitizeKeyPrefix(keyPrefix: string): string {
  return keyPrefix.replaceAll(/[^a-zA-Z0-9-]/g, "-");
}

export async function tryAcquireAuthorizationLease(input: {
  credentialsFilePath: string;
  keyPrefix: string;
}): Promise<McpOAuthAuthorizationLease | undefined> {
  const leasePath = resolveAuthorizationLeasePath(input.credentialsFilePath, input.keyPrefix);
  try {
    const release = await acquireFileLock(
      leasePath,
      AUTHORIZATION_LEASE_RETRY_DELAYS_MS,
      AUTHORIZATION_LEASE_OWNERLESS_GRACE_MS,
      AUTHORIZATION_LEASE_MAX_WAIT_MS,
    );
    return {
      attemptId: randomBytes(16).toString("hex"),
      release,
    };
  } catch (error) {
    if (getErrorCode(error) === CF_FILE_LOCK_TIMEOUT_ERROR_CODE) return undefined;
    throw error;
  }
}

export interface PendingAuthorizationRecord {
  attemptId: string;
  authorizationUrl: string;
  baselineGeneration?: string;
  expiresAt: number;
  state: string;
}

interface StoredPendingAuthorization {
  attempt_id: string;
  authorization_url: string;
  baseline_generation?: string;
  expires_at: number;
  state: string;
}

export async function publishPendingAuthorization(
  credentialStore: SharedCfCredentialStore,
  keyPrefix: string,
  record: PendingAuthorizationRecord,
): Promise<void> {
  const stored: StoredPendingAuthorization = {
    attempt_id: record.attemptId,
    authorization_url: record.authorizationUrl,
    ...(record.baselineGeneration === undefined
      ? {}
      : { baseline_generation: record.baselineGeneration }),
    expires_at: record.expiresAt,
    state: record.state,
  };
  await credentialStore.save(pendingKey(keyPrefix), JSON.stringify(stored));
}

export async function loadPendingAuthorization(
  credentialStore: SharedCfCredentialStore,
  keyPrefix: string,
  now = Date.now(),
): Promise<PendingAuthorizationRecord | undefined> {
  const raw = await credentialStore.load(pendingKey(keyPrefix));
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.attempt_id !== "string" ||
    typeof parsed.authorization_url !== "string" ||
    typeof parsed.state !== "string" ||
    typeof parsed.expires_at !== "number"
  ) {
    return undefined;
  }
  if (parsed.expires_at <= now) return undefined;
  return {
    attemptId: parsed.attempt_id,
    authorizationUrl: parsed.authorization_url,
    ...(typeof parsed.baseline_generation === "string"
      ? { baselineGeneration: parsed.baseline_generation }
      : {}),
    expiresAt: parsed.expires_at,
    state: parsed.state,
  };
}

export async function deletePendingAuthorizationIfOwned(
  credentialStore: SharedCfCredentialStore,
  keyPrefix: string,
  attemptId: string,
): Promise<boolean> {
  const key = pendingKey(keyPrefix);
  const raw = await credentialStore.load(key);
  if (!raw) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return await credentialStore.deleteIfValue(key, raw);
  }
  if (!isRecord(parsed) || parsed.attempt_id !== attemptId) return false;
  return await credentialStore.deleteIfValue(key, raw);
}

function pendingKey(keyPrefix: string): string {
  return mcpOAuthCredentialKey(keyPrefix, MCP_OAUTH_PENDING_AUTHORIZATION_KEY);
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
