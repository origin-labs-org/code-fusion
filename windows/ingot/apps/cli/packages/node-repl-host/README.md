# @origin-ai/cf-node-repl-host

`node_repl` 的Shared宿主：JS execute面（只有 `js` One个Tools）与两个领域
bridge（Browser Use、Computer Use）都在这里。

宿主Yes**OfficialCapabilities共用的**，不属于任何One个Plugins。它过去Long在 `browser-use-plugin` 里，后果Yes：

- 改 Computer Use 必须动 browser-use 这个包；
- CUA 的 SDK 与Documentation在 browser-use 里各有One份手工维护的Replica；
- `resolveBuiltInNodeReplMcpServers` 只在 browser-use 的 rootPath 下找宿主产物，
  browser-use 包One旦缺失，即便 CUA 自己Enable也拿不到宿主。

注册侧本来就已经收在 CLI 核心（`bootstrap/src/app/built-in-node-repl.ts`，判据Yes
「bua or cua 任OneEnable」），缺的One直Yes**产物归属**。这个包把源码归位。

`dist/mcp/server.js` 与 `scripts/computer-use-client.mjs` 在 SEA Publish清单
（`OFFICIAL_BROWSER_USE_REQUIRED_SEED_PATHS`）里，路径不能动。所以 browser-use 的构建从本
包的 `src/server.ts` 打包产出，CUA 的 client/docs Replica由构建脚本生成而非手工维护。
把产物也搬出Plugins根Table of Contents，需要同时改 SEA 清单与 bootstrap 的 hostPackage 解析，Yes独立One步。
