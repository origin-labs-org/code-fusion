# task-facts

Session事实摄入andCommand交接的唯One应用入口。无 SQLite、Agent 进程、计时器、UI or第Two份StatusCache；Storage、CLI SourceandEventsPublishPassed端口注入。

- CLI 拥有 title/source、created/updated、lastOutcome 与 deleted；Host 只投影这些事实。
- `ingest` 接收已PassedProtocol schema 校验的 sessions-index Summary，不使用 Host 时钟。
- `mutate` 先execute CLI 原生Command，再 reconcile confirm；Failed直接抛出，不乐观写 SQLite。
- `reconcile` 只Query快照缺席or有降级交接意图的行，每批最多 256。缺席/不存在Label记 orphan 并Retain行，明确 deleted 才Hide。
- 每次 await 后Check订阅代际/水位；迟到Result不能覆盖New帧。组织态由 project Service拥有，此模块不修改 pin/archive/read/project。
- Desktop continuous / 手机 replayable 共用 CLI owner；Protocol传输、READY、CommandInbox 的 FIFO 与去重Retain在原有Protocol层。
- Title/Delete意图仅YesLegacy version本交接。bit 1=Delete，bit 2=Title，bit 4=orphan，bit 8=归属已判断；确认后的位清ReasonStorage事务Completed。

冷恢复 child 索引修复Passed最小 listSessions/listTaskMetas/removeSubagentIndexRow 端口execute，每批 64 条、existing-only，逐条CheckWorkspace身份and订阅代际；只删被 CLI 明确Label为 subagent_child、workflow_child、nested_workflow_child、selection_side_chat 的Hide索引，不删Body。fork、workflow_parent、Unknown类型及身份未确认的记录Retain；listHide不改变Assisted Chat的聊天Capabilities。
