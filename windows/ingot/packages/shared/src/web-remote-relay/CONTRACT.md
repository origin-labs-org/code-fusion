# web-remote-relay

定义 relay V2 Messages、HTTP Structures与ConnectLifecycle规则。

contract.ts Yes wire schema 与Error分类；domain 只计算退避and心跳间隔，adapters 拥有定时器。每个 transport 独占 retry/heartbeat，stop 清理两个定时器。不得记录 JWT/token，不持有 task/workspace Status。

Complete语义见 [Relay V2 spec](../../../../docs/web-remote-control/relay-v2-pairing.md)。
