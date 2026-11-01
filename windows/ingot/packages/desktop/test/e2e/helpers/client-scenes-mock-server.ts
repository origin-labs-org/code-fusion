import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { ClientScenesResponse } from "@origin-ai/cf-services";

export const CLIENT_SCENES_AUTOMATIONS_HOME_SPEC = "off-peak-automations-home-layout.test.ts";

export const AUTOMATIONS_HOME_CLIENT_SCENES_FIXTURE = {
  code: 0,
  msg: "",
  data: [
    {
      namespace: "cf",
      scene: "off-peak-task",
      options: {
        prompts: {
          id: "off-peak-automations-home-prompts",
          type: "prompts",
          contents: { cn: "闲时任务模板", en: "Idle-time task template" },
          items: [
            {
              id: "item-standupGitSummary",
              type: "prompts",
              contents: {
                cn: "汇总当前项目的 Git 变更并列出需要跟进的事项。",
                en: "Summarize the current project's Git changes and follow-ups.",
              },
              labels: { cn: "Git 变更摘要", en: "Git change summary" },
              img: "git-branch",
            },
            {
              id: "item-ciFlakyReport",
              type: "prompts",
              contents: {
                cn: "检查最近的 CI 失败并整理疑似不稳定测试。",
                en: "Inspect recent CI failures and list suspected flaky tests.",
              },
              labels: { cn: "CI 不稳定报告", en: "CI flaky report" },
              img: "activity",
            },
            {
              id: "item-documentationSyncCheck",
              type: "prompts",
              contents: {
                cn: "检查项目文档与当前实现是否保持同步。",
                en: "Check whether the project documentation matches the implementation.",
              },
              labels: { cn: "文档同步检查", en: "Documentation sync check" },
              img: "file-text",
            },
          ],
        },
      },
    },
    {
      namespace: "cf",
      scene: "scheduled-task",
      options: {
        prompts: {
          id: "scheduled-automations-home-prompts",
          type: "prompts",
          contents: { cn: "定时任务模板", en: "Scheduled task template" },
          items: [
            {
              id: "item-morningDevBrief",
              type: "prompts",
              contents: {
                cn: "Summarize today\'s code changes and follow-up items.",
                en: "Summarize today's code changes and follow-ups.",
              },
              labels: { cn: "晨会动态", en: "Morning dev brief" },
              defaults: { cronExpr: ["item-morningDevBrief-cron"] },
              img: "target",
            },
            {
              id: "item-noonRiskReview",
              type: "prompts",
              contents: {
                cn: "检查当前项目的风险与阻塞项。",
                en: "Review risks and blockers in the current project.",
              },
              labels: { cn: "午间风险检查", en: "Noon risk review" },
              defaults: { cronExpr: ["item-noonRiskReview-cron"] },
              img: "activity",
            },
            {
              id: "item-eveningReleaseNotes",
              type: "prompts",
              contents: {
                cn: "Draft today\'s release notes.",
                en: "Draft release notes for today's changes.",
              },
              labels: { cn: "晚间发布说明", en: "Evening release notes" },
              defaults: { cronExpr: ["item-eveningReleaseNotes-cron"] },
              img: "file-text",
            },
            {
              id: "item-weeklyProjectList",
              type: "prompts",
              contents: {
                cn: "Summarize this week\'s project progress and next week\'s plan.",
                en: "Summarize this week's project progress and next week's plan.",
              },
              labels: { cn: "每周项目清单", en: "Weekly project list" },
              defaults: { cronExpr: ["item-weeklyProjectList-cron"] },
              img: "list",
            },
          ],
        },
        cronExpr: {
          id: "scheduled-automations-home-cron",
          type: "cronExpr",
          contents: { cn: "调度规则", en: "Schedule" },
          items: [
            {
              id: "item-morningDevBrief-cron",
              type: "cronExpr",
              contents: { cn: "0 9 * * 1-5", en: "0 9 * * 1-5" },
              labels: { cn: "工作日早上", en: "Weekday morning" },
            },
            {
              id: "item-noonRiskReview-cron",
              type: "cronExpr",
              contents: { cn: "0 12 * * 1-5", en: "0 12 * * 1-5" },
              labels: { cn: "工作日中午", en: "Weekday noon" },
            },
            {
              id: "item-eveningReleaseNotes-cron",
              type: "cronExpr",
              contents: { cn: "0 18 * * 1-5", en: "0 18 * * 1-5" },
              labels: { cn: "工作日傍晚", en: "Weekday evening" },
            },
            {
              id: "item-weeklyProjectList-cron",
              type: "cronExpr",
              contents: { cn: "0 9 * * 1", en: "0 9 * * 1" },
              labels: { cn: "每周一", en: "Monday" },
            },
          ],
        },
      },
    },
  ],
} satisfies ClientScenesResponse;

export interface ClientScenesMockServer {
  baseUrl: string;
  stop(): Promise<void>;
}

export function applyClientScenesMockEnv(
  environment: Record<string, string | undefined>,
  baseUrl: string,
): void {
  environment.CF_BASE_URL = baseUrl;
  environment.CF_TEST_BASE_URL = baseUrl;
  environment.CF_ENDPOINT_ORIGIN = baseUrl;
}

export function clearClientScenesMockEnv(
  environment: Record<string, string | undefined>,
  baseUrl: string,
): void {
  for (const key of ["CF_BASE_URL", "CF_TEST_BASE_URL", "CF_ENDPOINT_ORIGIN"] as const) {
    if (environment[key] === baseUrl) {
      delete environment[key];
    }
  }
}

export function shouldUseClientScenesMock(specs: readonly string[]): boolean {
  return specs.some((spec) => spec.includes(CLIENT_SCENES_AUTOMATIONS_HOME_SPEC));
}

export async function startClientScenesMockServer(): Promise<ClientScenesMockServer> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/v1/client/scenes") {
      writeJson(response, AUTOMATIONS_HOME_CLIENT_SCENES_FIXTURE);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/client/configs") {
      writeJson(response, { code: 0, data: { configs: {} }, msg: "", success: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v2/releases/latest") {
      writeJson(response, { config_version: "e2e-client-scenes-v1", version: "0.0.0" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/cf-plan/billing/balance") {
      writeJson(response, { code: 0, data: { balances: [], plans: [] }, msg: "", success: true });
      return;
    }

    writeJson(
      response,
      {
        code: 404,
        data: null,
        msg: `Unhandled Client Scenes E2E path: ${request.method} ${url.pathname}`,
      },
      404,
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Client Scenes E2E mock server did not bind to a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

function writeJson(response: ServerResponse, payload: unknown, statusCode = 200): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}
