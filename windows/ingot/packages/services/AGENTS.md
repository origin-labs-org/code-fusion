
本FileSupplement[根规则](../../AGENTS.md)。修改 Agent/session/runtime or进程职责时，先读 [runtime Boundaries](../../docs/agents/runtime-boundaries.md)，同时考虑DesktopLocalandMobile Remote Control。

Agent/session/runtime Logs统One用 [createServiceLogger(scope)](src/logger/serviceLogger.ts)，按实际频率and故障用途选择等级：

| 等级  | 使用场景                                                                                    |
| ----- | ------------------------------------------------------------------------------------------- |
| debug | Raw NDJSON、part.delta、tool.updated、stream chunk 统计、逐Tools trace 等High频Protocol细节       |
| info  | 进程Start/Exit、session 创建/Close、PermissionsResult、provider 就绪、One次性Configuration加载等生产LifecycleEvents |
| warn  | 可恢复异常or降级，如 session/close Failed、单次Retry、已知 stderr Warning                         |
| error | 不可恢复Error，如进程崩溃、Protocol握手Failed、鉴权丢失                                            |

- 与Messages流同Quantity级的Logs必须使用 debug，避免生产Logs随流量膨胀。
- debug Default只在Local开发Run时Enable，判据由 [nodeEnv.ts](src/runtime-tools/nodeEnv.ts) 提供；非开发Run时为 no-op，Tests可Passed logger 选项覆盖。沿用该统One判据，不自行从 shell 的 NODE_ENV Inference。
- `CF_ENV` 仅表达产品环Context（test/production），不用于判断Local开发形态。
- RPC 的频道、Commandand耗时已有 [logging middleware](../rpc/src/logging-middleware.ts)；排查前先Check已有记录，避免重复High频Logs。
