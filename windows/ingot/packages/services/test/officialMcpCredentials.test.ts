
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_MODEL_PROVIDER_IDS, type CfAccountAccess } from "@origin-ai/cf-shared";
import type { ModelSelectionView } from "@origin-ai/cf-provider";

const { serviceInfo } = vi.hoisted(() => ({ serviceInfo: vi.fn() }));

vi.mock("#src/logger/serviceLogger.js", () => ({
  createServiceLogger: () => ({
    debug: vi.fn(),
    info: serviceInfo,
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  buildOfficialMcpAuthHeaders,
  createCredentialResolvedLogKey,
  createOfficialMcpAuthHeadersResolver,
  resolveOfficialMcpCredentials,
  type OfficialMcpCredentialResolverDeps,
} from "../src/official-mcp/officialMcpCredentials.js";

const JWT = "cf-jwt-value";

const MAAS_JWT = "bigmodel-maas-jwt";
const ZAI_MAAS_JWT = "zai-maas-jwt";

function createRegistry(
  providers: Array<{ providerId: string; config: { access: Record<string, unknown> } }>,
): ModelSelectionView {
  return { revision: 1, providers } as unknown as ModelSelectionView;
}

function individualProvider(family: "zai" | "bigmodel") {
  return {
    providerId:
      family === "zai"
        ? BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan
        : BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    config: {
      access: {
        type: "zhipu-account",
        accountType: family,
        mode: "individual-coding-plan",
        entitled: true,
      },
    },
  };
}

function teamProvider(family: "zai" | "bigmodel") {
  return {
    providerId:
      family === "zai"
        ? BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan
        : BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
    config: {
      access: {
        type: "zhipu-account",
        accountType: family,
        mode: "team-coding-plan",
        entitled: true,
      },
    },
  };
}

interface DepsOverrides {
  activeProvider?: string | null;
  activeProviderSequence?: Array<string | null>;
  jwt?: string | null;
  
  jwtSequence?: Array<string | null>;
  
  maasJwt?: string | null;
  
  maasJwtSequence?: Array<string | null>;
  registry?: ModelSelectionView;
  registrySequence?: ModelSelectionView[];
  settings?: Record<string, unknown>;
  settingsSequence?: Array<Record<string, unknown>>;
  accountAccess?: CfAccountAccess | null;
  accountAccessSequence?: Array<CfAccountAccess | null>;
}

function createDeps(overrides: DepsOverrides = {}): OfficialMcpCredentialResolverDeps {
  let activeProviderCalls = 0;
  let jwtCalls = 0;
  let maasJwtCalls = 0;
  let registryCalls = 0;
  let accountAccessCalls = 0;
  return {
    accountRequestAuthService: {
      resolveAccessCurrent: async (access) => {
        if (overrides.accountAccessSequence) {
          const value =
            overrides.accountAccessSequence[
              Math.min(accountAccessCalls, overrides.accountAccessSequence.length - 1)
            ];
          accountAccessCalls += 1;
          return value ?? null;
        }
        if (overrides.accountAccess !== undefined) return overrides.accountAccess;
        return access.mode === "individual-coding-plan"
          ? {
              type: "zhipu-account" as const,
              family: access.accountType,
              planKind: "individual-coding-plan" as const,
            }
          : null;
      },
    },
    credentialService: {
      load: async (key: string) => {
        if (key === "oauth:active_provider") {
          if (overrides.activeProviderSequence) {
            const value =
              overrides.activeProviderSequence[
                Math.min(activeProviderCalls, overrides.activeProviderSequence.length - 1)
              ];
            activeProviderCalls += 1;
            return value ?? null;
          }
          return overrides.activeProvider === undefined ? "bigmodel" : overrides.activeProvider;
        }
        if (key === "cfjwttoken") {
          if (overrides.jwtSequence) {
            const value =
              overrides.jwtSequence[Math.min(jwtCalls, overrides.jwtSequence.length - 1)];
            jwtCalls += 1;
            return value ?? null;
          }
          return overrides.jwt === undefined ? JWT : overrides.jwt;
        }
        if (key === "oauth:bigmodel:access_token" || key === "oauth:zai:access_token") {
          if (overrides.maasJwtSequence) {
            const value =
              overrides.maasJwtSequence[
                Math.min(maasJwtCalls, overrides.maasJwtSequence.length - 1)
              ];
            maasJwtCalls += 1;
            return value ?? null;
          }
          if (overrides.maasJwt !== undefined) return overrides.maasJwt;
          return key === "oauth:zai:access_token" ? ZAI_MAAS_JWT : MAAS_JWT;
        }
        return null;
      },
    },
    modelSelectionService: {
      getView: async () => {
        const fallback = overrides.registry ?? createRegistry([individualProvider("bigmodel")]);
        const value =
          overrides.registrySequence?.[
            Math.min(registryCalls, overrides.registrySequence.length - 1)
          ];
        registryCalls += 1;
        return value ?? fallback;
      },
    },
  };
}

describe("official mcp credential resolver", () => {
  it("OMCP-021: emits PERSONAL target type for a personal coding plan", async () => {
    const outcome = await resolveOfficialMcpCredentials(createDeps());
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.snapshot.planScope).toEqual({ targetType: "PERSONAL" });
    expect(outcome.snapshot.wireScope).toEqual({ targetType: "PERSONAL" });
    expect(buildOfficialMcpAuthHeaders(outcome.snapshot)).toEqual({
      Authorization: `Bearer ${JWT}`,
      "Bigmodel-Target-Type": "PERSONAL",
      "X-Bigmodel-Authorization": `Bearer ${MAAS_JWT}`,
    });
  });

  it("OMCP-005/021: emits TEAM target type with paired identity for a BigModel team plan", async () => {
    const outcome = await resolveOfficialMcpCredentials(
      createDeps({
        registry: createRegistry([teamProvider("bigmodel")]),
        accountAccess: {
          type: "zhipu-account",
          family: "bigmodel",
          planKind: "team-coding-plan",
          productId: "coding",
          organizationId: "org-1",
          projectId: "project-1",
        },
        settings: {
          providerFamilyConnectionSelections: {
            bigmodel: {
              kind: "team-coding-plan",
              productId: "coding",
              organizationId: "org-1",
              projectId: "project-1",
            },
          },
          providerFamilyDomain: "bigmodel",
        },
      }),
    );
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.snapshot).toMatchObject({
      planScope: {
        organizationId: "org-1",
        projectId: "project-1",
        targetType: "TEAM",
      },
      wireScope: {
        organizationId: "org-1",
        projectId: "project-1",
        targetType: "TEAM",
      },
    });
    expect(buildOfficialMcpAuthHeaders(outcome.snapshot)).toEqual({
      Authorization: `Bearer ${JWT}`,
      "Bigmodel-Organization": "org-1",
      "Bigmodel-Project": "project-1",
      "Bigmodel-Target-Type": "TEAM",
      "X-Bigmodel-Authorization": `Bearer ${MAAS_JWT}`,
    });
  });

  it("OMCP-006: wireScope=null never emits partial team headers", () => {
    expect(
      buildOfficialMcpAuthHeaders({
        codingPlanAuthorization: MAAS_JWT,
        jwt: JWT,
        planScope: null,
        providerFamily: "bigmodel",
        wireScope: null,
      }),
    ).toEqual({
      Authorization: `Bearer ${JWT}`,
      "X-Bigmodel-Authorization": `Bearer ${MAAS_JWT}`,
    });
  });

  it("OMCP-021: keeps zai-team consistent with Off-Peak by omitting Target-Type entirely", async () => {
    const outcome = await resolveOfficialMcpCredentials(
      createDeps({
        activeProvider: "zai",
        registry: createRegistry([teamProvider("zai")]),
        accountAccess: {
          type: "zhipu-account",
          family: "zai",
          planKind: "team-coding-plan",
          productId: "coding",
          organizationId: "org-z",
          projectId: "project-z",
        },
        settings: {
          providerFamilyConnectionSelections: {
            zai: {
              kind: "team-coding-plan",
              productId: "coding",
              organizationId: "org-z",
              projectId: "project-z",
            },
          },
          providerFamilyDomain: "zai",
        },
      }),
    );
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.snapshot.planScope).toEqual({
      organizationId: "org-z",
      projectId: "project-z",
      targetType: "TEAM",
    });
    expect(outcome.snapshot.wireScope).toBeNull();
    const headers = buildOfficialMcpAuthHeaders(outcome.snapshot);
    expect(headers["Bigmodel-Target-Type"]).toBeUndefined();
    expect(headers["Bigmodel-Organization"]).toBeUndefined();
    expect(headers["Bigmodel-Project"]).toBeUndefined();
  });

  it("OMCP-023: sends only the CodeFusion JWT for a Start Plan connection", async () => {
    const outcome = await resolveOfficialMcpCredentials(
      createDeps({
        registry: createRegistry([
          {
            providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
            config: {
              access: {
                type: "zhipu-account",
                family: "bigmodel",
                mode: "start-plan",
              },
            },
          },
        ]),
      }),
    );
    expect(outcome).toEqual({
      ok: true,
      snapshot: {
        jwt: JWT,
        planScope: null,
        providerFamily: "bigmodel",
        wireScope: null,
      },
    });
    if (!outcome.ok) return;
    expect(buildOfficialMcpAuthHeaders(outcome.snapshot)).toEqual({
      Authorization: `Bearer ${JWT}`,
    });
  });

  it("OMCP-009: reports unavailable when not logged in and plan-required without Account Access", async () => {
    await expect(resolveOfficialMcpCredentials(createDeps({ jwt: "" }))).resolves.toEqual({
      ok: false,
      reason: "official_auth_unavailable",
    });
    await expect(
      resolveOfficialMcpCredentials(
        createDeps({
          accountAccess: null,
          registry: createRegistry([individualProvider("bigmodel")]),
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: "official_auth_plan_required" });
  });

  it("rejects a login identity that does not match the selected family", async () => {
    await expect(
      resolveOfficialMcpCredentials(createDeps({ activeProvider: "zai" })),
    ).resolves.toEqual({ ok: false, reason: "official_auth_unavailable" });
  });

  it("sends only the CodeFusion JWT when the selected coding plan connection is absent", async () => {
    const outcome = await resolveOfficialMcpCredentials(
      createDeps({ registry: createRegistry([]) }),
    );
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(buildOfficialMcpAuthHeaders(outcome.snapshot)).toEqual({
      Authorization: `Bearer ${JWT}`,
    });
  });

  it("does not require a MaaS JWT when no Coding Plan provider is selected", async () => {
    const outcome = await resolveOfficialMcpCredentials(
      createDeps({ maasJwt: null, registry: createRegistry([]) }),
    );
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.snapshot.codingPlanAuthorization).toBeUndefined();
  });

  it("rejects an identity-only snapshot while the active provider remains unstable", async () => {
    await expect(
      resolveOfficialMcpCredentials(
        createDeps({
          activeProviderSequence: ["bigmodel", "zai", "bigmodel", "zai"],
          registry: createRegistry([]),
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: "official_auth_unavailable" });
  });

  it("reports official_auth_unavailable when the MaaS login JWT is missing", async () => {
    await expect(resolveOfficialMcpCredentials(createDeps({ maasJwt: "" }))).resolves.toEqual({
      ok: false,
      reason: "official_auth_unavailable",
    });
  });

  it("takes the MaaS JWT of the selected family, never the other one", async () => {
    const outcome = await resolveOfficialMcpCredentials(
      createDeps({
        activeProvider: "zai",
        registry: createRegistry([individualProvider("zai")]),
        settings: {
          providerFamilyConnectionSelections: {
            zai: { kind: "individual-coding-plan" },
          },
          providerFamilyDomain: "zai",
        },
      }),
    );
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.snapshot.codingPlanAuthorization).toBe(ZAI_MAAS_JWT);
  });

  it("re-resolves once when the selection changes mid-flight, then gives up", async () => {
    const flipping = [
      createRegistry([individualProvider("bigmodel")]),
      createRegistry([individualProvider("zai")]),
    ];
    const outcome = await resolveOfficialMcpCredentials(
      createDeps({ registrySequence: [flipping[0]!, flipping[1]!, flipping[0]!, flipping[1]!] }),
    );
    expect(outcome).toEqual({ ok: false, reason: "official_auth_unavailable" });
  });

  it("动态 Team scope 在解析前后变化时不拼接两代身份", async () => {
    const teamAccess = (projectId: string): CfAccountAccess => ({
      type: "zhipu-account",
      family: "bigmodel",
      planKind: "team-coding-plan",
      productId: "coding",
      organizationId: "org-1",
      projectId,
    });
    const outcome = await resolveOfficialMcpCredentials(
      createDeps({
        registry: createRegistry([teamProvider("bigmodel")]),
        accountAccessSequence: [
          teamAccess("project-a"),
          teamAccess("project-b"),
          teamAccess("project-a"),
          teamAccess("project-b"),
        ],
      }),
    );
    expect(outcome).toEqual({ ok: false, reason: "official_auth_unavailable" });
  });

  it("SG-01: discards the round when the JWT rotates during the registry read", async () => {
    const outcome = await resolveOfficialMcpCredentials(
      createDeps({
        jwtSequence: ["jwt-gen-1", "jwt-gen-2", "jwt-gen-3", "jwt-gen-4"],
      }),
    );
    expect(outcome).toEqual({ ok: false, reason: "official_auth_unavailable" });
  });

  it("discards the round when the MaaS JWT rotates during the registry read", async () => {
    const outcome = await resolveOfficialMcpCredentials(
      createDeps({
        maasJwtSequence: ["maas-gen-1", "maas-gen-2", "maas-gen-3", "maas-gen-4"],
      }),
    );
    expect(outcome).toEqual({ ok: false, reason: "official_auth_unavailable" });
  });

  it("SG-01: accepts the snapshot when the JWT stays stable across the registry read", async () => {
    const outcome = await resolveOfficialMcpCredentials(
      createDeps({ jwtSequence: ["jwt-stable", "jwt-stable"] }),
    );
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.snapshot.jwt).toBe("jwt-stable");
  });

  it("SG-01: recovers when the JWT rotates once and then settles", async () => {
    const outcome = await resolveOfficialMcpCredentials(
      createDeps({ jwtSequence: ["jwt-gen-1", "jwt-gen-2", "jwt-gen-2", "jwt-gen-2"] }),
    );
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.snapshot.jwt).toBe("jwt-gen-2");
  });

  it("OMCP-024: has no mock credential branch at all", async () => {
    const previous = process.env["CF_OFFPEAK_MOCK"];
    process.env["CF_OFFPEAK_MOCK"] = "1";
    try {
      const outcome = await resolveOfficialMcpCredentials(createDeps({ jwt: "" }));
      expect(outcome).toEqual({ ok: false, reason: "official_auth_unavailable" });
      const ok = await resolveOfficialMcpCredentials(createDeps());
      expect(ok).toMatchObject({ ok: true });
      if (!ok.ok) return;
      expect(ok.snapshot.jwt).toBe(JWT);
      expect(ok.snapshot.codingPlanAuthorization).toBe(MAAS_JWT);
    } finally {
      if (previous === undefined) delete process.env["CF_OFFPEAK_MOCK"];
      else process.env["CF_OFFPEAK_MOCK"] = previous;
    }
  });

  it("OMCP-026: dedupes concurrent resolves into a single underlying resolution", async () => {
    const deps = createDeps();
    const spy = vi.spyOn(deps.modelSelectionService, "getView");
    const resolver = createOfficialMcpAuthHeadersResolver(deps);
    const results = await Promise.all([
      resolver.resolveHeaders(),
      resolver.resolveHeaders(),
      resolver.resolveHeaders(),
      resolver.resolveHeaders(),
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
  });

  it("OMCP-027: re-resolves after settle, so a connection switch is picked up", async () => {
    const deps = createDeps();
    const spy = vi.spyOn(deps.modelSelectionService, "getView");
    const resolver = createOfficialMcpAuthHeadersResolver(deps);
    await resolver.resolveHeaders();
    await resolver.resolveHeaders();
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("clears the in-flight slot when a resolution throws", async () => {
    let shouldThrow = true;
    const deps = createDeps();
    deps.modelSelectionService.getView = async () => {
      if (shouldThrow) throw new Error("registry unavailable");
      return createRegistry([individualProvider("bigmodel")]);
    };
    const resolver = createOfficialMcpAuthHeadersResolver(deps);
    await expect(resolver.resolveHeaders()).rejects.toThrow("registry unavailable");
    shouldThrow = false;
    await expect(resolver.resolveHeaders()).resolves.toMatchObject({ ok: true });
  });
});

describe("official mcp credential resolved log", () => {
  it("OMCP-LOG-01: dedup key buckets expiry by hour and separates family/scope", () => {
    const personal = { providerFamily: "bigmodel", planTargetType: "PERSONAL" } as const;
    expect(createCredentialResolvedLogKey({ ...personal, maasJwtExpiresInSeconds: 3600 })).toBe(
      "bigmodel|PERSONAL|t1",
    );
    expect(createCredentialResolvedLogKey({ ...personal, maasJwtExpiresInSeconds: 3599 })).toBe(
      "bigmodel|PERSONAL|t0",
    );
    expect(createCredentialResolvedLogKey({ ...personal, maasJwtExpiresInSeconds: -5 })).toBe(
      "bigmodel|PERSONAL|expired",
    );
    expect(
      createCredentialResolvedLogKey({ ...personal, maasJwtExpiresInSeconds: undefined }),
    ).toBe("bigmodel|PERSONAL|unparsable");
    expect(
      createCredentialResolvedLogKey({
        providerFamily: "zai",
        planTargetType: null,
        maasJwtExpiresInSeconds: 100,
      }),
    ).toBe("zai|none|t0");
    expect(
      createCredentialResolvedLogKey({
        providerFamily: "zai",
        planTargetType: "TEAM",
        maasJwtExpiresInSeconds: 100,
      }),
    ).not.toBe(
      createCredentialResolvedLogKey({
        providerFamily: "zai",
        planTargetType: "PERSONAL",
        maasJwtExpiresInSeconds: 100,
      }),
    );
  });

  it("OMCP-LOG-02: logs jwt expiry at info level and dedupes same-bucket re-resolves", async () => {
    const deps = createDeps({ maasJwt: makeMaasJwtWithExpiry(123456) });
    serviceInfo.mockClear();
    const first = await resolveOfficialMcpCredentials(deps);
    expect(first.ok).toBe(true);
    const resolvedCalls = () =>
      serviceInfo.mock.calls.filter(
        (call): call is [string, Record<string, unknown>] =>
          call[0] === "official mcp credentials resolved",
      );
    expect(resolvedCalls()).toHaveLength(1);
    const fields = resolvedCalls()[0]![1]!;
    expect(fields).toMatchObject({
      providerFamily: "bigmodel",
      planTargetType: "PERSONAL",
      wireTargetType: "PERSONAL",
    });
    expect(fields["maasJwtExpiresInSeconds"]).toBeGreaterThan(123_000);
    expect(fields["maasJwtExpiresInSeconds"]).toBeLessThan(123_900);

    const second = await resolveOfficialMcpCredentials(
      createDeps({ maasJwt: makeMaasJwtWithExpiry(123456) }),
    );
    expect(second.ok).toBe(true);
    expect(resolvedCalls()).toHaveLength(1);
  });

  it("OMCP-LOG-03: identity-only degradation stays out of info logs", async () => {
    const deps = createDeps({ registry: createRegistry([]) });
    const outcome = await resolveOfficialMcpCredentials(deps);
    expect(outcome).toMatchObject({ ok: true });
    expect(
      serviceInfo.mock.calls.filter((call) => String(call[0]).includes("identity-only")),
    ).toHaveLength(0);
  });
});

function makeMaasJwtWithExpiry(expiresInSeconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.round(Date.now() / 1000) + expiresInSeconds }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}
