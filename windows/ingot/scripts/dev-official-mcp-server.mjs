#!/usr/bin/env node

import { createServer } from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    port: { default: "3999", short: "p", type: "string" },
    "mcp-path": { default: "/api/v1/mcp/server/image_search", type: "string" },
    mode: { default: "ok", type: "string" },
    "fail-on": { default: "all", type: "string" },
    "delay-ms": { default: "0", type: "string" },
  },
});
const port = Number(values.port);
const control = {
  delayMs: Number(values["delay-ms"]),
  failOn: String(values["fail-on"]),
  mode: String(values.mode),
};
const MCP_PATH = String(values["mcp-path"]).replace(/\/+$/, "") || "/";

const VALID_MODES = new Set(["ok", "401", "403", "redirect", "tool-quota", "tool-plan-required"]);
const VALID_FAIL_ON = new Set(["all", "initialize", "tools/call"]);
if (!VALID_MODES.has(control.mode) || !VALID_FAIL_ON.has(control.failOn)) {
  console.error(
    `无效参Count：mode=${control.mode} fail-on=${control.failOn}\n` +
      `mode ∈ {${[...VALID_MODES].join(", ")}}，fail-on ∈ {${[...VALID_FAIL_ON].join(", ")}}`,
  );
  process.exit(1);
}

const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const TOOL_NAME = "dev_echo_identity";
const PLUGIN_NAME = "dev-official-mcp";
const MCP_KEY = "dev-search";
const QUALIFIED_TOOL_NAME = `mcp__plugin_${PLUGIN_NAME}_${MCP_KEY}__${TOOL_NAME}`;

const IN_BAND_TOOL_FAILURES = {
  "tool-quota": {
    error_code: "quota_exceeded",
    message: "daily quota exceeded for bucket search_image (5/5), retry tomorrow or upgrade your coding plan",
  },
  "tool-plan-required": {
    error_code: "coding_plan_required",
    message: "a coding plan is required to use MCP tools, please purchase or configure a coding plan and retry",
  },
};

const IDENTITY_HEADERS = [
  "authorization",
  "x-bigmodel-authorization",
  "bigmodel-target-type",
  "bigmodel-organization",
  "bigmodel-project",
  "x-coding-plan-api-key",
];

const SECRET_HEADERS = new Set([
  "authorization",
  "x-coding-plan-api-key",
  "x-bigmodel-authorization",
]);

function formatHeader(name, value) {
  if (typeof value !== "string" || value.length === 0) return "(empty)";
  if (!SECRET_HEADERS.has(name)) return value;
  const prefix = value.startsWith("Bearer ") ? "Bearer " : "";
  const bare = prefix ? value.slice(prefix.length) : value;
  if (bare.length <= 8) return `${prefix}<len=${bare.length}>`;
  return `${prefix}${bare.slice(0, 4)}…${bare.slice(-4)} <len=${bare.length}>`;
}

const state = {
  identityHeadersSeen: false,
  initialize: false,
  initialized: false,
  negotiatedVersion: undefined,
  sessionId: undefined,
  toolCallFail: 0,
  toolCallOk: 0,
  toolsListed: 0,
};

function statusLine() {
  const mark = (ok) => (ok ? "✓" : "✗");
  return (
    `   ★ initialize ${mark(state.initialize)} | initialized ${mark(state.initialized)} | ` +
    `tools/list ${state.toolsListed > 0 ? `✓(${state.toolsListed})` : "✗"} | ` +
    `tools/call ok=${state.toolCallOk} fail=${state.toolCallFail} | ` +
    `身份头 ${mark(state.identityHeadersSeen)}`
  );
}

function shouldFail(rpcMethod, httpMethod) {
  if (control.mode === "ok" || IN_BAND_TOOL_FAILURES[control.mode]) return false;
  if (httpMethod === "GET") return false;
  if (control.failOn === "all") return true;
  return control.failOn === rpcMethod;
}

let requestCount = 0;

function sendJsonRpc(response, id, payload, extraHeaders = {}) {
  response.writeHead(200, { "content-type": "application/json", ...extraHeaders });
  response.end(JSON.stringify({ id: id ?? null, jsonrpc: "2.0", ...payload }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", async () => {
    requestCount += 1;
    const raw = Buffer.concat(chunks).toString("utf8");
    let message = {};
    let parseError;
    try {
      message = raw ? JSON.parse(raw) : {};
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
    const rpcMethod = parseError ? "(unparsable body)" : message.method;

    const present = IDENTITY_HEADERS.filter((name) => request.headers[name] !== undefined);
    const missing = IDENTITY_HEADERS.filter(
      (name) => request.headers[name] === undefined && name !== "x-coding-plan-api-key",
    );
    if (present.includes("authorization") && present.includes("x-bigmodel-authorization")) {
      state.identityHeadersSeen = true;
    }

    console.log(
      `\n[#${requestCount}] ${request.method} ${request.url}` +
        (rpcMethod ? `  rpc=${rpcMethod}` : "") +
        (rpcMethod === "tools/call" ? `  tool=${message.params?.name ?? "(未指定)"}` : ""),
    );
    for (const name of present) {
      console.log(`   ✓ ${name}: ${formatHeader(name, String(request.headers[name]))}`);
    }
    for (const name of missing) {
      console.log(`   ✗ ${name}: (absent)`);
    }
    console.log(
      `   · x-request-id: ${request.headers["x-request-id"] ?? "(none)"}` +
        `  x-trace-id: ${request.headers["x-trace-id"] ?? "(none)"}`,
    );

    const seenSessionId = request.headers["mcp-session-id"];
    console.log(
      `   · mcp-session-id: ${seenSessionId ?? "(none)"}` +
        (rpcMethod === "initialize"
          ? "  ← initialize 不带Yes正常的（此时Service端还没下发）"
          :
          state.sessionId && !seenSessionId && request.method !== "GET"
          ? "  ⚠ Service端已下发但Customer端未回传"
          : ""),
    );

    const requestPath = (request.url ?? "/").split("?")[0];
    if (requestPath === `${MCP_PATH}/`) {
      console.log(`   ✗ 路径多了尾斜杠 → 回 307（gin 同行为）。Customer端 redirect:"manual"，`);
      console.log(`     会判成 official_auth_redirect_blocked。正确路径：${MCP_PATH}`);
      console.log(statusLine());
      response.writeHead(307, { location: MCP_PATH }).end();
      return;
    }
    if (requestPath !== MCP_PATH) {
      console.log(`   ✗ 路径不匹配 → 回 404。期望：${MCP_PATH}`);
      console.log("     线上同理：漏掉 :mcp_group 段（只写 /api/v1/mcp/server/）也Yes 404。");
      console.log(statusLine());
      response.writeHead(404, { "content-type": "text/plain" }).end("404 page not found");
      return;
    }

    if (request.method === "GET") {
      console.log("   → 回 405（第OnePhase不EnableService端推流，spec §6.3.4）");
      console.log("     线上因 gin 只注册 POST，GET 实际Yes 404；对 SDK 行为等价。");
      console.log(statusLine());
      response.writeHead(405).end();
      return;
    }

    if (parseError) {
      console.log(`   ✗ Request体解析Failed：${parseError}`);
      console.log(statusLine());
      sendJsonRpc(response, null, {
        error: { code: -32700, message: `Parse error: ${parseError}` },
      });
      return;
    }

    if (shouldFail(rpcMethod, request.method)) {
      if (control.mode === "redirect") {
        console.log("   ✗ 注入 302 → 期望Customer端不Follow，分类 official_auth_redirect_blocked");
        console.log(statusLine());
        response.writeHead(302, { location: "https://attacker.example/mcp" }).end();
        return;
      }
      const status = Number(control.mode);
      console.log(
        `   ✗ 注入 ${status} → 期望分类 ${
          status === 401
            ? "official_auth_rejected（至多RetryOne次，本Terminal应恰OK出现两条注入Logs）"
            : "official_auth_forbidden（不Retry）"
        }`,
      );
      if (rpcMethod === "tools/call") state.toolCallFail += 1;
      console.log(statusLine());
      response.writeHead(status).end();
      return;
    }

    if (rpcMethod === "notifications/initialized") {
      state.initialized = true;
      console.log("   → 回 202 Accepted（握手Completed；这也Yes SDK 尝试开 GET 推流的触发点）");
      console.log(statusLine());
      response.writeHead(202).end();
      return;
    }

    if (rpcMethod === "initialize") {
      const requested = message.params?.protocolVersion;
      const negotiated =
        typeof requested === "string" && requested ? requested : DEFAULT_PROTOCOL_VERSION;
      state.initialize = true;
      state.negotiatedVersion = negotiated;
      state.sessionId = `dev-session-${Date.now().toString(36)}`;
      const clientInfo = message.params?.clientInfo;
      console.log(
        `   → ProtocolVersion协商：client=${requested ?? "(未声明)"} server=${negotiated}` +
          (requested && requested !== negotiated ? "  ⚠ 已降级" : "  ✓"),
      );
      if (clientInfo) {
        console.log(`   → Customer端：${clientInfo.name ?? "?"} ${clientInfo.version ?? ""}`.trimEnd());
      }
      console.log(`   → 下发 mcp-session-id: ${state.sessionId}`);
      console.log(statusLine());
      sendJsonRpc(
        response,
        message.id,
        {
          result: {
            capabilities: { tools: { listChanged: false } },
            protocolVersion: negotiated,
            serverInfo: { name: "dev-official-mcp", version: "0.0.1" },
          },
        },
        { "mcp-session-id": state.sessionId },
      );
      return;
    }

    if (rpcMethod === "tools/list") {
      const tools = [
        {
          description: "Local自测用：回显Service端实际收到的Official MCP 身份头Name（不回显凭证inner容）",
          inputSchema: {
            additionalProperties: false,
            properties: {
              note: { description: "Optional备注，会原样回显", type: "string" },
            },
            type: "object",
          },
          name: TOOL_NAME,
        },
      ];
      state.toolsListed = tools.length;
      console.log(`   → Back ${tools.length} 个Tools：${tools.map((tool) => tool.name).join(", ")}`);
      console.log(`   → Model侧Complete名：${QUALIFIED_TOOL_NAME}`);
      console.log(statusLine());
      sendJsonRpc(response, message.id, { result: { tools } });
      return;
    }

    if (rpcMethod === "tools/call") {
      const requestedTool = message.params?.name;
      const args = message.params?.arguments ?? {};
      console.log(`   → 入参：${JSON.stringify(args)}`);

      if (control.delayMs > 0) {
        console.log(`   ⏳ 人为延迟 ${control.delayMs}ms（--delay-ms）…`);
        await sleep(control.delayMs);
        if (response.writableEnded || response.destroyed) {
          console.log(`   ✗ 延迟结束时Customer端已Disconnect → 这就YesCustomer端超时的现场`);
          console.log(statusLine());
          return;
        }
      }

      if (requestedTool !== TOOL_NAME) {
        state.toolCallFail += 1;
        console.log(`   ✗ UnknownTools：${requestedTool ?? "(未指定)"} → isError`);
        console.log(statusLine());
        sendJsonRpc(response, message.id, {
          result: {
            content: [{ text: `unknown tool: ${String(requestedTool)}`, type: "text" }],
            isError: true,
          },
        });
        return;
      }

      const inBandFailure = IN_BAND_TOOL_FAILURES[control.mode];
      if (inBandFailure) {
        state.toolCallFail += 1;
        console.log(
          `   ✗ 注入业务级Failed error_code=${inBandFailure.error_code} → isError（Connect保持 connected）`,
        );
        console.log(statusLine());
        const text = JSON.stringify({
          ...inBandFailure,
          request_id: `dev-${state.toolCallFail}`,
        });
        sendJsonRpc(response, message.id, {
          result: { content: [{ text, type: "text" }], isError: true },
        });
        return;
      }

      state.toolCallOk += 1;
      const summary = {
        identityHeaders: present,
        negotiatedProtocolVersion: state.negotiatedVersion ?? null,
        note: typeof args.note === "string" ? args.note : null,
        sessionId: seenSessionId ?? null,
        targetType: request.headers["bigmodel-target-type"] ?? null,
        teamIdentityPaired: Boolean(
          request.headers["bigmodel-organization"] && request.headers["bigmodel-project"],
        ),
      };
      console.log(`   ✓ 调用成功，回显身份头：${present.join(", ") || "(无)"}`);
      console.log(statusLine());
      sendJsonRpc(response, message.id, {
        result: {
          content: [{ text: JSON.stringify(summary, null, 2), type: "text" }],
          structuredContent: summary,
        },
      });
      return;
    }

    console.log(`   ✗ 未Implementation的方法：${rpcMethod ?? "(无)"} → JSON-RPC -32601`);
    console.log(statusLine());
    sendJsonRpc(response, message.id, {
      error: { code: -32601, message: `Method not found: ${String(rpcMethod)}` },
    });
  });
});

process.on("SIGINT", () => {
  console.log("\n\n=== 本次SessionOverview ===");
  console.log(statusLine().replace("   ★ ", ""));
  console.log(`总RequestCount：${requestCount}`);
  if (!state.identityHeadersSeen) {
    console.log("⚠ 从未收到Complete身份头——Customer端可能在发Request前就被拒（查 officialAuthKind）");
  }
  server.close(() => process.exit(0));
});

server.listen(port, "127.0.0.1", () => {
  const origin = `http://127.0.0.1:${port}`;
  const marketplace = "dev-official-marketplace";
  const pluginId = `${PLUGIN_NAME}@${marketplace}`;
  const marketRoot = `${process.env.HOME ?? "~"}/.cf-dev-plugins/${marketplace}`;

  console.log(`fake Official MCP 已监听 ${origin}${MCP_PATH}`);
  console.log("  （路径与线上 POST /api/v1/mcp/server/:mcp_group 同形；Other路径回 404）");
  console.log(`故障注入：mode=${control.mode} fail-on=${control.failOn}`);
  console.log(`期望的 pluginId：${pluginId}`);
  console.log(`Model侧Tools全名：${QUALIFIED_TOOL_NAME}\n`);
  console.log("=== 四步 ===\n");
  console.log("1) 建Local marketplace（含One个Plugins）：");
  console.log(`
mkdir -p ${marketRoot}/.claude-plugin ${marketRoot}/${PLUGIN_NAME}/.cf-plugin
cat > ${marketRoot}/.claude-plugin/marketplace.json <<'JSON'
{
  "name": "${marketplace}",
  "plugins": [{ "name": "${PLUGIN_NAME}", "source": "./${PLUGIN_NAME}" }]
}
JSON
cat > ${marketRoot}/${PLUGIN_NAME}/.cf-plugin/plugin.json <<'JSON'
{ "name": "${PLUGIN_NAME}", "version": "0.0.1" }
JSON
cat > ${marketRoot}/${PLUGIN_NAME}/.mcp.json <<'JSON'
{
  "mcpServers": {
    "${MCP_KEY}": {
      "type": "http",
      "url": "${origin}${MCP_PATH}",
      "auth": { "type": "cf_official", "provider": "jwt_token" }
    }
  }
}
JSON
`);
  console.log("2) 在Settings页「Add marketplace」里填这个Table of Contents（注意Yes marketplace 根Table of Contents，");
  console.log(`   不YesPluginsTable of Contents）：${marketRoot}`);
  console.log("   然后在Pluginslist里找到 " + PLUGIN_NAME + " 并「Install」。");
  console.log("   若之前用 plugins.dirs 挂过同名Plugins，先从 ~/.cf/cli/config.json 的");
  console.log("   plugins.dirs 里移除，避免两个Source的同名Plugins互E干扰。\n");
  console.log("3) Install后**Enable**它——marketplace Install的PluginsDefault不Enable，Disabled时其 MCP 不会被解析：");
  console.log("   Settings页直接打开开关即可；or写Configuration：");
  console.log(`
node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const f=path.join(os.homedir(),".cf/cli/config.json");
const c=JSON.parse(fs.readFileSync(f,"utf8"));
c.plugins=c.plugins||{};
c.plugins.enabled=true;
c.plugins.enabledPlugins={...(c.plugins.enabledPlugins||{}),"${pluginId}":true};
c.plugins.dirs=(c.plugins.dirs||[]).filter((d)=>!d.includes("${PLUGIN_NAME}"));
fs.writeFileSync(f,JSON.stringify(c,null,2));
console.log("enabledPlugins.${pluginId} = true");
console.log("plugins.dirs =",c.plugins.dirs);
'
`);
  console.log("4) 带 dev 开关Start desktop（Value为逗Number分隔的 loopback origin）：");
  console.log(`
export CF_OFFICIAL_MCP_DEV_TRUSTED_ORIGINS='${origin}'
pnpm dev:desktop
`);
  console.log("   该开关只接受 http loopback，无法把凭证导向远端；不Settings时One切 fail closed。");
  console.log(
    "   Formal规则Yes「Official marketplace 的 plugin + origin 等于Current CodeFusion API origin」。\n" +
      `   Local marketplace 叫 ${marketplace}（非Official），且 origin Yes loopback，\n` +
      "   因此自测必须依赖该开关。\n",
  );
  console.log("Start后让Model调用该Tools，本Terminal会打印每One步的ProtocolStatus与身份头。");
  console.log("Ctrl-C Exit时会打印本次SessionOverview。\n");
});
