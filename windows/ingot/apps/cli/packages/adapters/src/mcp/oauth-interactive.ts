import { createHash, randomBytes } from "node:crypto";
import {
  auth,
  type FetchLike,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type OAuthTokens,
} from "@modelcontextprotocol/client";
import type { Logger, McpOAuthConfig } from "@origin-ai/cf-contracts";
import {
  createLocalhostOAuthCallbackServer,
  type LocalhostOAuthCallbackServer,
} from "../auth/localhost-callback.js";
import type { SharedCfCredentialStore } from "../auth/shared-credentials.js";
import {
  loadCanonicalCredentials,
  publishCanonicalCredentials,
  type CanonicalCredentialSnapshot,
} from "./oauth-credentials.js";
import {
  deletePendingAuthorizationIfOwned,
  loadPendingAuthorization,
  publishPendingAuthorization,
  tryAcquireAuthorizationLease,
} from "./oauth-lease.js";
import {
  loadDiscoveryRecord,
  saveDiscoveryRecord,
  type McpOAuthAuthorizationContext,
} from "./oauth-shared.js";
import { withTimeout } from "./timeout.js";

type McpAuthorizationCodeOAuthConfig = Extract<McpOAuthConfig, { type: "authorization_code" }>;

export const MCP_OAUTH_AUTHORIZATION_TRANSACTION_TTL_MS = 5 * 60 * 1000;
const FOLLOWER_POLL_INTERVAL_MS = 500;

export type McpInteractiveAuthorizationOutcome =
  
  | { status: "authorized" }
  
  | { status: "already-authorized" }
  
  | { status: "pending"; authorizationUrl?: string }
  | { status: "failed"; error: unknown };

export interface McpInteractiveAuthorizationInput {
  adapterInstanceId?: string;
  config: McpAuthorizationCodeOAuthConfig;
  credentialStore: SharedCfCredentialStore;
  fetchFn?: FetchLike;
  
  forceReauthorization?: boolean;
  keyPrefix: string;
  logger?: Logger;
  onAuthorizationRequired?: (context: McpOAuthAuthorizationContext) => Promise<void> | void;
  openAuthorizationUrl?: (context: McpOAuthAuthorizationContext) => Promise<void> | void;
  
  requestedScope?: string;
  resourceMetadataUrl?: URL;
  serverName: string;
  serverUrl: string;
  signal?: AbortSignal;
  transactionTtlMs?: number;
}

export async function runMcpInteractiveAuthorization(
  input: McpInteractiveAuthorizationInput,
): Promise<McpInteractiveAuthorizationOutcome> {
  const transactionTtlMs = input.transactionTtlMs ?? MCP_OAUTH_AUTHORIZATION_TRANSACTION_TTL_MS;
  const baseline = await loadCanonicalCredentials(input.credentialStore, input.keyPrefix);
  const baselineGeneration = baseline?.generation;

  const lease = await tryAcquireAuthorizationLease({
    credentialsFilePath: input.credentialStore.filePath,
    keyPrefix: input.keyPrefix,
  });
  if (!lease) {
    return await followAuthorization(input, baselineGeneration, transactionTtlMs);
  }

  try {
    const current = await loadCanonicalCredentials(input.credentialStore, input.keyPrefix);
    if (hasNewerCredentials(current, baselineGeneration)) {
      return { status: "already-authorized" };
    }
    return await leadAuthorization(input, {
      attemptId: lease.attemptId,
      baselineGeneration,
      transactionTtlMs,
    });
  } finally {
    await deletePendingAuthorizationIfOwned(
      input.credentialStore,
      input.keyPrefix,
      lease.attemptId,
    ).catch(() => undefined);
    await lease.release();
  }
}

async function leadAuthorization(
  input: McpInteractiveAuthorizationInput,
  context: {
    attemptId: string;
    baselineGeneration?: string;
    transactionTtlMs: number;
  },
): Promise<McpInteractiveAuthorizationOutcome> {
  const state = randomBytes(24).toString("base64url");
  const callbackPath = normalizeCallbackPath(input.config.redirectPath, input.serverName);
  let callbackServer: LocalhostOAuthCallbackServer;
  try {
    callbackServer = await createLocalhostOAuthCallbackServer({ callbackPath, state });
  } catch (error) {
    input.logger?.warn("MCP OAuth callback listener failed", {
      event: "mcp.oauth.callback_listener.failed",
      ...logContext(input, state),
      error: error instanceof Error ? error.message : String(error),
      status: "failed",
    });
    return { status: "failed", error };
  }

  const provider = new InteractiveAuthorizationProvider({
    attemptId: context.attemptId,
    baselineGeneration: context.baselineGeneration,
    callbackServer,
    config: input.config,
    credentialStore: input.credentialStore,
    keyPrefix: input.keyPrefix,
    logger: input.logger,
    onAuthorizationRequired: input.onAuthorizationRequired,
    openAuthorizationUrl: input.openAuthorizationUrl,
    requestedScope: input.requestedScope,
    serverName: input.serverName,
    state,
    transactionTtlMs: context.transactionTtlMs,
  });

  try {
    const redirected = await auth(provider, {
      serverUrl: input.serverUrl,
      ...(input.requestedScope ? { scope: input.requestedScope } : {}),
      ...(input.resourceMetadataUrl ? { resourceMetadataUrl: input.resourceMetadataUrl } : {}),
      ...(input.fetchFn ? { fetchFn: input.fetchFn } : {}),
      ...(input.forceReauthorization ? { forceReauthorization: true } : {}),
    });
    if (redirected === "AUTHORIZED") {
      return { status: "authorized" };
    }

    const callback = await withTimeout(
      callbackServer.waitForCallback(),
      context.transactionTtlMs,
      `MCP server ${input.serverName} OAuth authorization timed out`,
      input.signal,
    );
    const callbackParams = new URL(callback.url).searchParams;
    const authorizationCode = callbackParams.get("code") ?? callback.code;
    const issuerParam = callbackParams.get("iss");
    await auth(provider, {
      serverUrl: input.serverUrl,
      authorizationCode,
      ...(issuerParam ? { iss: issuerParam } : {}),
      ...(input.requestedScope ? { scope: input.requestedScope } : {}),
      ...(input.resourceMetadataUrl ? { resourceMetadataUrl: input.resourceMetadataUrl } : {}),
      ...(input.fetchFn ? { fetchFn: input.fetchFn } : {}),
    });
    input.logger?.info("MCP OAuth authorization completed", {
      event: "mcp.oauth.authorization.completed",
      ...logContext(input, state),
      status: "completed",
    });
    return { status: "authorized" };
  } catch (error) {
    const published = await loadCanonicalCredentials(input.credentialStore, input.keyPrefix);
    if (hasNewerCredentials(published, context.baselineGeneration)) {
      return { status: "already-authorized" };
    }
    input.logger?.warn("MCP OAuth authorization failed", {
      event: "mcp.oauth.authorization.failed",
      ...logContext(input, state),
      error: error instanceof Error ? error.message : String(error),
      status: "failed",
    });
    return { status: "failed", error };
  } finally {
    await callbackServer.close().catch(() => undefined);
  }
}

async function followAuthorization(
  input: McpInteractiveAuthorizationInput,
  baselineGeneration: string | undefined,
  transactionTtlMs: number,
): Promise<McpInteractiveAuthorizationOutcome> {
  const deadline = Date.now() + transactionTtlMs;
  let projectedUrl: string | undefined;
  input.logger?.info("MCP OAuth authorization is already in progress elsewhere", {
    event: "mcp.oauth.authorization.following",
    ...logContext(input),
    status: "waiting",
  });

  while (Date.now() < deadline && !input.signal?.aborted) {
    const current = await loadCanonicalCredentials(input.credentialStore, input.keyPrefix);
    if (hasNewerCredentials(current, baselineGeneration)) return { status: "already-authorized" };

    const pending = await loadPendingAuthorization(input.credentialStore, input.keyPrefix);
    if (pending && pending.authorizationUrl !== projectedUrl) {
      projectedUrl = pending.authorizationUrl;
      await input.onAuthorizationRequired?.({
        authorizationUrl: pending.authorizationUrl,
        redirectUrl: "",
        serverName: input.serverName,
      });
    }
    await sleep(FOLLOWER_POLL_INTERVAL_MS, input.signal);
  }

  return { status: "pending", ...(projectedUrl ? { authorizationUrl: projectedUrl } : {}) };
}

class InteractiveAuthorizationProvider implements OAuthClientProvider {
  private readonly attemptId: string;
  private readonly baselineGeneration?: string;
  private readonly callbackServer: LocalhostOAuthCallbackServer;
  private readonly config: McpAuthorizationCodeOAuthConfig;
  private readonly credentialStore: SharedCfCredentialStore;
  private readonly keyPrefix: string;
  private readonly logger?: Logger;
  private readonly onAuthorizationRequired?: (
    context: McpOAuthAuthorizationContext,
  ) => Promise<void> | void;
  private readonly openAuthorizationUrl?: (
    context: McpOAuthAuthorizationContext,
  ) => Promise<void> | void;
  
  private readonly requestedScope?: string;
  private readonly serverName: string;
  private readonly stateValue: string;
  private readonly transactionId: string;
  private readonly transactionTtlMs: number;
  private issuer?: string;
  private memoryCodeVerifier?: string;
  private memoryDiscoveryState?: OAuthDiscoveryState;
  private transactionClientInformation?: OAuthClientInformationMixed;

  constructor(input: {
    attemptId: string;
    baselineGeneration?: string;
    callbackServer: LocalhostOAuthCallbackServer;
    config: McpAuthorizationCodeOAuthConfig;
    credentialStore: SharedCfCredentialStore;
    keyPrefix: string;
    logger?: Logger;
    onAuthorizationRequired?: (context: McpOAuthAuthorizationContext) => Promise<void> | void;
    openAuthorizationUrl?: (context: McpOAuthAuthorizationContext) => Promise<void> | void;
    requestedScope?: string;
    serverName: string;
    state: string;
    transactionTtlMs: number;
  }) {
    this.attemptId = input.attemptId;
    this.baselineGeneration = input.baselineGeneration;
    this.callbackServer = input.callbackServer;
    this.config = input.config;
    this.credentialStore = input.credentialStore;
    this.keyPrefix = input.keyPrefix;
    this.logger = input.logger;
    this.onAuthorizationRequired = input.onAuthorizationRequired;
    this.openAuthorizationUrl = input.openAuthorizationUrl;
    this.requestedScope = input.requestedScope;
    this.serverName = input.serverName;
    this.stateValue = input.state;
    this.transactionId = createHash("sha256").update(input.state).digest("hex");
    this.transactionTtlMs = input.transactionTtlMs;
  }

  get redirectUrl(): string {
    return this.callbackServer.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.config.clientName ?? `CodeFusion ${this.serverName}`,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [this.redirectUrl],
      response_types: ["code"],
      ...(this.config.clientSecret ? { token_endpoint_auth_method: "client_secret_basic" } : {}),
      ...((this.requestedScope ?? this.config.scope)
        ? { scope: this.requestedScope ?? this.config.scope }
        : {}),
    };
  }

  state(): string {
    return this.stateValue;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    if (this.config.clientId) {
      return {
        client_id: this.config.clientId,
        ...(this.config.clientSecret ? { client_secret: this.config.clientSecret } : {}),
      };
    }
    return this.transactionClientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.transactionClientInformation = clientInformation;
  }

  tokens(): undefined {
    return undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const clientInformation = this.clientInformation();
    if (!clientInformation) {
      throw new Error(`Missing MCP OAuth client information for ${this.serverName}`);
    }
    const published = await publishCanonicalCredentials(this.credentialStore, this.keyPrefix, {
      clientInformation,
      ...(this.issuer ? { issuer: this.issuer } : {}),
      publishedBy: this.transactionId,
      tokens,
    });
    this.logger?.info("MCP OAuth credentials published", {
      event: "mcp.oauth.credentials.published",
      ...this.logContext(),
      clientIdHash: hashIdentifier(clientInformation.client_id),
      grantKind: "authorization_code",
      hasRefreshToken: Boolean(tokens.refresh_token),
      publishedGeneration: published.generation.slice(0, 12),
      status: "completed",
      tokenExpiresInSeconds: tokens.expires_in,
    });
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const context: McpOAuthAuthorizationContext = {
      authorizationUrl: authorizationUrl.toString(),
      redirectUrl: this.redirectUrl,
      serverName: this.serverName,
    };
    await publishPendingAuthorization(this.credentialStore, this.keyPrefix, {
      attemptId: this.attemptId,
      authorizationUrl: context.authorizationUrl,
      ...(this.baselineGeneration ? { baselineGeneration: this.baselineGeneration } : {}),
      expiresAt: Date.now() + this.transactionTtlMs,
      state: this.stateValue,
    });
    this.logger?.info("MCP OAuth authorization required", {
      event: "mcp.oauth.authorization.required",
      ...this.logContext(),
      callbackPort: Number(new URL(this.redirectUrl).port),
      status: "waiting",
    });
    await this.onAuthorizationRequired?.(context);
    await this.openAuthorizationUrl?.(context);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.memoryCodeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.memoryCodeVerifier) {
      throw new Error(`Missing MCP OAuth PKCE verifier for ${this.serverName}`);
    }
    return this.memoryCodeVerifier;
  }

  saveAuthorizationServerUrl(authorizationServerUrl: string): void {
    this.issuer = authorizationServerUrl;
  }

  authorizationServerUrl(): string | undefined {
    return this.issuer;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.memoryDiscoveryState = state;
    await saveDiscoveryRecord(this.credentialStore, this.keyPrefix, state);
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    if (this.memoryDiscoveryState) return this.memoryDiscoveryState;
    return await loadDiscoveryRecord(this.credentialStore, this.keyPrefix);
  }

  private logContext(): Record<string, unknown> {
    return {
      credentialKeyPrefix: this.keyPrefix,
      mcpServerName: this.serverName,
      oauthAttemptId: this.attemptId.slice(0, 12),
      oauthStateId: this.transactionId.slice(0, 16),
      processId: process.pid,
    };
  }
}

function hasNewerCredentials(
  current: CanonicalCredentialSnapshot | undefined,
  baselineGeneration: string | undefined,
): boolean {
  return Boolean(current?.tokens && current.generation !== baselineGeneration);
}

function normalizeCallbackPath(value: string | undefined, serverName: string): string {
  const fallback = `/oauth/callback/mcp/${encodeURIComponent(serverName)}`;
  if (!value) return fallback;
  return value.startsWith("/") ? value : `/${value}`;
}

function logContext(
  input: McpInteractiveAuthorizationInput,
  state?: string,
): Record<string, unknown> {
  return {
    adapterInstanceId: input.adapterInstanceId,
    credentialKeyPrefix: input.keyPrefix,
    mcpServerName: input.serverName,
    ...(state
      ? { oauthStateId: createHash("sha256").update(state).digest("hex").slice(0, 16) }
      : {}),
    processId: process.pid,
  };
}

function hashIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function sleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
