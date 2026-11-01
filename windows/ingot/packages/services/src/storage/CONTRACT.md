
Settings页「Data与统计 → Storage Management」的Service端：扫描Local machine `.cf` Data根、按Category聚合、按Category清理。spec 见 `docs/settings-storage-management.md`。

类型与Tests表达不了的Invariants：

- 同One时刻至多One个 running job；`startScan` 隐式CancelOld job，`cancelScan(jobId)` 对非Current job Yes no-op。
- 同One job inner进度快照的 `bytes` 只增不减；`status` 只能从 `scanning` 到 `complete | cancelled | failed`。
- `clean` 只Delete catalog 显式匹配且Passed `cleanPlan` 校验的路径；受保护白名单在任何Category下都不删；Failed逐路径记入 `failures`，不抛整体异常。
- `entries` 只聚合到Rule hit path的下One级，并有Quantity上限；快照体积与File总CountIrrelevant。
- Data根来自注入的 `RootsResolverPort`（desktop 传 `homedir()` 与 `getDataBaseDir()`），模块inner不读环Context变量、不读SettingsFile。
- 只做Desktop端；不进入 task realtime 链路，不区分 `desktop-continuous` / `web-remote-replayable`。
