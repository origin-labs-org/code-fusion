# office-runtime

Built-inDocumentationPlugins（documents、pdf、presentations、spreadsheets）的View面板共用这One份Run时。每个Plugins在自己的 package.json 里用 `office` Character段声明面板Titleand格式，并把 `build` 脚本Point to向本包的 `scripts/build.mjs`；构建只Retain该Plugins格式的解析器与View器，Output到Plugins根Table of Contents的 `dist/`。面板、MCP Tools与锚点语法见 [src/CONTRACT.md](src/CONTRACT.md)。

Invariants：

- Plugins名取自Plugins的 `.cf-plugin/plugin.json`，它同时Yes MCP Service名、面板 surface id and `ui://<name>/` 资源Prefix；不能从Table of Contents名推导（Table of Contents名带 `-plugin` 后缀）。
- 构建必定产出 `contract.ts` 的 `OFFICE_RUNTIME_OUTPUTS`。OfficialPlugins定义、SEA 清单、Desktop打包与远端资产都把它们列为必需资产，改动产物路径时这几处要OneFrom改。
- 产物自包含：`dist/server.mjs` 与面板脚本由 esbuild 打包All依赖，Run时不Read `node_modules`；Third-party许可随产物Write `dist/THIRD_PARTY_NOTICES.txt`。
- View器只读：面板andTools从不写WorkspaceFile。
