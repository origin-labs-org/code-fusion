# plugin-ui

Renderer 模块，层序 `domain → app → adapters → components`；公开入口为 `index.ts`。

- Window唯OnePagesManage器统OneManage MCP 与 Gen UI 的容量and回收；`createPage` 持有 MCP controller、AppBridge、独立 workspace/session lease、通知 feed andinner存快照。卡片、Sidebar只登记锚点。inner联Pages位于滚动容器inner部，Sidebar单独定位；原子移动Retain同One guest，不重读资源、不重New握手。Unbind必须在 DOM 卸载前同步移入Hide承载区。
- Pages承载容器只负责布局，不接收鼠LabelHit；webview 显式接收点击。webview 释放后的空容器不能遮挡宿主重载按钮，inner联、Sidebar与预览共用此规则。
- Sidebar展示由宿Main workspace/主View、Expanded StateandCurrentTags共同派生。Hide卡片同步Unbind展示锚点，Pages进入 inert Background表面，Instance、executeandEditStatusRetain；恢复复用同One guest，不以保活 DOM 尺寸Inference展示意图。
- 逻辑键包含 workspace identity（Local fallback 为路径）、session、plugin、server、resource and逻辑View。surface 显式Shared；普通Tools只按明确的 widgetSessionId 与E同Permissions范围Shared，否则按 toolCallId Isolated。禁止同回合同资源Inference合并。
- UI 不接触Plugins HTML、Data库andConnect凭据。经 `IPluginUiBridgeService` 获取句柄，平台端口只校验 sandboxId/initId；Request与 live 通知Bind Agent runtimeId/generation/token/appIdentity。
- Official ext-apps 2.0.0 每活PagesOne个 AppBridge；握手期限 15 秒。Retain `experimental["cf/…"]` 的 widgetState、resourceSubscribe、surface、CSP 扩展；不模拟Complete OpenAI API。
- App-provided tools 在 initialized 后发现与登记；认领后用Official SDK AbortSignal execute，ModelCancel沿 live-only delta 到Pages。callId 去重，Final stateResult不可再Write。Pages调用 MCP 的Target由宿主固定，复用 Agent 的Permissionsand审批路径，RawResult直接Back。
- Pages `availableDisplayModes` Yes硬About束；inline/fullscreen 对应inner联/Sidebar，pip 保持CurrentMode。High度Default 240px、范围 [80,1200]，hostContext 只回传 width/maxHeight，避免High度回环。布局按帧合并。
- widgetState 仅接受Pages主动Submit，唯Oneinner存 store 按逻辑键Isolated；重建时在 `hostContext["cf/widgetState"]` 下发。切Location不Copy；手动Retry、Task淘汰、SourceUndo清除；应用重启为空。
- MCP page DenyAuto回收：切 session、离屏and空闲均Retain同One guest 与未SaveEditStatus。Gen UI 沿用连续离屏 5 分钟及容量回收。最多 30 个Taskand 64 个活Pages，容量 admission 串行；无可回收页时DenyNew，不淘汰 MCP Pages。TaskDelete同时CancelQueued创建。
- owner 在准入后立即Start，不Waiting展示锚点。Retain的 MCP guest 始End可execute；不以Protocol握手、Session executeStatusorPlugins私有上报Decide停帧。无可展示尺寸锚点时使用 inert Background表面，WindowHide时维持Target guest Events；inner联Pages留在原滚动树Medium。详见 [Backgroundexecute spec](../../../../docs/plugin-ui-background-execution.md)。
- 已获准的主动释放先按原 sandboxId 解除导航/崩溃监听，避免 Main StopPages的 about:blank 导航误报崩溃；真实Running的导航/崩溃仍进入 error，Retry后重建。
- 显式重载、TaskDelete、WindowCloseandSource/runtime Invalid才释放 MCP Pages。顺序：Invalid凭证、Cancel调用and登记、有Boundary resource-teardown、Close端口/guest、释放 feed/lease。迟到 prepare、注销and锚点清理只作用于捕获的原Instance。卡片卸载不切断保活Pages的订阅。
- `sendFollowUpMessage` 仍走既有Session动作and手势/可Edit确认；确认Completed后验证Instance。只读Session不登记动作。`updateModelContext` 只投递到该 workspace/session 的 composer，不YesData库Status。
- `display.ui` 无效、Web/手机/Remote、不支持平台or初始化FailedContinue普通 MCP 卡回退。Tools行替代与折叠策Omitted仍由投影派生；不会另建 accepted-input queue or改变 continuous/replayable 语义。
- ToolsFailed、Cancelor `display.ui.isError` 只Retain普通Tools记录，不占用 inline/Sidebar区域、不Auto开Sidebar，手动固定/showInline/Recent回合不能越过此门禁；Failed不替代已有成功Pages。RawErrorResult及Pages通知语义保持不变。

组件只经 hooks/Service端口访Questionouter部Capabilities；controller 不导入适配器，domain 只做纯计算。Sidebar tab、composer Context仍由既有 UI owner 持有，不与PagesStatus重复Write。

`preferredDisplayMode: fullscreen` 每次实际Tool call只消费One次；记录归既有Sidebarinner存，按 workspace/session/plugin/server/resource/toolCall Isolated，随其WindowCacheRetain与淘汰。Tools行重挂不能重New触发打开并覆盖Collapse偏OK；已Show在Sidebar时也消费该调用。手动打开、PagesRequest以及NewTool call仍走原入口。

- Sampling 使用Official oncreatesamplingmessage；只有可操作Task声明 sampling:{}。Request携带CompleteInstance凭证，SDK signal 经显式 cancel 到 Agent；controller k采样计入 busy，切展示Location不Cancel/重发。Result不进入主聊天；inner容扩展and进度仍 pending。

`hostPrimitives.ts` 对 Gen UI 公开 MessagePort 传输、原子移动Pages承载层、Window级容量Manage、Theme投影andSession动作Read。Gen UI 不复用 MCP Tools调用控制器。Bind显式区分Natural流、容器定位与Sidebar；Gen UI 预览使用原容器 popover，不重New挂载Pages。

上游整合：app/adapters 从 services 公共入口导入PluginsCapabilities端口类型and IServiceAccessor，不引用 Repo or Runtime Implementation。

Window级接收器PassedLocalDesktop专用ServiceEvents接收Current成功 UI Tool Result，即使Session未挂载也向唯OnePagesManage器申请创建；与卡片Shared逻辑键and准入 Promise。历史回放不主动创建，Background results只更NewToolsData，不改变展示锚点or抢焦点。
