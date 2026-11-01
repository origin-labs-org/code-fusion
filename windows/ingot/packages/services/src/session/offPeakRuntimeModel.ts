

import {
  BUILTIN_MODEL_PROVIDER_IDS,
  resolveOffPeakProviderId,
  buildRuntimeCfApiUrl,
  type OffPeakCodingPlanKind,
  type OffPeakCodingPlanSupport,
  type OffPeakCodingPlanUnsupportedReason,
  type CfAccountAccess,
} from "@origin-ai/cf-shared";
import { isOffPeakMockEnabled, startOffPeakMockGateway } from "./offPeakMockGateway.js";
import type { ServiceLogger } from "../logger/serviceLogger.js";
import { AccountRequestCredentialUnavailableError } from "../model-provider/accountProviderRequestAuthService.js";
import type { IAccountRequestAuthService } from "../model-provider/accountRequestAuthService.js";

export class OffPeakPermanentDispatchError extends Error {
  readonly failureKind = "permanent" as const;

  constructor(message: string) {
    super(message);
    this.name = "OffPeakPermanentDispatchError";
  }
}

export class OffPeakCredentialsUnavailableError extends OffPeakPermanentDispatchError {
  constructor(readonly missing: "jwt" | "codingPlanApiKey") {
    super(
      missing === "jwt"
        ? "off-peak requires cf login (jwt missing)"
        : "off-peak requires a coding plan provider api key",
    );
    this.name = "OffPeakCredentialsUnavailableError";
  }
}

export class OffPeakCodingPlanUnavailableError extends OffPeakPermanentDispatchError {
  constructor(readonly reason: OffPeakCodingPlanUnsupportedReason) {
    super(`off-peak selected coding plan unavailable: ${reason}`);
    this.name = "OffPeakCodingPlanUnavailableError";
  }
}

export class OffPeakModelUnavailableError extends OffPeakPermanentDispatchError {
  constructor(readonly scope: "idlePlan" | "workspaceUser") {
    super(
      scope === "idlePlan"
        ? "off-peak dispatch has no usable model (Built-in Provider models empty)"
        : "off-peak dispatch has no usable user workspace model",
    );
    this.name = "OffPeakModelUnavailableError";
  }
}

const CF_JWT_TOKEN_KEY = "cfjwttoken";
const ACTIVE_OAUTH_PROVIDER_KEY = "oauth:active_provider";

export interface OffPeakCredentialSnapshot {
  jwt: string;
  codingPlanApiKey: string;
  accountScope?: string;
  kind: OffPeakCodingPlanKind;
  providerFamily: "zai" | "bigmodel";
  providerId: string;
  
  organizationId?: string;
  projectId?: string;
  
  providerBaseURL?: string;
}

interface OffPeakCredentialResolverDeps {
  credentialService: { load(key: string): Promise<string | null | undefined> };
  accountRequestAuthService: IAccountRequestAuthService;
  resolveAccountProvider(): Promise<{
    readonly providerId: string;
    readonly access: CfAccountAccess;
    readonly baseURL?: string;
  } | null>;
  env?: NodeJS.ProcessEnv;
}

type SelectedOffPeakCodingPlan = Pick<
  OffPeakCredentialSnapshot,
  "kind" | "providerFamily" | "providerId" | "organizationId" | "projectId"
>;

function resolveSelectedOffPeakCodingPlan(
  provider: Awaited<ReturnType<OffPeakCredentialResolverDeps["resolveAccountProvider"]>>,
): SelectedOffPeakCodingPlan {
  if (!provider) {
    throw new OffPeakCodingPlanUnavailableError("connection_unavailable");
  }
  const { access, providerId } = provider;
  if (access.planKind === "start-plan") {
    throw new OffPeakCodingPlanUnavailableError("start_plan_not_supported");
  }
  if (access.planKind === "individual-coding-plan") {
    return {
      kind: access.family === "zai" ? "zai-personal" : "bigmodel-personal",
      providerFamily: access.family,
      providerId,
    };
  }
  if (access.planKind !== "team-coding-plan") {
    throw new OffPeakCodingPlanUnavailableError("connection_unavailable");
  }
  return {
    kind: access.family === "zai" ? "zai-team" : "bigmodel-team",
    providerFamily: access.family,
    providerId,
    organizationId: access.organizationId,
    projectId: access.projectId,
  };
}

function createOffPeakSelectionFingerprint(
  provider: Awaited<ReturnType<OffPeakCredentialResolverDeps["resolveAccountProvider"]>>,
): string {
  return JSON.stringify(provider ?? null);
}

export async function resolveOffPeakCredentials(
  deps: OffPeakCredentialResolverDeps,
  options: { allowMockCredentials?: boolean } = {},
): Promise<OffPeakCredentialSnapshot> {
  const env = deps.env ?? process.env;
  if (options.allowMockCredentials !== false && env["CF_OFFPEAK_MOCK"] === "1") {
    if (env["CF_OFFPEAK_MOCK_NO_PLAN"] === "1") {
      throw new OffPeakCodingPlanUnavailableError("connection_unavailable");
    }
    return {
      jwt: "offpeak-mock-jwt",
      codingPlanApiKey: "offpeak-mock-key",
      kind: "bigmodel-personal",
      providerFamily: "bigmodel",
      providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const provider = await deps.resolveAccountProvider();
    const selection = resolveSelectedOffPeakCodingPlan(provider);
    const activeProvider =
      (await deps.credentialService.load(ACTIVE_OAUTH_PROVIDER_KEY))?.trim() ?? "";
    if (activeProvider !== selection.providerFamily) {
      throw new OffPeakCodingPlanUnavailableError("provider_identity_mismatch");
    }
    const jwt = (await deps.credentialService.load(CF_JWT_TOKEN_KEY))?.trim() ?? "";
    if (!jwt) {
      throw new OffPeakCredentialsUnavailableError("jwt");
    }
    const [latestProvider, latestActiveProvider] = await Promise.all([
      deps.resolveAccountProvider(),
      deps.credentialService.load(ACTIVE_OAUTH_PROVIDER_KEY),
    ]);
    if (
      createOffPeakSelectionFingerprint(provider) !==
        createOffPeakSelectionFingerprint(latestProvider) ||
      activeProvider !== latestActiveProvider?.trim()
    ) {
      continue;
    }

    if (
      !provider ||
      provider.access.family !== selection.providerFamily ||
      (selection.kind.endsWith("-team")
        ? provider.access.planKind !== "team-coding-plan"
        : provider.access.planKind !== "individual-coding-plan")
    ) {
      throw new OffPeakCodingPlanUnavailableError("connection_unavailable");
    }
    let codingPlanApiKey = "";
    let accountScope: string | undefined;
    try {
      const auth = await deps.accountRequestAuthService.resolveCurrent({
        providerId: selection.providerId,
        modelId: resolveOffPeakProviderId(selection.providerFamily),
        accountAccess: provider.access,
        reason: "off-peak",
      });
      codingPlanApiKey = auth.apiKey?.trim() ?? "";
      accountScope = auth.accountScope;
    } catch (error) {
      if (error instanceof AccountRequestCredentialUnavailableError) {
        throw new OffPeakCredentialsUnavailableError("codingPlanApiKey");
      }
      throw error;
    }
    if (!codingPlanApiKey) {
      throw new OffPeakCredentialsUnavailableError("codingPlanApiKey");
    }
    return {
      ...selection,
      jwt,
      codingPlanApiKey,
      ...(accountScope ? { accountScope } : {}),
      ...(provider.baseURL ? { providerBaseURL: provider.baseURL } : {}),
    };
  }

  throw new OffPeakCodingPlanUnavailableError("selection_changed");
}

export function buildOffPeakPlanIdentityHeaders(
  credentials: OffPeakCredentialSnapshot,
): Record<string, string> {
  if (credentials.kind !== "bigmodel-team") {
    return {};
  }
  const organizationId = credentials.organizationId?.trim() ?? "";
  const projectId = credentials.projectId?.trim() ?? "";
  if (!organizationId || !projectId) {
    return {};
  }
  return {
    "bigmodel-organization": organizationId,
    "bigmodel-project": projectId,
  };
}

export function buildOffPeakRequestAuth(params: {
  credentials: OffPeakCredentialSnapshot;
  ticketId: string;
}): { apiKey: string; headers: Record<string, string>; accountScope?: string } {
  return {
    apiKey: params.credentials.jwt,
    ...(params.credentials.accountScope ? { accountScope: params.credentials.accountScope } : {}),
    headers: {
      Authorization: `Bearer ${params.credentials.jwt}`,
      "X-Coding-Plan-Api-Key": params.credentials.codingPlanApiKey,
      "X-Off-Peak-Ticket-ID": params.ticketId,
      ...buildOffPeakPlanIdentityHeaders(params.credentials),
    },
  };
}

export async function resolveOffPeakCodingPlanSupport(
  deps: OffPeakCredentialResolverDeps,
): Promise<OffPeakCodingPlanSupport> {
  try {
    const snapshot = await resolveOffPeakCredentials(deps);
    return {
      supported: true,
      kind: snapshot.kind,
      providerFamily: snapshot.providerFamily,
      providerId: snapshot.providerId,
    };
  } catch (error) {
    if (error instanceof OffPeakCodingPlanUnavailableError) {
      return { supported: false, reason: error.reason };
    }
    if (error instanceof OffPeakCredentialsUnavailableError) {
      return {
        supported: false,
        reason: error.missing === "jwt" ? "jwt_missing" : "connection_unavailable",
      };
    }
    throw error;
  }
}

export async function resolveOffPeakMockUpstream(deps: {
  credentialService: OffPeakCredentialResolverDeps["credentialService"];
  accountRequestAuthService: OffPeakCredentialResolverDeps["accountRequestAuthService"];
  resolveAccountProvider: OffPeakCredentialResolverDeps["resolveAccountProvider"];
  env?: NodeJS.ProcessEnv;
}): Promise<{ url: string; headers: Record<string, string> }> {
  const credentials = await resolveOffPeakCredentials(deps, {
    allowMockCredentials: false,
  });
  if (!credentials.providerBaseURL) {
    throw new Error("off-peak mock upstream requires a selected coding plan provider endpoint");
  }
  return {
    url: `${credentials.providerBaseURL.replace(/\/$/, "")}/v1/messages`,
    headers: {
      "x-api-key": credentials.codingPlanApiKey,
      authorization: `Bearer ${credentials.codingPlanApiKey}`,
    },
  };
}

export function createOffPeakOriginResolver(deps: {
  logger: ServiceLogger;
  resolveUpstream: () => Promise<{ url: string; headers: Record<string, string> }>;
  env?: NodeJS.ProcessEnv;
}): { resolveOrigin: () => Promise<string>; close: () => Promise<void> } {
  const env = deps.env ?? process.env;
  let originPromise: Promise<string> | null = null;
  let closeGateway: (() => Promise<void>) | null = null;
  return {
    resolveOrigin: () => {
      if (!originPromise) {
        originPromise = (async () => {
          if (!isOffPeakMockEnabled(env)) {
            return new URL(buildRuntimeCfApiUrl(env, "/")).origin;
          }
          const gateway = await startOffPeakMockGateway({
            logger: deps.logger,
            resolveUpstream: deps.resolveUpstream,
          });
          if (!gateway.external) closeGateway = gateway.close;
          return gateway.origin;
        })().catch((error) => {
          originPromise = null;
          throw error;
        });
      }
      return originPromise;
    },
    close: async () => {
      const close = closeGateway;
      closeGateway = null;
      if (close) await close();
    },
  };
}
