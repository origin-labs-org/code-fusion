
import {
  OFFICIAL_MCP_AUTH_HEADER_NAMES,
  getModelProviderFamilySpec,
  cfProviderAccountAccessSchema,
  type OfficialMcpAuthFailureReason,
  type CfAccountAccess,
  type CfProviderAccountAccess,
} from "@origin-ai/cf-shared";
import type { ModelSelectionView } from "@origin-ai/cf-provider";
import { createServiceLogger } from "#src/logger/serviceLogger.js";

const log = createServiceLogger("official-mcp");

const CF_JWT_TOKEN_KEY = "cfjwttoken";
const ACTIVE_OAUTH_PROVIDER_KEY = "oauth:active_provider";

function maasJwtCredentialKey(providerFamily: "zai" | "bigmodel"): string {
  return `oauth:${getModelProviderFamilySpec(providerFamily).oauthProviderId}:access_token`;
}

function readJwtExpiresInSeconds(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const decoded: unknown = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null) return undefined;
    const exp = (decoded as { exp?: unknown }).exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return undefined;
    return Math.round(exp - Date.now() / 1000);
  } catch {
    return undefined;
  }
}

const CREDENTIAL_RESOLVED_LOG_BUCKET_SECONDS = 3600;

export function createCredentialResolvedLogKey(input: {
  providerFamily: "zai" | "bigmodel";
  planTargetType: string | null;
  maasJwtExpiresInSeconds: number | undefined;
}): string {
  const expires = input.maasJwtExpiresInSeconds;
  const expiryBucket =
    expires === undefined
      ? "unparsable"
      : expires <= 0
        ? "expired"
        : `t${Math.floor(expires / CREDENTIAL_RESOLVED_LOG_BUCKET_SECONDS)}`;
  return `${input.providerFamily}|${input.planTargetType ?? "none"}|${expiryBucket}`;
}

let lastCredentialResolvedLogKey: string | undefined;

export interface OfficialMcpCredentialResolverDeps {
  accountRequestAuthService: {
    resolveAccessCurrent(access: CfProviderAccountAccess): Promise<CfAccountAccess | null>;
  };
  credentialService: { load(key: string): Promise<string | null | undefined> };
  modelSelectionService: {
    getView(): Promise<ModelSelectionView>;
  };
}

export type OfficialMcpPlanScope =
  | { targetType: "PERSONAL" }
  | { targetType: "TEAM"; organizationId: string; projectId: string };

export type OfficialMcpWireScope = OfficialMcpPlanScope | null;

export interface OfficialMcpCredentialSnapshot {
  jwt: string;
  
  codingPlanAuthorization?: string;
  providerFamily: "zai" | "bigmodel";
  
  planScope: OfficialMcpPlanScope | null;
  
  wireScope: OfficialMcpWireScope;
}

export type OfficialMcpCredentialOutcome =
  | { ok: true; snapshot: OfficialMcpCredentialSnapshot }
  | { ok: false; reason: OfficialMcpAuthFailureReason };

type SelectedPlan = {
  providerFamily: "zai" | "bigmodel";
  providerId: string;
  planScope: OfficialMcpPlanScope | null;
  wireScope: OfficialMcpWireScope;
};

type SelectedProvider = {
  providerId: string;
  access: CfProviderAccountAccess;
};

function fail(reason: OfficialMcpAuthFailureReason): {
  ok: false;
  reason: OfficialMcpAuthFailureReason;
} {
  return { ok: false, reason };
}

function resolveSelectedProvider(
  registry: ModelSelectionView,
): { ok: true; provider: SelectedProvider } | { ok: false; reason: OfficialMcpAuthFailureReason } {
  const candidates = registry.providers.flatMap((provider) => {
    const parsed = cfProviderAccountAccessSchema.safeParse(provider.config.access);
    return parsed.success &&
      (parsed.data.mode === "individual-coding-plan" || parsed.data.mode === "team-coding-plan")
      ? [{ providerId: provider.providerId, access: parsed.data }]
      : [];
  });
  if (candidates.length !== 1) {
    return fail("official_auth_plan_required");
  }
  return { ok: true, provider: candidates[0]! };
}

function resolveSelectedPlan(
  selectedProvider: SelectedProvider,
  access: CfAccountAccess | null,
): { ok: true; plan: SelectedPlan } | { ok: false; reason: OfficialMcpAuthFailureReason } {
  if (
    !access ||
    access.family !== selectedProvider.access.accountType ||
    (selectedProvider.access.mode === "team-coding-plan"
      ? access.planKind !== "team-coding-plan"
      : access.planKind !== "individual-coding-plan")
  ) {
    return fail("official_auth_plan_required");
  }
  const { providerId } = selectedProvider;
  const providerFamily = access.family;
  if (access.planKind === "team-coding-plan") {
    const teamScope: OfficialMcpPlanScope = {
      organizationId: access.organizationId,
      projectId: access.projectId,
      targetType: "TEAM",
    };
    return {
      ok: true,
      plan: {
        providerFamily,
        providerId,
        planScope: teamScope,
        wireScope: providerFamily === "bigmodel" ? teamScope : null,
      },
    };
  }
  return {
    ok: true,
    plan: {
      providerFamily,
      providerId,
      planScope: { targetType: "PERSONAL" },
      wireScope: { targetType: "PERSONAL" },
    },
  };
}

function createSelectionFingerprint(registry: ModelSelectionView): string {
  return JSON.stringify({ revision: registry.revision, providers: registry.providers });
}

type OfficialMcpIdentitySnapshot = {
  activeProvider: "zai" | "bigmodel";
  jwt: string;
  registry: ModelSelectionView;
  selectionFingerprint: string;
};

async function readIdentitySnapshot(
  deps: OfficialMcpCredentialResolverDeps,
): Promise<
  | { ok: true; snapshot: OfficialMcpIdentitySnapshot }
  | { ok: false; reason: OfficialMcpAuthFailureReason }
> {
  const [registry, activeProviderValue, jwtValue] = await Promise.all([
    deps.modelSelectionService.getView(),
    deps.credentialService.load(ACTIVE_OAUTH_PROVIDER_KEY),
    deps.credentialService.load(CF_JWT_TOKEN_KEY),
  ]);
  const activeProvider = activeProviderValue?.trim();
  const jwt = jwtValue?.trim() ?? "";
  if ((activeProvider !== "zai" && activeProvider !== "bigmodel") || !jwt) {
    return fail("official_auth_unavailable");
  }
  return {
    ok: true,
    snapshot: {
      activeProvider,
      jwt,
      registry,
      selectionFingerprint: createSelectionFingerprint(registry),
    },
  };
}

function isSameIdentitySnapshot(
  before: OfficialMcpIdentitySnapshot,
  after: OfficialMcpIdentitySnapshot,
): boolean {
  return (
    before.activeProvider === after.activeProvider &&
    before.jwt === after.jwt &&
    before.selectionFingerprint === after.selectionFingerprint
  );
}

function identityOnlyOutcome(identity: OfficialMcpIdentitySnapshot): OfficialMcpCredentialOutcome {
  log.debug("official mcp identity-only credentials resolved", {
    providerFamily: identity.activeProvider,
    reason: "official_auth_plan_required",
  });
  return {
    ok: true,
    snapshot: {
      jwt: identity.jwt,
      planScope: null,
      providerFamily: identity.activeProvider,
      wireScope: null,
    },
  };
}

export async function resolveOfficialMcpCredentials(
  deps: OfficialMcpCredentialResolverDeps,
): Promise<OfficialMcpCredentialOutcome> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const identity = await readIdentitySnapshot(deps);
    if (!identity.ok) {
      if (attempt === 0) continue;
      return identity;
    }
    const selectedProvider = resolveSelectedProvider(identity.snapshot.registry);
    if (!selectedProvider.ok) {
      const latestIdentity = await readIdentitySnapshot(deps);
      if (
        !latestIdentity.ok ||
        !isSameIdentitySnapshot(identity.snapshot, latestIdentity.snapshot)
      ) {
        continue;
      }
      return identityOnlyOutcome(identity.snapshot);
    }
    const accountAccess = await deps.accountRequestAuthService.resolveAccessCurrent(
      selectedProvider.provider.access,
    );
    const selected = resolveSelectedPlan(selectedProvider.provider, accountAccess);
    if (!selected.ok) return selected;

    if (identity.snapshot.activeProvider !== selected.plan.providerFamily) {
      return fail("official_auth_unavailable");
    }

    const maasJwtKey = maasJwtCredentialKey(selected.plan.providerFamily);
    const codingPlanAuthorization = (await deps.credentialService.load(maasJwtKey))?.trim() ?? "";
    if (!codingPlanAuthorization) {
      log.warn("official mcp maas jwt missing", {
        providerFamily: selected.plan.providerFamily,
        reason: "official_auth_unavailable",
      });
      return fail("official_auth_unavailable");
    }

    const [latestIdentity, latestMaasJwt] = await Promise.all([
      readIdentitySnapshot(deps),
      deps.credentialService.load(maasJwtKey),
    ]);
    const latestSelectedProvider = latestIdentity.ok
      ? resolveSelectedProvider(latestIdentity.snapshot.registry)
      : latestIdentity;
    const latestAccountAccess = latestSelectedProvider.ok
      ? await deps.accountRequestAuthService.resolveAccessCurrent(
          latestSelectedProvider.provider.access,
        )
      : null;
    if (
      !latestIdentity.ok ||
      !isSameIdentitySnapshot(identity.snapshot, latestIdentity.snapshot) ||
      !latestSelectedProvider.ok ||
      JSON.stringify(accountAccess) !== JSON.stringify(latestAccountAccess) ||
      codingPlanAuthorization !== (latestMaasJwt?.trim() ?? "")
    ) {
      continue;
    }

    const provider = identity.snapshot.registry.providers.find(
      (candidate) => candidate.providerId === selected.plan.providerId,
    );
    if (!provider) return fail("official_auth_plan_required");

    const maasJwtExpiresInSeconds = readJwtExpiresInSeconds(codingPlanAuthorization);
    const logKey = createCredentialResolvedLogKey({
      providerFamily: selected.plan.providerFamily,
      planTargetType: selected.plan.planScope?.targetType ?? null,
      maasJwtExpiresInSeconds,
    });
    if (logKey !== lastCredentialResolvedLogKey) {
      lastCredentialResolvedLogKey = logKey;
      log.info("official mcp credentials resolved", {
        maasJwtExpiresInSeconds,
        providerFamily: selected.plan.providerFamily,
        planTargetType: selected.plan.planScope?.targetType ?? null,
        wireTargetType: selected.plan.wireScope?.targetType ?? null,
      });
    }

    return {
      ok: true,
      snapshot: {
        codingPlanAuthorization,
        jwt: identity.snapshot.jwt,
        planScope: selected.plan.planScope,
        providerFamily: selected.plan.providerFamily,
        wireScope: selected.plan.wireScope,
      },
    };
  }

  return fail("official_auth_unavailable");
}

export function buildOfficialMcpAuthHeaders(
  snapshot: OfficialMcpCredentialSnapshot,
): Record<string, string> {
  const headers: Record<string, string> = {
    [OFFICIAL_MCP_AUTH_HEADER_NAMES.authorization]: `Bearer ${snapshot.jwt}`,
  };
  if (snapshot.codingPlanAuthorization) {
    headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.codingPlanAuthorization] =
      `Bearer ${snapshot.codingPlanAuthorization}`;
  }
  const scope = snapshot.wireScope;
  if (scope) {
    headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.targetType] = scope.targetType;
    if (scope.targetType === "TEAM") {
      headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.organization] = scope.organizationId;
      headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.project] = scope.projectId;
    }
  }
  return headers;
}

export interface OfficialMcpAuthHeadersRequestContext {
  mcpKey: string;
  pluginId: string;
  targetOrigin: string;
  workspace: { workspaceIdentity?: string; workspaceKey: string; workspacePath: string };
}

export type OfficialMcpAuthHeadersOutcome =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: OfficialMcpAuthFailureReason };

export function createOfficialMcpAuthHeadersResolver(deps: OfficialMcpCredentialResolverDeps): {
  resolveHeaders(
    request?: OfficialMcpAuthHeadersRequestContext,
  ): Promise<OfficialMcpAuthHeadersOutcome>;
} {
  let pending: Promise<OfficialMcpAuthHeadersOutcome> | null = null;

  return {
    resolveHeaders(_request?: OfficialMcpAuthHeadersRequestContext) {
      if (pending) return pending;
      const inFlight = (async (): Promise<OfficialMcpAuthHeadersOutcome> => {
        const outcome = await resolveOfficialMcpCredentials(deps);
        if (!outcome.ok) return { ok: false, reason: outcome.reason };
        return { ok: true, headers: buildOfficialMcpAuthHeaders(outcome.snapshot) };
      })();
      pending = inFlight;
      const clear = (): void => {
        if (pending === inFlight) pending = null;
      };
      inFlight.then(clear, clear);
      return inFlight;
    },
  };
}
