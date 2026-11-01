# aicoding-agent 扩展

IDE 与 Go/Cosy 后端之间的桥梁。配置命名空间统一使用 `aicoding`，禁止使用 `qoder`/`lingma`。

入口：`src/extension.ts` → `CosyUtils.checkUpdateAndStartAsync()` 启动 Go 进程并初始化 `LanguageClient`。

## 功能地图

| 功能领域 | 关键文件 | 说明 |
|---------|---------|------|
| **连接管理** | `lsp/connection/ConnectionManager.ts`、`IPCConnectionProvider.ts`、`WebSocketConnectionProvider.ts` | IPC 优先 → WebSocket 降级，指数退避（1s→30s）无限重连 |
| **远程连接** | `lsp/RemoteWebSocketClient.ts` | Remote SSH 场景仅 WebSocket，按 `taskId` 独立连接，2 分钟心跳 |
| **二进制管理** | `binary/BinaryManager.ts`、`utils/CosyUtils.ts`、`utils/processInspection.ts` | Go 二进制版本检查、进程身份与状态判定、启动、`.info.json` 发现 |
| **Chat 会话** | `agent/index.ts`（ChatIntegration）、`agent/acpIntegration.ts`、`agent/sessionRuntimeMetaStore.ts`、`agent/toolCallRuntimeContextStore.ts` | 会话创建/发送/历史（含多 workspace 历史查询），ACP 协议集成，并缓存 IDE 本地会话元数据（如 layoutMode）及 toolCallId 到 session 的短期上下文 |
| **Chat 消息流** | `wsHandler/Chat*.ts`（~14 个 Handler） | answer/think/finish/queue/filter/title 等流式消息处理 |
| **Quest 模式** | `wsHandler/QuestMode*.ts`、`wsHandler/MasterMode*.ts` | 任务进度、沙箱日志、容器状态同步 |
| **登录态** | `auth/AuthManager.ts`、`command/login/Login*.ts`、`wsHandler/Auth*.ts` | 双模式：Qoder（IDE 管理）/ Lingma（扩展→Go 管理），6 小时心跳；dev container 必须被识别为 remote，登录入口才能走 `REMOTE_WEB` |
| **补全转发** | `api/completion.ts`、`wsHandler/EditPredictMessageHandler.ts` | completion、NES 触发、editPredict 转发到 Go |
| **工具执行** | `wsHandler/ToolInvokeHandler.ts`、`wsHandler/ToolCallSyncHandler.ts`、`agent/tools/` | Go 请求的 terminal/file/search 等工具执行 |
| **文件系统** | `wsHandler/FS*.ts`、`wsHandler/FileEditHandler.ts`、`wsHandler/SnapshotSyncAllHandler.ts` | ACP 文件读写、快照同步、WorkingSpace 文件同步 |
| **SCM / Git** | `command/scm/source-control.ts`、`command/scm/apply-diffs.ts` | commit message 生成、diff 应用。通过 `vscode.aicoding` RPC 从 workbench 层 `GitBridgeService` 获取 git diff/log 等数据 |
| **浏览器自动化** | `browser/BrowserManager.ts`、`browser/tools/`、`browser/ChromiumDownloader.ts` | Puppeteer 连接 Chrome/下载 Chromium，snapshot/click/navigate 等工具 |
| **MCP 服务** | `mcp/McpServerManager.ts`、`mcp/McpProviderServer.ts`、`mcp/providers/BrowserMcpProvider.ts` | 本地 MCP Server（Unix Socket），通过服务端 header/context 透传会话元数据，暴露浏览器工具 |
| **IDE 消息桥接** | `messages/handler.ts`、`common/WebViewMessageTypes.ts` | `vscode.aicoding.onRequest` 注册 100+ 消息处理器，IDE ↔ 扩展全部消息路由 |
| **Profile / 设置** | `lsp/ProfileClient.ts`、`messages/settingsMessageHandler.ts` | Profile WebSocket、memories/codebase/rules/MCP/dataPolicy 设置管理 |
| **RepoWiki** | `wsHandler/WikiNotifyStatusHandler.ts`、`wsHandler/FixMermaidMessageHandler.ts` | Go 推送 wiki 状态和 Mermaid 修复结果，转发到 IDE |
| **网络诊断** | `wsHandler/NetworkRecoverHandler.ts`、`wsHandler/NetworkDiagnosis*.ts` | 网络恢复重连、诊断项和完成事件转发 |
| **模型管理** | `wsHandler/RefreshModelsHandler.ts`、`wsHandler/ModelClassesHandler.ts`、`wsHandler/ResolveModelConfigHandler.ts`、`wsHandler/GetCustomModelsHandler.ts`、`Global.ts` | Go 推送模型列表刷新；Go 反查 IDE 侧 BYOK 自定义模型列表与单模型运行时配置 |
| **Providers** | `provider/CosyCodeActionProvider.ts`、`CosyHoverProvider.ts`、`CosyIdeInlineChatProvider.ts` | Code Action、Hover、Inline Chat 参与者 |
| **埋点统计** | `command/stat/statUtils.ts`、`command/stat/StatEventType.ts` | 通过 `LanguageClient.sendStatistics()` 上报到 Go |
| **配置** | `common/Settings.ts`、`common/CosyConfig.ts`、`common/sessionLayoutMode.ts`、`config/EnvConfigService.ts` | `aicoding` 命名空间配置读取、会话布局模式解析、`env.json` 端点加载 |

## 目录结构

```
src/
├── extension.ts                   # 入口：命令注册、文档同步、MCP 启动
├── cosy/
│   ├── lsp/
│   │   ├── LanguageClient.ts            # LSP 客户端主类，100+ 方法
│   │   ├── RemoteWebSocketClient.ts     # Remote SSH WebSocket
│   │   ├── ProfileClient.ts             # Profile WebSocket
│   │   ├── connection/                  # 连接管理（IPC/WebSocket）
│   │   └── websocket/                   # JSON-RPC 消息读写
│   ├── agent/                     # ChatIntegration、ACP、工具执行
│   ├── auth/                      # AuthManager（双模式登录态）
│   ├── binary/                    # Go 二进制管理
│   ├── browser/                   # Puppeteer 浏览器自动化
│   ├── mcp/                       # MCP Server 生命周期
│   ├── messages/                  # IDE ↔ 扩展消息路由中心
│   ├── wsHandler/                 # Go → 扩展推送处理（50+ Handler）
│   ├── command/                   # 命令处理（login、scm、stat 等）
│   ├── provider/                  # VS Code Provider（CodeAction、Hover、InlineChat）
│   ├── api/                       # 对外 API（auth、completion、websocket）
│   ├── config/                    # EnvConfigService（env.json）
│   ├── openapi/                   # OpenAPI HTTP 客户端
│   ├── common/                    # 常量、类型、配置
│   ├── events/                    # EventBus
│   ├── notification/              # 通知工具
│   ├── ui/                        # 进度条等 UI 元素
│   ├── log/                       # CosyLogger（Winston）
│   ├── model/                     # 数据模型
│   └── utils/                     # 工具函数
```

## 通信架构

```
IDE (src/lingma/)                      Extension Host                        Go/Cosy
      │                                      │                                  │
      │── vscode.aicoding.sendRequest ──────→│                                  │
      │← sendDataToOwnIde / sendNotification─│                                  │
      │                                      │── Global.languageClient ────────→│
      │                                      │← wsHandler/* ───────────────────│
```

- **消息路由中心**：`messages/handler.ts` — 所有 IDE 来的消息在此注册处理
- **Go 推送路由**：`LanguageClient.ts` 中 `registerOnMessageHandler()` 注册各 wsHandler
- **陷阱**：`Global.languageClient` 未就绪时 IDE 请求静默失败，handler 中需空值检查
- **图片上传缓存必须与来源解耦**：`MSG_TYPE_UPLOAD_IMAGE` 处理拖拽、选择和粘贴图片时，不能直接把图片放到 `os.tmpdir()/basename`；来源本身位于临时目录时这会让 source/target 指向同一文件，粘贴图片也会在系统清理 tmp 后失去发送副本。所有入口必须写入品牌中性的 `aicoding-image-cache/<requestId>/<basename>` 独立路径，再把该路径作为 `selectedItem.extra.imageUrl` 返回。`extra.imageUrl` 只表示 Extension Host 缓存路径，上传通知里的 `extra.imgUrl` 才是远程 HTTPS 地址，二者不能混用。缓存路径位于实际处理请求的 Extension Host，因此 Browser 侧还要按同一个 `targetRemoteAuthority` 还原成本地或远端 URI。
- **请求 handler ready**：扩展入口在 `IDEMessageHandler` 与 `ChatIntegration` 构造完成后发送 `aiCodingHandlersReady`，只表示 `vscode.aicoding.onRequest(...)` 已经注册完。不要把这个通知放到 Go/MCP 等后续启动之后，否则 Extension Host 重启时 browser 侧请求会一直等待。
- **列表类请求不要把失败吞成空结果**：例如 `MSG_GET_SESSIONS_IN_FOLDERS` 依赖 Go/LSP `Global.languageClient`。如果 client 未创建或未连接，应抛出明确的 `LanguageClientNotReady` 让 browser 侧等待/重试；如果 Go/QTS/网络返回真实失败，也必须记录后继续抛错。只有后端明确成功返回空列表时，才能让 UI 展示没有数据；不要用空列表伪装失败，否则 Quest 侧栏会把历史任务加载失败误显示为没有 Quest。`chat/listAllSessions` 是历史兼容例外：Cosy 会把成功的零条结果序列化为 `null`，IDE 必须只将 `null` / `undefined` 规范化为 `[]`，其他非数组响应仍视为协议错误。
- **Editor workspace 历史查询必须显式携带 authority-safe owner 状态**：`LanguageClient.listAllSessions()` 始终发送请求级 `workspacePath`；workspace-file 场景传执行端可读的配置路径，无可用 owner 时传空字符串，让 Cosy 区分“新客户端显式无 owner”和旧客户端未传字段。本地只接受 `file`，Windows 盘符路径按 Workbench ACP wire 格式统一为小写盘符、正斜杠且去掉非 root 尾斜杠，WSL UNC 保持 `fsPath`；远端只接受带 authority 的 `vscode-remote`，folders 已恢复时要求所有 folder authority 精确一致，folders 尚为空时 workspace file 自身的 authority 可作为安全归属。宿主机 `workspace.json`、Untitled 与 Agents Window 内部 workspace 都不作为 owner 下发。响应在扩展侧统一按“owner 全版本 + 首 folder 的 legacy `<8`”再过滤，以兼容忽略新参数的旧 Cosy；调用方不得再做 folder-only 二次过滤。该路径只服务历史归属查询，不能修改 initialize workspace、cwd、索引、memory 或 hook 上下文。
- **Editor workspace session scope v8 是会话级能力，不是 client initialize 能力**：普通 Editor Agent / Ask / Experts 的 ACP `session/new` 与 `session/prompt` 通过 `_meta['ai-coding/workspace-session-scope-version']='8'` 声明；legacy `chat/ask` 使用顶层 `workspaceSessionScopeVersion`，Editor fork 使用顶层 snake_case `workspace_session_scope_version` 并在 owner 可读时带 `workspace_path`。普通 folder fork 也必须只带 marker，让 Cosy 从当前首 folder 推导 F/v8；Quest、Agents Window、Cloud Agent 和 Inline 不携带，避免共享 Cosy 进程把其它模式误升级。
- **Canvas 状态失败不能伪装成未发布**：`canvas/status` 必须把当前 `canvasHash` 与 `canvasKey` 一起透传给 Cosy，用于跨 Quest/独立编辑器入口恢复同一远端分享。连接或 RPC 失败要记录后继续抛错，不能返回 `{ isPublished: false }`，否则 Workbench 会把“状态暂不可用”错误投影成 Publish 按钮并覆盖用户认知。
- **Canvas 取消发布保留两阶段结果**：远端 Unpublish 失败必须返回 `success=false + errorMessage` 并保留本地 Published 状态；远端已成功但本地别名清理失败返回 `success=true + stateCleanupPending + errorMessage`。扩展只能透明透传，不能把服务端原因压成统一的“try again later”。
- **Go → Quest 同步 method 必须显式注册**：Go 端通过 request/broadcast 推 `task/status/sync`、`task/planProgress/content/sync`、`user/task/stats/sync`、`user/inprogress/task/sync` 等 method。每新增一个 method，都要在 `LanguageClient.registerOnMessageHandler()` 注册对应 `wsHandler`，再由 handler 用 `sendDataToOwnIde` 转成 `masterMode:*` 事件；只改 IDE 消费层会让 Go 端直接报 `Unhandled method`。
- **初始化必须携带窗口类型**：Go/Cosy 依赖 `initialize.ideWindowType` 区分普通 Editor 窗口和 Quest/Agents Window。扩展启动时 LSP `LanguageClient.onInitialize()` 会先于 Browser 侧 ACP 初始化并设置 `Global.initializeProtocol='lsp'`，因此窗口类型必须写入 `InitializeParamsWithConfig`；ACP `initialize` 也要透传同名字段，用于覆盖 ACP 先初始化的少数路径。取值固定为 `editor` / `quest`，来源为 `vscode.env.ideWindowType`。
- **用户配置不能阻断 LanguageClient ready gate**：`LanguageClient.onInitialize()` 会在 `LANGUAGE_SERVER_CONNECTED` 前调用 `CosyUtils.configIdeProps()`；这里抛出的任何异常都会让 Browser 侧 `whenLanguageClientReady()` 永久等不到 ready，最终表现为消息本地回显后发送卡住。AI 回复语言等兼容历史值的配置应在消费边界统一规范化；未知值记录 warning 并回退到安全默认值，不能通过 throw 中断 LSP/ACP 初始化。
- **legacy WebSocket fallback 必须接回 `ConnectionManager`**：`ApplicationConfigService` 的 ready gate 依赖扩展端 `client:init` / `profile:init`，而 `eventBus` 发送 `client:init` 前会判断 `Global.languageClient.isConnected()`。如果 fallback 只写 `LanguageClient.connection/webSocket`，不更新 `ConnectionManager.currentConnection` 和 WebSocket provider 内部 socket，`isConnected()` 会保持 false，Editor 窗口会在 300 秒后显示 Local Service Unavailable，即使 legacy WebSocket 已连上 Go/Cosy。新增或重构连接降级链路时必须复用 `ConnectionManager.adoptConnection()` 统一连接状态、监听和健康检查。
- **初始化必须携带窗口类型**：Go/Cosy 依赖 `initialize.ideWindowType` 区分普通 Editor 窗口和 Quest/Agents Window。扩展启动时 LSP `LanguageClient.onInitialize()` 会先于 Browser 侧 ACP 初始化并设置 `Global.initializeProtocol='lsp'`，因此窗口类型必须写入 `InitializeParamsWithConfig`；ACP `initialize` 也要透传同名字段，用于覆盖 ACP 先初始化的少数路径。取值固定为 `editor` / `quest`，来源为 `vscode.env.ideWindowType`。
- **`task/fileChanges/content` / `task/fileChanges/byChatRecords` 与 `computeDiff`**：LSP `sendRequest` 常返回完整信封 `{ success, data: { fileChanges, pageNumber, ... } }`，列表在 `data` 内而非顶层。`getMasterModeTaskReportChanges` 必须同时处理 `result.fileChanges` 与 `result.data?.fileChanges`，否则扩展侧不会预填 `diff` / `addLines` / `deleteLines`（IDE `BaseApiService` 仍会 unwrap `data`，Quest 能拿到 `fileChanges` 但缺扩展计算的统计）。`task/fileChanges/content` 的 `onlyStats` 是扩展本地剥离全文的参数；`task/fileChanges/byChatRecords` 是会话流 request 级摘要接口，必须把 `onlyStats` 透传给 Cosy，让后端走 metadata-only 路径。`computeDiff` 只应处理纯文本内容；图片、二进制、非文本 MIME 或内容不是字符串的条目直接返回空 diff 与 0 行统计，避免把二进制内容当 unified diff 计算。Quest Review 的 `originalContentHash` / `modifiedContentHash` 也在这里剥离全文前计算；`onlyStats=true` 仍要保留 hash 字段，供 Summary 和 Review This Quest 的临时外部改动检测使用。
- **Quest Review 磁盘 hash 必须留在插件侧**：Browser 侧只能发 `getQuestReviewDiskFileHashes` 请求并临时缓存结果，不能自己读远端/本地文件。插件侧用 `vscode.workspace.fs.readFile()` 读取实际 Extension Host authority 下的文件并计算 SHA-256；内容 hash 与磁盘 hash 都有 10 秒 TTL 与 in-flight 去重，避免 Summary、Review 打开和 scope 切换同时触发重复全量读取。
- **`codebase/status` 转发必须携带 workspace 线索**：Cosy 的 Stilla 状态只保证 tags 语义，Quest Window 会在多个 workspace 间切换。`CodebaseStillaSyncHandler` 转发给 IDE 时要补充当前 `workspaceUri` / `workspacePath`，让 Browser 侧 `ModelConfigService` 能按 workspace 缓存和过滤迟到通知；若 Go 端未来直接下发 workspace 字段，Go 端字段优先，不要在扩展侧覆盖。
- **BYOK 自定义模型反查分层**：`getCustomModels` 返回用户在 IDE 配置的自定义模型元数据、provider 展示说明（`description`/`providerDisplayName`）和当前可用性（`byokSupported`、`enabled`、`disabledReason`），但不批量回传 API Key；真正执行某个 `custom:{id}` 时仍由 `resolveModelConfig` 单模型解析并按来源 Extension Host authority 查询远端 BYOK provider/type 后注入 runtime `customModel`。不要把列表接口改成批量泄露 SecretStorage 中的所有 key。切换到不支持 BYOK 的账号时，列表记录应保留但标记 `enabled=false` / `disabledReason=account_disabled`，由 Cosy 自行过滤不可执行项。
- **SCM 陷阱**：commit message 生成入口会先通过 `git.getWorkingTreeDiff` 做本地预检，diff 为空时不会请求 Go/Cosy。SCM 输入框按钮不传 `includeUnstaged`，必须保持老逻辑：有 staged 时取 staged，否则取 workingTree/untracked；Review Commit 等新入口显式传 `includeUnstaged=false` 时才是 staged-only，传 true 时才是 HEAD→最终工作区 canonical diff。排查“没有文件变更，或所选择的文件不符合条件”时，先看 workbench 层 `GitBridgeService` 是否正确生成 staged/workingTree diff；删除文件尤其要确认 staged deleted 的 `git:` URI 读不到 modified 侧时仍能生成 deleted diff。
  - **会话维度按 `files` 收敛**：`git.generateCommitMessage` 与 `git.getWorkingTreeDiff` 都接受可选 `files`（仓库根相对 POSIX 路径白名单）。Review Commit 走 pathspec 只提交 `scopedFiles` 时，生成提交信息必须把同一份 `files` 透传进去（`toGenerateOptions` / `toDiffRequestParams` 已带 `files`），否则会出现「只提交 N 个文件、生成信息却描述整仓所有 uncommitted」（#83629186）。`files===undefined` 表示整仓（uncommitted 维度，行为不变）；`files===[]` 表示范围内无文件→空 diff，不要回退成整仓。
- **MCP 会话元数据**：`session/new/load` 下发的 `McpServerConfig.headers` 可绑定 `x-aicoding-layout-mode` / `x-aicoding-session-id`。这类元数据只在本地 MCP Server 和 Provider 内部流转，**不要**塞进 tool `arguments`，否则会进入模型可见的 tool schema
- **MCP tool_call context fallback 不要只按第一个下划线切分**：Go/Cosy 推到 IDE 的 `session/update.tool_call.title` 可能是裸工具名（如 `manage_scheduled_task`）、`schedule_manage_scheduled_task`、`mcp_schedule_manage_scheduled_task`、`mcp#schedule#manage_scheduled_task` 或 `mcp__schedule__manage_scheduled_task`。`SessionUpdateHandler` 缓存 MCP 调用上下文时必须先经过 `parseMcpProviderToolTitle()`；否则 schedule 这类工具名内含下划线的 provider 会被误解析成 `provider=manage`，后续 MCP HTTP 请求缺少 header 时拿不到 `context.sessionId`。
- **Schedule task 的执行归属是真 session 绑定**：本地 schedule store 以 `sessionId` 作为 Runner 执行和 TaskList pending 图标的事实来源。Quest fork 不能只让 UI 回看源 session；必须把未来 pending schedule task 复制成新 session 的可执行 pending 任务，并更新 `questTaskId` / virtual workspace path 等 fork 后上下文，否则图标和实际到点执行会分叉。已删除、已完成或失败的 schedule task 也要复制成同状态的历史快照，供 fork 后 Summary/产物区按当前 session 展示历史；这类快照不能被重置为 pending。
- **Schedule MCP 创建必须记录 sourceToolCallId**：fork 后历史会回放源会话的 schedule 工具结果，结果里的 `taskId` 仍指向源任务。`SessionUpdateHandler` 入队的 MCP context 要把 `toolCallId` 透传到 `ScheduleMcpProvider`，并写入 `ScheduleTask.sourceToolCallId`；卡片才能用当前 `sessionId + sourceToolCallId` 精确找到克隆任务。旧数据可用 `sourceRequestId` 兜底，但一个 request 内多次创建 schedule 时不唯一。
- **Schedule runner 同批触发按 session 分组**：同一时刻到期的源任务和 fork 任务属于不同 `sessionId`，runner 必须在同一轮 scan 中并发触发，不能被全局 `MIN_REFIRE_GAP_MS` 串行化。间隔保护只用于同一 session 内的多个 due task，避免并发调用 `sendMessage` 触发忙态竞态。
- **Schedule runner / MCP provider 只属于 Quest 窗口**：schedule 当前是 Quest 专属能力。Editor 窗口可以保留 store 查询和通知 handler 以兼容卡片/管理请求，但不能启动 `ScheduleTaskRunner`，也不能注册 `ScheduleMcpProvider` 暴露创建工具；否则多个窗口会共享同一份 global schedule store，Editor 窗口可能抢执行 Quest task 并因找不到 Quest session 把任务误标为 `session_missing` 失败。
- **Browser MCP 启用判断要识别 Quest Agent**：`BrowserMcpProvider.isEnabled()` 在 `session/prompt` 阶段会读取 prompt `_meta`，但 prompt meta 可能只带 request 级字段，必须同时通过 `sessionId` 回退读取 `sessionRuntimeMetaStore` 中由 `session/new` 保存的 `questType` / `layoutMode`。`ACPIntegration.updateSessionRuntimeMeta()` 合并 request 级 meta 时，只有 `_meta` 明确携带 `layout-mode`、`quest-task-id` 或 `quest-type` 才能更新 `layoutMode`，不能让缺少 Quest 字段的 prompt 默认成 `editor` 并覆盖已保存的 Quest layout。Editor 的 `config.integrations.browserRunMode=Disabled` 只能禁用 Editor Agent/Ask 的 browser-use；当 prompt `_meta['ai-coding/quest-type']='agent'` 且 runtime meta 显示 `layoutMode='quest'`，或 legacy prompt 仅携带 `_meta['ai-coding/quest-task-id']` 时，必须绕过该 Editor 设置，否则 Quest Agent 会在 enabledMcpServers 计算阶段丢失 Browser Agent。历史恢复或早期 `session/new` 兼容路径可能只有 `quest-task-id` 而没有 `quest-type`，这类上下文按 Quest Agent 兜底处理；只有明确 `quest-type='experts'` 才保持 Experts 隔离。Experts 和 `/browser` 显式命令已有各自绕过分支，新增判断时不要把这些分支合并成只看 `mode` 的粗粒度条件。
- **ACP `session/load` 日志必须脱敏**：Go/Cosy 返回的 `_meta['ai-coding/load-conversation-anchors']` 里包含用户对话摘要，扩展侧和 Browser 侧都不能记录原始 response。排查分页/定位只记录 requestId、index、anchor 数量、loadTill/loadTarget/loadLimit、reachedBeginning 等结构化摘要。
- **`session/load` 回放不能同步直通 Extension Host**：Cosy 会把历史分页结果作为大量 `_meta['ai-coding/update-for']='load'` 的 `session/update` 回放。`SessionUpdateHandler` 必须把这类 load replay 更新排队并按小批次转发到 `chat/progress`，每批处理后让出事件循环；实时 `session/prompt` 更新才允许直通。不要在 load replay 热路径对完整 payload 做 `JSON.stringify` 日志，否则长 Quest 会话手动或自动加载历史时会把 `aicoding-agent` 插件进程压到 unresponsive。
- **`hook/systemMessage` 转发必须保留稳定事件字段**：`HookSystemMessageHandler` 对 live 广播只做透明转发，必须保留 Cosy 下发的 `id` / `createdAt` / `requestId`；`id` 是 Workbench 合并 live 与 `session/load` 回放的幂等键。不要在扩展侧把它改造成 prompt，也不要把 `command` 补进历史回放数据。
- **ACP `session/prompt` 日志必须脱敏**：扩展侧 `ACPIntegration` 的 info/debug 日志只能打印 prompt/context 的结构化摘要，`text`、`data`、`resource.text`、`resource.blob` 都必须替换成 `{ redacted: true, length }`。Browser 侧 `IACPClientService` 已脱敏不代表 Extension Host 的 Output log 安全；真实发给 Cosy 的 `promptParams` 保持原文，只替换日志副本。
- **Quest 终端权限有 ACP/legacy 混合链路**：Quest Bash/`run_in_terminal` 可能先通过 ACP `session/update.tool_call*` 展示卡片，但真正执行仍由 legacy `tool/invoke -> ToolInvokeHandler -> aicoding.runTerminalCommand` 完成。Quest 的 legacy `tool/invoke.parameters.run_mode` 可能滞后或仍带默认 `autoRun`，审批策略必须以 `config/getGlobal.terminalRunMode` 为准，仅在全局值无效时回退调用参数，否则设置页切到 `askEveryTime` 后白名单外命令仍会自动执行。`ToolInvokeHandler` 在有效模式为 `askEveryTime`、同一 `toolCallId` 没见过后端 `session/request_permission`、且 `toolCallRuntimeContextStore` 能定位到 Quest execution session 时，必须先按全局 `commandAllowList` 判断命令是否白名单命中；命中时直接执行，不再补发 IDE 侧 permission，保持 Quest 和 Editor 的 Ask every time 白名单语义一致。有效模式为 `autoRun` 时也必须先按全局 `commandDenyList` 判断，命中黑名单则补发 IDE 侧 permission，保持 Quest 和 Editor 的 DenyList 语义一致。未命中白名单/黑名单分支时再按有效模式处理；补发 IDE 侧 permission 时必须归一化 legacy rawInput：`has_risk` 映射为 `potential_risk`、camelCase 权限字段映射为 snake_case，且除显式 `sandbox_enable=false` 或 `required_permissions === 'all'` 外都要补 `sandbox_enable=true`，否则 Browser 侧 `TerminalTool` / `PendingApprovalsPanel` 不会展示 `Run in sandbox`；`potential_risk=true` 只影响默认选中 sandbox，不决定入口是否展示。拒绝时要主动 `sendToolInvokeResult` 收尾，不能静默 return。权限响应判断必须 fail-closed，只允许明确选择 legacy allow optionId 的响应继续执行，不能用“不是 reject”这种负向匹配。Browser 侧只接受带 `_meta['ai-coding/legacy-terminal-permission-fallback']` 的兜底请求把已提前到 `in_progress` 的卡片拉回 `pending`，避免普通迟到 permission 污染已完成工具。
- `SessionRequestPermissionMessageHandler` 的 `seenPermissionRequests` 与 `pendingPermissions` 必须使用同一套 TTL 清理口径。后端 permission 已转给 Browser 但用户长期未响应、连接断开或 session 被销毁时，pending promise 不能无限留在 Map 里；过期条目要 reject 并删除，让等待中的 request 显式结束。

## 登录态双模式

由 `featureFlags['qoderDirectAuth']` 控制：

- **Qoder**：IDE 端 `QoderAuthService` 管理，扩展被动接收（`MSG_SYNC_CACHED_AUTH`），`syncAuthStatus*()` 内部直接 return
- **Lingma**：扩展通过 `LanguageClient.authStatus()` 查询 Go 端，`AuthReportHandler` 处理 Go 推送的登录态变更
- **注意**：`AuthSyncTokenUpdateHandler` 只更新 token/refreshToken/expireTime 三个字段，Go 端返回的其他字段是默认值，覆盖会出错

## Cosy 远程启动恢复

- 远程 server 可能由用户手动解压，`aicoding-agent/bin` 可能不归当前用户所有。Cosy 启动前只检查实际 Go 入口的 `X_OK`：已可执行时不得递归 `chmod` 整个插件目录；缺少执行权限时只修复入口文件，失败要进入 `UpdateError` 并停止 LanguageClient 初始化。复制内置二进制时要保留源 mode。
- Dev Container 与宿主机可能把不同的用户目录映射到同一底层配置卷，但两侧 PID namespace 和 Unix Socket 路径并不互通。`CosyConfig.getCosyDataPath()` 必须像 Remote SSH 一样按 `vscode.env.machineId` 隔离 Dev Container 的 `SharedClientCache`，避免容器把宿主 PID 误判为 stale、删除宿主 endpoint 后又因共享 `.lock` 无法启动。迁移只能复用 `ProcessUtils.startCosyProcess()` 的白名单复制（`cache/db`、`mcp.json`），禁止复制 `.lock`、`.info*` 或 Socket。
- `.info.json` / `.info` 只能在进程已确认不存在、Linux `/proc/<pid>/stat` 为 zombie/dead，或确认 PID 已被其他可执行文件复用且旧 endpoint 不可达时清理；`isDev=true` 始终保留。旧 IPC 路径只能在位于系统临时目录且 `lstat` 确认为 socket 时 best-effort 删除。Unix `kill(pid, 0)` 对 zombie 仍返回成功，不能单独用作“进程可服务”的判断。
- Linux 进程身份要直接读取 `/proc/<pid>/exe` 的符号链接，不能使用 `readlink -f`：远端 server 升级删除旧二进制后，原始链接会携带 ` (deleted)`，`-f` 则失败并丢失可执行文件身份。去掉该后缀后仍需按当前路径、`.process-meta.json` 或 `aicoding-agent/bin` 路径结构确认它是 Cosy，才能 kill；PID 被其他程序复用时只清旧 endpoint，不得终止复用进程。
- PID 处于 running/unknown 且无法确认进程路径时，先检查 IPC/WebSocket；两者都不可用时报诊断错误，不得清理 endpoint、kill 未知进程或再启一个 Cosy。新进程只能启动一次，必须等待新 PID 和健康 endpoint 后才初始化 LanguageClient。

## 构建

```bash
npm run compile              # Qoder 品牌
npm run compile-lingma       # Lingma 品牌
npm run watch                # 开发监听
```
