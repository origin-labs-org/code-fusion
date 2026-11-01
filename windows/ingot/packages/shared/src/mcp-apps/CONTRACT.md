# mcp-apps-protocol

纯 domain 模块，零 IO。持有 MCP Apps 的 CodeFusion 扩展常量、Tools `_meta` 归One化Result、`display.ui` 投影 schema 与沙箱契About类型。Pages ↔ 宿主的线Protocol（`ui/*` 方法、握手、Version协商、JSON-RPC、Error码）由Official `@modelcontextprotocol/ext-apps` 承担，本模块不再Copy方法名or schema。

类型与Tests之outer的Invariants：

- `resourceUri` Source按优先级：`_meta.ui.resourceUri` → 弃用扁平键 `_meta["ui/resourceUri"]`（规范 MUST Compatible）→ `openai/outputTemplate`；必须以 `ui://` 开头且不超过 2048 Characters，否则整个 `ui` 描述视为不存在，而不Yes部分接受。
- `visibility` 缺省等于 `["model", "app"]`；不含 `"model"` 的Tools不得进入 provider contracts；`readMcpToolVisibility(meta)` 独立于 resourceUri Read。
- agent 对每个 MCP server 的 `initialize` 必须宣告 `extensions["io.modelcontextprotocol/ui"].mimeTypes = ["text/html;profile=mcp-app"]`（`buildMcpAppsClientCapabilities`），否则按OfficialTemplate写的 server 只会注册Plain textTools。
- CodeFusion 扩展CapabilitiesOne律放 `hostCapabilities.experimental["cf/…"]`（widgetState、resourceSubscribe、surface、csp），Official SDK 的 zod 会剥掉Label准位之outer的Unknown键。
- CSP 缺省按规范块；`'unsafe-eval'` / `'wasm-unsafe-eval'` 只在资源 `_meta["cf/csp"]` 声明为 true 时放行，Unknown键与非布尔Value丢弃。
- 沙箱句柄的 `shellUrl` 由 `sandboxId` 派生（`cf-sandbox://shell-<id>/`）；`partition` 由 server 身份派生（`persist:plugin-sandbox-v1-<hash>`），同One server 的PagesShared持久Storage，卡片Close不清；`sandboxId` 只含 `[A-Za-z0-9-]`（CSP host-source Characters集）。
- 宿主 renderer ↔ relay shell 只有One条 MessageChannel（`PLUGIN_SANDBOX_PORT_NAME`），上面RunRaw JSON-RPC；shell 不解析Protocol。
- `widgetState` Yes CodeFusion 扩展：初Value经 hostContext 的 `cf/widgetState` 键随握手下发，Pages经 `ui/set-widget-state { widgetState }` 交To宿主 renderer inner存Save（不Persistence、无可见性参Count；Model可见Letter息One律走 `ui/update-model-context`）。
- `_meta.ui.surface` 与清单 surface id 共用Characters集 `^[A-Za-z0-9][A-Za-z0-9_.-]*$`、≤ 128 Characters，非法即丢弃。
- Pages发From的 `resources/read` Boundaries常量在这里：`MCP_APPS_UI_READ_RESOURCE_MAX_BYTES`（8 MiB）与 `MCP_APPS_UI_READ_RESOURCE_MIME_ALLOWLIST`（以 `/` 结尾为Prefix匹配，Ignore参Count与大小写）；execute方Yes agent 的 mcp-ui。
- 常见Documentation、Image、音Video、ArchiveandFont按明确 MIME 条目接纳，不New增大类Prefix；Unknown MIME 与缺失 MIME 的 blob 仍Deny。范围与回归要求见 [资源 MIME spec](../../../../docs/mcp-apps-resource-mime-spec.md)。

Gen UI 复用沙箱登记载荷，显式 `contentKind: "gen-ui"`，pluginId/serverName 留空且不AllowPermissions声明；普通 MCP App 仍必须提供原来的Plugins与 server 归属。Gen UI 的Pages业务 schema 独立位于 `@origin-ai/cf-shared/gen-ui`。
