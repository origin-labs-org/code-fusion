import { cfProtocolMethods, cfRuntimeCapabilitiesSchema } from "@origin-ai/cf-shared";
import type { CfProtocolClient } from "./cfProtocolClient.js";

const checks = new WeakMap<object, Promise<void>>();

export function ensureIndependentPlanSupport(
  client: Pick<CfProtocolClient, "request">,
): Promise<void> {
  const cached = checks.get(client);
  if (cached) return cached;
  const check = client
    .request(cfProtocolMethods.runtimeCapabilities, {}, cfRuntimeCapabilitiesSchema)
    .then((result) => {
      if (result.independentPlanState !== true) throw new Error("proto.independentPlanUnsupported");
    })
    .catch((cause: unknown) => {
      checks.delete(client);
      throw new Error("proto.independentPlanUnsupported", { cause });
    });
  checks.set(client, check);
  return check;
}

const historyChecks = new WeakMap<object, Promise<boolean>>();

export function supportsHistoryFirst(
  client: Pick<CfProtocolClient, "request">,
): Promise<boolean> {
  const existing = historyChecks.get(client);
  if (existing) return existing;
  const check = client
    .request(cfProtocolMethods.runtimeCapabilities, {}, cfRuntimeCapabilitiesSchema)
    .then((result) => result.historyFirst === true)
    .catch(() => {
      historyChecks.delete(client);
      return false;
    });
  historyChecks.set(client, check);
  return check;
}
