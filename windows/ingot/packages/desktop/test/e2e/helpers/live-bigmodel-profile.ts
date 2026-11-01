import { readFile } from "node:fs/promises";
import { platform, userInfo } from "node:os";
import { resolve } from "node:path";
import { createCredentialService, setDataBaseDir } from "@origin-ai/cf-services/node";
import { createCredentialCipherProvider } from "../../../../services/src/credential/providers/credentialCipherProvider.js";
import { getE2EAppDataPaths } from "#e2e/helpers/desktop-app";

const IMPORT_KEYS = [
  "oauth:bigmodel:access_token",
  "oauth:bigmodel:refresh_token",
  "oauth:bigmodel:user_info",
  "oauth:active_provider",
  "cfjwttoken",
];

export async function importLiveBigModelCredentials(caseMarker: string): Promise<{
  imported: string[];
  refreshTokenPresent: boolean;
  teamKeyPresent: boolean;
  teamSelection: {
    kind: "team-coding-plan";
    productId: string;
    organizationId: string;
    projectId: string;
  };
}> {
  const sourceHome = process.env.R3_LIVE_SOURCE_HOME?.trim();
  if (!sourceHome) throw new Error(`${caseMarker}: 需Settings R3_LIVE_SOURCE_HOME（Local machine真实 HOME）`);
  const username = userInfo().username;
  const sourceCipher = createCredentialCipherProvider({
    env: {
      CF_CREDENTIAL_SECRET: `cf-credential-fallback:${platform()}:${sourceHome}:${username}`,
    },
  });
  const original = JSON.parse(
    await readFile(resolve(sourceHome, ".cf", "v2", "credentials.json"), "utf8"),
  ) as Record<string, string>;
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(original)) {
    if (
      IMPORT_KEYS.includes(key) ||
      (key.startsWith("account-provider:coding-plan:account:bigmodel-team-coding-plan:") &&
        key.endsWith(":api-key"))
    ) {
      values.set(key, sourceCipher.decrypt(value));
    }
  }
  if (!values.has("oauth:bigmodel:access_token")) {
    throw new Error(`${caseMarker}: Local machine没有 BigModel 登录材料`);
  }
  if (!values.has("oauth:bigmodel:refresh_token")) {
    console.warn(
      `[${caseMarker}] Local machine凭据Missing oauth:bigmodel:refresh_token——若 UI 停在登录Onboarding页，需在Local machine app Log In Again BigModel Refresh材料`,
    );
  }
  const paths = getE2EAppDataPaths();
  setDataBaseDir(paths.homeDir);
  const targetCipher = createCredentialCipherProvider({
    env: {
      CF_CREDENTIAL_SECRET: `cf-credential-fallback:${platform()}:${paths.homeDir}:${username}`,
    },
  });
  const service = createCredentialService({ cipherProvider: targetCipher });
  for (const [key, value] of values) await service.save(key, value);
  const written = JSON.parse(await readFile(paths.credentialsFile, "utf8")) as Record<
    string,
    string
  >;
  for (const key of values.keys()) {
    if (!(key in written)) throw new Error(`${caseMarker}: 凭据未WriteIsolated profile: ${key}`);
  }
  const sourceSettings = JSON.parse(
    await readFile(resolve(sourceHome, ".cf", "v2", "setting.json"), "utf8"),
  ) as Record<string, unknown>;
  const sourceSelection = (
    sourceSettings.providerFamilyConnectionSelections as Record<string, unknown> | undefined
  )?.bigmodel as
    | { kind?: string; productId?: string; organizationId?: string; projectId?: string }
    | undefined;
  if (
    sourceSelection?.kind !== "team-coding-plan" ||
    !sourceSelection.productId ||
    !sourceSelection.organizationId ||
    !sourceSelection.projectId
  ) {
    throw new Error(
      `${caseMarker}: Local machine setting.json 没有 bigmodel team-coding-plan Connect选择（productId/organizationId/projectId 齐全），无法构造合法窄Settings`,
    );
  }
  return {
    imported: [...values.keys()],
    refreshTokenPresent: values.has("oauth:bigmodel:refresh_token"),
    teamKeyPresent: [...values.keys()].some((key) => key.includes("bigmodel-team-coding-plan")),
    teamSelection: {
      kind: "team-coding-plan",
      productId: sourceSelection.productId,
      organizationId: sourceSelection.organizationId,
      projectId: sourceSelection.projectId,
    },
  };
}
