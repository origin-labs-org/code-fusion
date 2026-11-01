# desktop-web-remote-relay

k Main 的 HTTP、Storageand device WebSocket 与 manager 装配Isolated。

仅 index.ts/contract.ts 供outer部消费。manager 仍唯One拥有 window runtime 与 attachment；transport 唯One拥有 socket/generation。storage 只Save非敏感身份，clearLegacy 合并Concurrency且Failed可Retry。凭据从注入端口Read，HTTP Error只Back分类。

Complete语义见 [Relay V2 spec](../../../../../docs/web-remote-control/relay-v2-pairing.md)。
