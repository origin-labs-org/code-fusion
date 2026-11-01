
import { describe, expect, it } from "vitest";
import {
  createOfficialMcpTrustedOriginRegistry,
  isOfficialMcpOriginTrusted,
} from "../src/official-mcp-auth.js";

const OFFICIAL_PLUGIN = "cf-tools@cf-plugins-official";
const CF_ORIGIN = "https://cf.z.ai";

function check(input: {
  devTrustedOriginsRaw?: string;
  origin: string;
  pluginId?: string;
  cfApiOrigin?: string | undefined;
}) {
  return isOfficialMcpOriginTrusted({
    devTrustedOriginsRaw: input.devTrustedOriginsRaw,
    origin: input.origin,
    pluginId: input.pluginId ?? OFFICIAL_PLUGIN,
    cfApiOrigin: "cfApiOrigin" in input ? input.cfApiOrigin : CF_ORIGIN,
  });
}

describe("isOfficialMcpOriginTrusted", () => {
  it("trusts the current CodeFusion API origin", () => {
    expect(check({ origin: CF_ORIGIN })).toEqual({ detail: "ok", trusted: true });
    expect(check({ origin: `${CF_ORIGIN}/api/v1/mcp/server/image_search` })).toMatchObject({
      trusted: true,
    });
  });

  it("accepts any plugin id at the correct origin", () => {
    for (const pluginId of [
      "official-tools@cf-plugins-local",
      "dev-official-mcp@inline",
      "evil@third-party",
      "cf-tools",
    ]) {
      expect(check({ origin: CF_ORIGIN, pluginId })).toEqual({ detail: "ok", trusted: true });
    }
  });

  it("still rejects those same plugins at a wrong origin", () => {
    for (const pluginId of ["evil@third-party", "official-tools@cf-plugins-local"]) {
      expect(check({ origin: "https://attacker.example", pluginId })).toEqual({
        detail: "origin_mismatch",
        trusted: false,
      });
    }
  });

  it("rejects any origin other than the resolved CodeFusion API origin", () => {
    for (const origin of [
      "https://attacker.example",
      "https://cf.z.ai.attacker.example",
      "https://evil-cf.z.ai",
      `${CF_ORIGIN}:8443`,
    ]) {
      expect(check({ origin })).toEqual({ detail: "origin_mismatch", trusted: false });
    }
  });

  it("rejects http even when the host matches", () => {
    expect(check({ origin: "http://cf.z.ai" })).toMatchObject({ trusted: false });
  });

  it("rejects credential-bearing URLs on either side", () => {
    expect(check({ origin: `https://user:pass@cf.z.ai` })).toMatchObject({ trusted: false });
    expect(
      check({ origin: CF_ORIGIN, cfApiOrigin: "https://user:pass@cf.z.ai" }),
    ).toMatchObject({ trusted: false });
  });

  it("fails closed when the CodeFusion API origin cannot be resolved", () => {
    expect(check({ origin: CF_ORIGIN, cfApiOrigin: undefined })).toEqual({
      detail: "cf_origin_unresolved",
      trusted: false,
    });
    expect(check({ origin: CF_ORIGIN, cfApiOrigin: "not-a-url" })).toEqual({
      detail: "cf_origin_unresolved",
      trusted: false,
    });
  });

  it("rejects malformed input without throwing", () => {
    expect(check({ origin: "" })).toEqual({ detail: "invalid_input", trusted: false });
    expect(check({ origin: "not-a-url" })).toMatchObject({ trusted: false });
    expect(check({ origin: CF_ORIGIN, pluginId: "" })).toMatchObject({ trusted: true });
  });

  describe("dev loopback switch", () => {
    it("accepts a loopback origin listed in the switch", () => {
      expect(
        check({ devTrustedOriginsRaw: "http://127.0.0.1:3999", origin: "http://127.0.0.1:3999" }),
      ).toEqual({ detail: "ok", trusted: true });
    });

    it("only opens loopback, never a remote origin", () => {
      for (const entry of ["https://attacker.example", "http://evil.example"]) {
        expect(check({ devTrustedOriginsRaw: entry, origin: entry })).toMatchObject({
          trusted: false,
        });
      }
    });

    it("supports several comma-separated entries and ignores blanks", () => {
      const raw = " http://127.0.0.1:3999 , ,http://localhost:4010 ";
      expect(check({ devTrustedOriginsRaw: raw, origin: "http://localhost:4010" })).toMatchObject({
        trusted: true,
      });
      expect(check({ devTrustedOriginsRaw: raw, origin: "http://127.0.0.1:5000" })).toMatchObject({
        trusted: false,
      });
    });

    it("does not require an official plugin for loopback self-testing", () => {
      expect(
        check({
          devTrustedOriginsRaw: "http://127.0.0.1:3999",
          origin: "http://127.0.0.1:3999",
          pluginId: "dev-official-mcp@inline",
        }),
      ).toMatchObject({ trusted: true });
    });

    it("changes nothing when the switch is absent", () => {
      expect(check({ origin: "http://127.0.0.1:3999" })).toMatchObject({ trusted: false });
    });

    it("still rejects a loopback origin that is not listed", () => {
      expect(
        check({ devTrustedOriginsRaw: "http://127.0.0.1:3999", origin: "http://127.0.0.1:9999" }),
      ).toMatchObject({ trusted: false });
    });
  });
});

describe("createOfficialMcpTrustedOriginRegistry", () => {
  it("resolves the CodeFusion API origin per call, so environment switches are picked up", async () => {
    let origin = CF_ORIGIN;
    const registry = createOfficialMcpTrustedOriginRegistry({
      resolveCfApiOrigin: () => origin,
    });
    await expect(
      registry.isTrusted({
        mcpKey: "image-search",
        origin: CF_ORIGIN,
        pluginId: OFFICIAL_PLUGIN,
      }),
    ).resolves.toMatchObject({ trusted: true });

    origin = "https://cf-test.z.ai";
    await expect(
      registry.isTrusted({
        mcpKey: "image-search",
        origin: CF_ORIGIN,
        pluginId: OFFICIAL_PLUGIN,
      }),
    ).resolves.toMatchObject({ trusted: false });
    await expect(
      registry.isTrusted({
        mcpKey: "image-search",
        origin: "https://cf-test.z.ai",
        pluginId: OFFICIAL_PLUGIN,
      }),
    ).resolves.toMatchObject({ trusted: true });
  });

  it("fails closed when the origin resolver throws", async () => {
    const registry = createOfficialMcpTrustedOriginRegistry({
      resolveCfApiOrigin: () => {
        throw new Error("settings unavailable");
      },
    });
    await expect(
      registry.isTrusted({
        mcpKey: "image-search",
        origin: CF_ORIGIN,
        pluginId: OFFICIAL_PLUGIN,
      }),
    ).resolves.toEqual({ detail: "cf_origin_unresolved", trusted: false });
  });

  it("awaits an async origin resolver", async () => {
    const registry = createOfficialMcpTrustedOriginRegistry({
      resolveCfApiOrigin: async () => CF_ORIGIN,
    });
    await expect(
      registry.isTrusted({
        mcpKey: "image-search",
        origin: CF_ORIGIN,
        pluginId: OFFICIAL_PLUGIN,
      }),
    ).resolves.toMatchObject({ trusted: true });
  });

  it("ignores mcpKey entirely (no per-key allowlist any more)", async () => {
    const registry = createOfficialMcpTrustedOriginRegistry({
      resolveCfApiOrigin: () => CF_ORIGIN,
    });
    for (const mcpKey of ["image-search", "brand-new-mcp", ""]) {
      await expect(
        registry.isTrusted({ mcpKey, origin: CF_ORIGIN, pluginId: OFFICIAL_PLUGIN }),
      ).resolves.toMatchObject({ trusted: true });
    }
  });
});
