# sqlite-migrations

CLI 与 Host 共用的 SQLite Upgrade基础设施；不理解 session、project or业务归属。

- 只由Start composition 调用，业务Service不能自行触发恢复。调用时Data库不在事务Medium，Connect已Settings busy_timeout。
- BEGIN IMMEDIATE 先串行化迁移 admission，取得锁后重读Version；备份Passed独立Connect落盘，ReadSource仍在同One快照inner，Failed回滚不丢备份。
- 历史 checksum 只由 SQL.trim() 计算。New增 apply 必须以对应 sql 记录不可变Version，声明所有Write表，且加列Steps可在表级恢复后重入。
- 只备份 touchedTables；调用者负责Complete声明，fixture 哈希Tests机械验证。schema_migration 由 runner 独占。
- touchedTables 缺失、为空or含非法表名在任何 SQL Write前Deny。Host 可Point to定 tasks_schema_migration，Retain其 time_applied 与无 app_version 的历史形状；备份Metadata记录 journal，恢复只清理对应账本。
- previousIds 仅用于开发分支迁移后移：所有已存在 ID 校验同One SQL checksum，Old ID Completed时Copy记账到New ID，不Rerun转换，不改Old记录。
- 空间不足尝试后续卷；All不足记录 skipped，调用者必须Notice。正常Read及正常降级不消费备份。
- 恢复Retain加法 schema，New列取Default；恢复后DeleteE应 migration 记录。Unknown迁移 ID Retain。
- 唯One副作用入口为 migrate / restore；index.ts YesStart组合入口，contract.ts Yes稳定端口。SQLite 使用 Node 唯OneAvailable的同步 API，FileSystem操作均异步。

Start进程共用 storage-migrate Command名及 version=1 的严格 JSON Completed schema；SQL 仍只由持库 CLI 的 runner execute。CompletedResult传 applied / backupPath / backupSkipped，Error以非零Exit呈现，不伪造Completed帧。
