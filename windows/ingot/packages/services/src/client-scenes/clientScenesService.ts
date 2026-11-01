import type { ApiClient } from "@origin-ai/cf-shared";
import { readApiJson } from "../providers/api/apiJson.js";
import { CF_CLIENT_SCENES_URL } from "../providers/api/apiEndpoints.js";
import type { ClientScenesResponse, IClientScenesService } from "./clientScenes.js";

export function createClientScenesService(dependencies: {
  apiClient: ApiClient;
}): IClientScenesService {
  return {
    list: () =>
      readApiJson<ClientScenesResponse>(dependencies.apiClient, CF_CLIENT_SCENES_URL, {
        method: "GET",
      }),
  };
}
