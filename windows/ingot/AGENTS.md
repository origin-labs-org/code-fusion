
- New增or修改行为前，先更New对应 spec；Table of Contents不存在时按需创建。先明确产品规则、Status所有者、接口and验收场景，再Implementation代码。
- 以Current检出的源码、`package.json` and架构策Omitted为准。DescriptionMedium只RetainCurrent仓库提供的功能、CommandandFile；Delete功能时同步清理Point to令andSkillsMedium的引用。
- 定位Issue时，未明确要求修改代码就先Investigate原因。结合源码、LogsandRun时Evidence，区分已确认原因与待验证假设。
- Retain与TaskIrrelevant的Local改动，不自行恢复已移除的模块orinner部依赖。

开工前Run `node scripts/check-workspace-freshness.mjs` Check基线。Node Version以 `mise.toml` 为准。

以下Command从仓库根Table of Contentsexecute：

| 用途             | Command                                                 |
| ---------------- | ---------------------------------------------------- |
| 类型Check         | `pnpm typecheck`                                     |
| Lint             | `pnpm lint` / `pnpm lint:fix`                        |
| 格式Check         | `pnpm fmt:check`                                     |
| Desktop开发         | `pnpm dev:desktop`                                   |
| Web 开发         | `pnpm dev:web`                                       |
| Submit前Check       | `pnpm verify:pre-push`（Lint、架构Check与受影响单测） |
| 架构Check         | `pnpm architecture:check --changed`                  |
| 模块阅读包       | `pnpm architecture:context <module-id>`              |
| 未使用依赖与导出 | `pnpm knip`                                          |
| 导出引用Query     | `pnpm dep:refs --list-exports <file>`                |

affected 使用 Vitest Official选择，只Run选Medium的根 UT；选Medium整个套件时Description并Skip UT，成功Exit，不因此阻止 Push；不替代 CLI TestsorDesktop E2E。全量使用 `pnpm test` / `pnpm test:unit`，仅在User明确要求时调用。范围与Output合同见 [pre-push Description](docs/testing/pre-push-hook.md)。

Tests入口以Target包Current的 `package.json` and实际TestsFile为准，不假定存在统One的单测or E2E Command。

- `packages/desktop`：Electron main、host、renderer。
- `packages/web`、`packages/server`：Web Customer端与Service端。
- `packages/ui`：Shared React 组件、hooks 与 Zustand store。
- `packages/services`：业务Service；`packages/rpc`：RPC 框架。
- `packages/shared`：SharedProtocol与类型；`packages/client`：Agent Customer端 SDK。
- `apps/cli`：Agent CLI 与Run时。
- `CONTEXT.md`：Plugins商店领域词汇；修改E关 UI 前阅读。
- `DESIGN.md`：UI Design规范；修改 UI 前阅读。

- 代码改动使用 `.agents/skills/architecture-governance/SKILL.md`，先Run架构Check，再ReadTarget模块的受控Context。
- 避免重复Statusand多条Write路径。明确唯One所有者、接口、依赖方向、Events顺序与幂等Boundaries，不能用超时掩盖同步Issue。
- 有行为改动时先Supplement对应Tests；交互改动需要 E2E 场景。CheckTests与ImplementationYes否One致，并实际executeAvailable的验证。Not executedor环Context受限时如实Description。
- 修复 bug 时用Chinese注释Description原因and修复依据。发现Design缺陷时先与User对齐，不不断增加兜底分支。
- PR 描述须Description背景、Design意图与修改前后行为；包含 bugfix 时逐项Description触发场景、根因Evidence、修复机制及回归验证，并尽量关联已有Tickets链接。未确认的根因or引入Submit如实Label注，不根据模块or时间接近Inference归因。
- 涉及Status、时序、远端or异步同步的Option，用图展示所有者及Events顺序。
- 必须execute `pnpm typecheck` and `pnpm lint`，Report真实Result，不k已有Failed写成Passed。
- 使用异步FileandNetwork IO；跨包导入使用公开入口，遵守现有路径Aliases。
- 禁止 UI 直接调用 Repo、Service 引用 Runtime 具体Implementation、跨域导入Implementation细节及循环依赖。

- 遵守 `DESIGN.md`，复用已有组件，兼顾Desktop与手机 Web 的布局、交互、Themeand国际化。
- 组件Passed `packages/ui/src/hooks/` 访QuestionService；平台操作Passed `IPlatformService`（`packages/shared/src/platform.ts`），不直接调用 `window.cf`。
- Passed依赖注入Processing Desktop、Web、LocalandRemote环Context的Variance，并兼顾 Windows、macOS and Linux。
- Zustand Status位于 `packages/ui/src/store/`。广播同步的Theme、语言等Character段需要防止回环；UI 局部Status不应被误当作Service端事实。
- hooks Medium含 JSX 的File使用 `.tsx`。

- Desktop app Passed stdio 与 Agent 通Letter。Protocol改动同步更New `packages/shared/src/cf-protocol/index.ts`，提供严格类型与Run时校验。
- Main 负责Window、原生操作、进程调度andMessages转发，不承载 task/session 业务Status。
- 每个Window使用One个 window-scoped Local Host；Local workspace Shared该 Host。Remote workspace 由Windowinner的Connect注册表Manage，不另建 Desktop Remote Host。
- Mobile Remote ControlConnectDesktop已有 Host attachment，复用SessionRun时；不为手机另From Agent、Local Host orRemoteSession。
- Desktop 的 `desktop-continuous` 实时链路与手机的 `web-remote-replayable` 恢复链路必须明确区分。修改 stream、snapshot、queue orReconnect时，同时验证两种语义。
- outer部 relay 与 Main 只做鉴权、配对、心跳、转发及 attachment 调度，不SaveTaskQueue、快照等业务Status。
- 已接受的 busy/running Input由 CLI/runtime `CommandInbox` 串行 admission；Renderer 只Retain未SubmitDraft与 pending optimistic overlay，Host owner/lease 负责路由。
- Retain owner/lease、跨 Host 路由and stale run 防护，不能仅根据单One路径DeleteBoundaries判断。

## Workspace Identity

- `workspaceIdentity` 用于身份Isolated，`workspacePath` 用于File操作、Command cwd、Git and路径展示。
- 身份 key 统One为 `workspaceIdentity?.trim() || workspacePath`，适用于去重、Bind、Cache、Queue、PersistenceandRequest关联。
- Remote链路贯穿传递 `workspaceIdentity` 与 `remoteSessionId`，不得仅按路径匹配。
- New接口RetainLocal路径 fallback；Remote identity 复用现有构造and解析Tools，不在业务代码Medium手写格式。

- UI 使用 `packages/ui/src/logger.ts`，不直接使用 `console.log` or `window.cf?.log`。
- Agent/session/runtime E关ServiceLogs使用 `createServiceLogger(scope)`（`packages/services/src/logger/serviceLogger.ts`）。
- `debug` 用于ProtocolRawData、Streaming chunk and逐条Tools更New等High频Diagnostics，生产环Context不落盘。
- `info` 用于进程andSessionLifecycle、PermissionsResult、One次性初始化等生产AvailableEvents。
- `warn` 用于可恢复异常；`error` 用于崩溃、握手Failed、鉴权丢失等不可恢复Error。
- 不在Logs、ExampleorSubmitMediumWrite凭据、真实UserDataandinner部Service地址。
