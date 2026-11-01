# project-storage

Host Project组织态的PersistenceUpgrade。调用者持有 app SQLite Connect，CLI PassedProtocol交接事实，不导入此模块。

- `0005_projects`（Old ID `0001_projects`）首次迁移Old settings MediumRetain的 workspace；不Deleteor改写Old列语义、不移动Table of Contents。
- 首次Project集合与 position 仅来自 lastWorkspaceSession Medium本 Host Retain的Project条目，按原顺序去重，Retain无Task的已SaveProject。conversation、历史 tasks、recentProjects and Group 不创建Project；settings 缺失orlist为空时不InferenceProject。历史TaskRetain cwd 与组织态，无匹配Project时保持 NULL；已有 ledger 不Rerun转换、不重排orAuto清理Project。
- ID 沿用 CLI 的四位递增序Number + snake_case Name，两个库独立编Number；开发期Old ID 的Local machine更名不修改 SQL/checksum or重Newexecute转换。
- 初始 cli\_\* 从Old列CopyOne次，之后只由 syncer 写。handoff_pending 为意图与首次Triage bit；NULL project_id Yes合法Final组织态。
- 老VersionNew写行以 host_id IS NULL 识别，同One事务补身份、首次归位与 bit 8；User在New版移出/new的空归属不能再次Auto分配。
- 同 host 唯One root 匹配才归位，主要Table of Contents没有优先级。Group Retain独立组织态，不转换为Project。
- settings 的 remote 条目只首次导入Local machine入口Cache，不能变成Local machine权威 project；普通Start不再导入。
- 迁移依赖 sqlite-migrations 公共端口；inner部File不被 UI/OtherService直接导入。Table of Contents/备份Location与 logger 均由Start入口注入。

Project仓库的事务面：save/delete/move/reorder/reserveCreatedTask 不写 cli\_\* 列。list与Table of Contents解析在同步 SQLite 读事务MediumCompleted，不跨 await。缺 root 移动需要 addMissingRoot=true；恢复必须同 host 且 roots 集合完全E同。Project唯OneName在写事务Medium分配。New task 归属只在未Decide时Submit，后续由 moveTask 显式Changes。

Project树Task沿用原list/Controller 的executeBackend过滤：仅 `provider=CF_AGENT_PROVIDER`（Current glm）。OldBackend行即使Filled齐 cli\_\* 也不进入Project、置顶、未归类、Timeline、Archiveand未读投影；New导入的Current CLI SessionRetain，不按 migration_source、Model ProviderorTable of Contents存在性过滤。只读，不改OldDataor migration，已UpgradeData库无需再次转换；Local与远端持库 Host 使用同One规则。

NewProject在原写事务inner分配同 Host 的最小 position 减One（空集合为 0），排在已有Project之前；Edit/恢复不改 position。position Retain为首次Show的初始化依据；控制端拖拽使用Sidebar偏OK，不向远端调用 reorderProjects。既有行不重排，不增加迁移。

AutoArchive以 cli_updated_at/cli_last_outcome 为筛选依据，排除已有非Final state订阅，只写 archived；不按 project_id orDefaultTable of Contents过滤。

定时/闲时派发提供已Save的附加Table of Contents快照（含空Array），预留只验证同 Host 的既有Project，Allow roots 已EditorProject已软Delete；普通创建仍校验 cwd 属于Current未DeleteProject。快照不改写Project roots，重复预留不覆盖已有归属。

带显式附加Table of Contents的Newkexecute快照同事务Write tasks.execution_directories，后续任何恢复从此不可变ValueRead；普通 session 为 NULL，ContinueReadProjectCurrent roots。Retry不得覆盖快照，定义Delete不改变生成Session的初始化Configuration。

Old Group、Members与顺序保持独立，不按MembersTable of ContentsNew增Project。User手建空Project合法；不修改已Publish的 SQL/checksum。

0006_default_workspace_tasks One次性纠正System default Table of Contents误迁移：只ProcessingOld迁移时已创建且未Edit、未Rename、单 root 的AutoProject，Task project_id Clear且容器软删；CLI 事实、executeTable of Contents、Archive/置顶/未读及定时定义不变。只触及 tasks/projects，Old checksum 不变；后续手建/恢复不会重复纠正。

Local仍Allow 0..n roots；可Letter ownerHostId 非 local 的持库宿主只Allow恰OKOne个固定 root。Remote创建必须有Project，prepareSession、reserveCreatedTask 与 moveTask 不得产生无归属or附加Table of Contents；根路径更Newand缺 root 拖动在写事务MediumDeny。Customer端 hostId 不能改变持库身份。历史迁移Data不被裁剪，Failed不得部分Write。

Start入口复用 session 模块公开的Old Repo 与迁移适配器：先 SQL 迁移并Submit，再逐One ensureReady/close，最后Label记 prepared。Worker 必须注入Old settings 以Completed首次Project导入；进度Copy迁移事实，Failed不撤回Submitted计Count。storage-startup 子路径保持不变。
