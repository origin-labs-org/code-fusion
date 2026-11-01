# mcp-ui

Agent 侧 MCP Apps 身份、授权、调用and通知入口；Passed McpUiSessionAccess 窄接口使用 session。

- server 必须存在于CurrentSession的可Letter MCP Configuration，不猜测Name。Connect port 提供规范化Source身份与现有Connect generation；资源Read前后、Requestexecute前and审批后均验证。
- 首次 open WaitingTarget server 已有ConnectTask，再Check原 session、lease andConnect身份；不WaitingAll MCP、不主动Reconnect。同步凭证校验仍立即DenyInvalidSource，WaitingCompleted不能复活已释放 owner。
- McpUiInstances YesRun凭证唯One owner：Agent runtimeId、单调 generation、不可猜 token、稳定 appIdentity。Bind workspace identity/session/plugin/server/resource/scope/owner and Host 提供的已知账NumberContext。同逻辑Pages同Connect的Concurrency open 幂等。
- Pages只能选择ToolsName与参Count，不能选择Connect、SessionorInstance。callTool Check app visibility，并复用已有 ToolExecutor 的校验、hooks、Deny规则、Session授权与审批；app-only Tools可直接建立授权 entry，不要求暴露ToModel。Raw MCP Result直接Back，不产生AutoChator transcript row。
- execute固定已验证的Connect代际，不触发Connect重建、OAuth Automatic recoveryorToolsReplay。Cancel到达底层 signal；Cancel不回滚outer部已发生操作。
- NDJSON 对Complete凭证Bind的 MCP App RequestAllow独立execute；Long调用不得阻塞Cancel、Close、审批及OtherPages。普通SessionRequestRetain串行Queue，Agent Instance与调用登记负责ConcurrencyFinal state。
- 调用接纳时占用 callId；重复接纳、Canceland回包幂等，Final state之后Deny迟到Result。close 先移除凭证，再 abort、Cancel调用、注销Toolsand资源订阅。onlyIfIdle 与调用 pin 在同One owner 原子Adjudication。
- App-provided tools 的现有同 server Recent登记策OmittedRetain；Model entry 在审批前固定并 pin 对应Instance。live-only 调用与Cancel携带Complete凭证，不入Persistence/replay。Retain 5 秒认领、30 secondsexecute期限；execute只发生One次。
- 资源订阅通知携带Complete凭证，断连/Source变化/SessionExit时Undo；不向OldInstanceor替代Pages投递。ModelandPages两方向的Cancel均使用Official MCP/SDK signal。
- resources/read 面向 UI 的Result移除 \_meta；总大小 8 MiB、MIME 白名单、blob MIME Required，违反时Back明确Error而非截断。

PagesLifecycle不New增 SQLite 表、不Persistence widgetState，不改变普通Session CommandInbox、Host owner/lease、continuous or replayable 通道。

- Sampling 操作表Yes采样接纳/cancel/Final state的唯One owner，BindCompleteInstanceandConnect代际；先 pin 后execute，同代 operationId 不Replay，Invalid立即End结、清账本。每Instance/Task/Agent Concurrency上限 1/4/8，60 秒绝对期限，单Instance账本最多 4096 项。采样沿用TaskModel/Permissions，无New审批/Session/历史；只Retain用量及Diagnostics。
