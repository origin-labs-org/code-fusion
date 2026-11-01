# plugin-ui-bridge

Host ServiceYes UI 与 Agent MCP 之间的桥；UI Passed `IPluginUiBridgeService` 使用，不直接Read HTML orConnection Configuration。

- prepare 先向 Agent 取得SourceBind的Run凭证，再按 runtimeId/token/generation/resourceUri 合并资源Read与 Main 登记；不能仅按 renderer Submit的 scope 合并。资源Read前后由 Agent CheckConnect代际。
- HTML 上限 16 MiB，mimeType 仅接受 text/html;profile=mcp-app or text/html；超限Deny，不截断。HTML 经 Host 到 Main，Renderer 只获取句柄。
- 宿主从受Letter账Number仓库Read provider/profile.id 并哈希为 accountContext，不传 token。账NumberConfigurationChanges立即使在途 open Expired并CloseOldInstance；同账Number token Refresh不触发换代。user_info 更New保守地重New验证Instance。
- validate/close/recycle 透传CompleteInstance凭证；recycle 仅在 Agent confirm没有审批/调用 pin 时成功。调用归属、Permissions、CancelandFinal state由 Agent 单One拥有，Host 不CacheexecuteResultorReplayTools。
- resources/read 原样Back MCP contents，解码总大小限 8 MiB；Agent 同时Check MIME 白名单。不裁剪inner容，不经过ModelSummary。
- 只支持Local workspace Agent；Remote保持现有不支持/普通 MCP 卡回退。复用 Host attachment、workspace identity andSession lease，不NewRemote宿主。

- Sampling 仅透传到已存在的Target workspace Agent，不New/恢复execute、CacheResultorReplay；超时/FailedCancel原 operationId。以严格 schema BackOfficial基础 sampling Result。

Sampling 使用独立 `IPluginUiSamplingService` 描述符透传Request与Cancel，不扩张资源桥方法集合；Web/Remote未注入时不声明 capability。
