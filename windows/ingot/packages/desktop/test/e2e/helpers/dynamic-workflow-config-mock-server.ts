import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { CF_DYNAMIC_WORKFLOW_MODE_ENV, type DynamicWorkflowMode } from "@origin-ai/cf-shared";

const DISABLED_SPEC_FRAGMENT = "conversation-session-dynamic-workflow-gray-disabled";
const ALWAYS_ON_SPEC_FRAGMENT = "conversation-session-dynamic-workflow-gray-always-on";

export type DynamicWorkflowConfigMockScenario = Extract<
  DynamicWorkflowMode,
  "disabled" | "alwaysOn"
>;

export interface DynamicWorkflowConfigMockServer {
  baseUrl: string;
  scenario: DynamicWorkflowConfigMockScenario;
  stop(): Promise<void>;
}

export const DYNAMIC_WORKFLOW_CONFIG_MOCK_STATUS_PATH = "/__dwg/status";

export interface DynamicWorkflowConfigMockStatus {
  scenario: DynamicWorkflowConfigMockScenario;
  
  mode: DynamicWorkflowMode | null;
  configRequests: number;
}

export function resolveDynamicWorkflowConfigMockScenario(
  specs: readonly string[],
): DynamicWorkflowConfigMockScenario | null {
  const disabled = specs.some((spec) => spec.includes(DISABLED_SPEC_FRAGMENT));
  const alwaysOn = specs.some(
    (spec) =>
      spec.includes(ALWAYS_ON_SPEC_FRAGMENT) ||
      spec.replaceAll("\\", "/").split("/").at(-1) === "automations-workflows-hub.test.ts",
  );
  if (disabled && alwaysOn) {
    throw new Error(
      "Dynamic workflow gray E2E: disabled 与 alwaysOn spec 必须分属不同 worker，不能共享一个 mock 网关",
    );
  }
  if (disabled) return "disabled";
  if (alwaysOn) return "alwaysOn";
  return null;
}

export function applyDynamicWorkflowConfigMockEnv(
  environment: Record<string, string | undefined>,
  baseUrl: string,
): void {
  environment.CF_BASE_URL = baseUrl;
  environment.CF_TEST_BASE_URL = baseUrl;
  environment.CF_ENDPOINT_ORIGIN = baseUrl;
  delete environment[CF_DYNAMIC_WORKFLOW_MODE_ENV];
}

export function clearDynamicWorkflowConfigMockEnv(
  environment: Record<string, string | undefined>,
  baseUrl: string,
): void {
  for (const key of ["CF_BASE_URL", "CF_TEST_BASE_URL", "CF_ENDPOINT_ORIGIN"] as const) {
    if (environment[key] === baseUrl) {
      delete environment[key];
    }
  }
}

export async function startDynamicWorkflowConfigMockServer(
  scenario: DynamicWorkflowConfigMockScenario,
): Promise<DynamicWorkflowConfigMockServer> {
  const clientConfigFixtureUrl = new URL(
    "../fixtures/coding-plan-client-configs.json",
    import.meta.url,
  );
  const clientConfigPayload = JSON.parse(
    await readFile(clientConfigFixtureUrl, "utf8"),
  ) as DynamicWorkflowClientConfigFixture;
  if (scenario === "alwaysOn") {
    clientConfigPayload.data.configs.dynamicWorkflow = { mode: "alwaysOn" };
  } else {
    delete clientConfigPayload.data.configs.dynamicWorkflow;
  }
  const mode = clientConfigPayload.data.configs.dynamicWorkflow?.mode ?? null;

  let configRequests = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === DYNAMIC_WORKFLOW_CONFIG_MOCK_STATUS_PATH) {
      sendJson(response, {
        configRequests,
        mode,
        scenario,
      } satisfies DynamicWorkflowConfigMockStatus);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/v1/client/configs") {
      configRequests += 1;
      sendJson(response, clientConfigPayload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/cf-plan/billing/balance") {
      sendJson(response, {
        code: 0,
        data: { balances: [], plans: [] },
        msg: "",
        success: true,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v2/releases/latest") {
      sendJson(response, {
        config_version: "0.0.13",
        version: "0.25.1",
      });
      return;
    }

    sendJson(
      response,
      {
        code: 404,
        data: null,
        msg: `Unhandled dynamic workflow gray E2E path: ${request.method} ${url.pathname}`,
      },
      404,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Dynamic workflow gray E2E mock server did not bind to a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    scenario,
    stop: async () => {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}

interface DynamicWorkflowClientConfigFixture {
  data: {
    configs: Record<string, unknown> & {
      dynamicWorkflow?: {
        mode: DynamicWorkflowMode;
      };
    };
  };
}

function sendJson(response: ServerResponse, payload: unknown, statusCode = 200): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}
