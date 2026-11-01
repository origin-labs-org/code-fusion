
main 只调度Start，由此 adapter 调用现有 resolver 定位的 CLI execute `storage-migrate`。Data库路径and迁移 SQL 归 CLI；此模块不打开Data库，也不Start app-server、Model、MCP or session。

Retain executable/runtime Prefix参Count（含有空格的 bundle 路径），移除 app-server/agent-server 及其Run参Count，使用参CountArrayexecute，禁止 shell 拼接。环Context由Start入口与 resolver 注入，Retain自定义 dataBaseDir。Command不符合原 Agent About定时Deny，不猜测 wrapper 行为。

成功要求子进程零Exit并BackVersion化严格 JSON；Shared schema 校验后Back migration Result。非零Exitor解析Failed传播到 main 已有Retry/备份/Exit交互。无超时重启orRetryQueue；SQL runner 自己Processing幂等、锁and回滚。Output限额防失控，不按Data库大小Settingsexecute截止时间。

时序：app migration → CLI storage-migrate → 两者成功 → scheduler/Host/window。两个库不宣称跨进程原子事务；Retry依赖每库 ledger，Unknown未来 id and校验and规则仍由公共 runner execute。
