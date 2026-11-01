
发行物使用根Table of Contents的 [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md)。它Retain npm 包inner的 LICENSE、COPYING、NOTICE、README 许可段，以及Copy源码and原生组件的许可Text；不从 npm author Character段生成版权行。

User取得声明的入口：

- Desktop：InstallTable of Contents的 `resources/THIRD-PARTY-NOTICES.md`；macOS 为 `CodeFusion.app/Contents/Resources/THIRD-PARTY-NOTICES.md`。`Resources/licenses/electron/` 另outerSaveTarget平台 Electron Original text、Chromium Summary及校验清单。
- Web：部署根Table of Contents的 `THIRD-PARTY-NOTICES.md`；构建后的 HTML 带 `rel="license"` 链接。
- 发行 CLI：`dist/THIRD-PARTY-NOTICES.md` 作为伴随File随构建产出，`pnpm build:cf` 的统One分发包Copy到 `agent/THIRD-PARTY-NOTICES.md`。`cf --licenses` 入口与 SEA inner嵌 Node ExactVersion许可尚未接入：SEA 基底取Build Machine Node Version，而 `runtime/sources.json` 只登记 22.16.0 与 24.14.0，CI 浮动 Node 24 时会因Missing对应Original text而无法构建。开发态 `tsx src/main.ts` 不经过发行入口。
- Search tools:Preparation后的每个ToolsTable of Contents包含 `THIRD-PARTY-NOTICES.txt` and `SOURCES.json`（inner网镜像下载与仓库Archive两条Preparation路径都Write，CacheHit也Refresh）。SEA 同时嵌入这些材料。producer 打出的 tar/zip 仍只含Two进制，保持与已固定 SHA-256 的Archive逐Character节One致。
- 远端 Node and独立 Server 的 node-runtime 组件：`LICENSE.node.txt` 与 `NODE-SOURCES.json`。CacheHit也Refresh材料。Server、Agent、Plugins与SearchTools的独立组件分别附带适用声明，在计算组件哈希前CompletedCopy。

`THIRD-PARTY-NOTICES.md` 与 `inventory.json` 已在冻结Install后按Current锁File重New生成，基础许可Label识与声明New鲜度CheckPassed。开源导出流程会再按开源树的实际依赖重New生成，两棵树不共用生成Result。

基础CheckPassed不代表材料缺口已Close：`inventory.json` 的 `reviewRequired` 仍Retain待补齐的Original textandSourceEvidence。Current覆盖的Exact包Version、Copy组件与待核验Quantity以生成清单为准，避免DocumentationMedium的历史Quantity被误当作CurrentStatus。

```sh
pnpm install --frozen-lockfile
node scripts/licenses.mjs notices
node scripts/licenses.mjs check
node scripts/licenses.mjs check --strict
```

严格Check目前只作为显式CommandRun，尚未接入 SEA 的 CI Publishand手动 SMB 上传入口：Current清单仍有已登记缺口，接入后这两条Publish路径会立即Failed。Local构建仍Available于核验修复，基础Check会明确Notice未解决Quantity。

生成器以根锁File的生产依赖图为覆盖集合，先比较实际Install图，再按ExactVersionReadinner容；OldInstall图必须先 frozen install，不能直接重生成。Label识门禁and声明生成共用递归扫描，覆盖所有 workspace、嵌套Versionand符Number链接，并按真实Table of Contents防环。E同Original text按 SHA-256 去重；同名不同Version分别记录。支持的平台Optional包必须已Install。Three个未Install Canvas Target（Android、Linux armv7、Linux riscv64）不属于CurrentDesktop发行Target。

审核并Submit通知and `inventory.json`。清单同时记录锁File、manifest、补丁、CopyFileandSupplement材料的哈希；Version变化or声明被截断会使显式CheckFailed；构建只Read已有声明，不因此Medium断。该Check确认材料New鲜度与许可Label识，不Auto证明所有发行义务已经履行。

WorkspaceInput的New鲜度哈希k CRLF 统One为 LF，Compatible Windows checkout；上游Original text快照、ArchiveandFinal发行声明仍按RawCharacter节校验。

`npm-overrides.json` SavePublish包Missing材料时采用的固定上游Source与Original text SHA-256。Upgrade这些包时需要重NewCheck对应Version；不得把Legacy version本材料直接套用，也不得编造版权人。`upstream/` and `native-search/licenses/` 为Original text快照，不要Run格式化Tools改写。

`native-search/sources.json` 对应Current 18 个Archive：Desktop/SEA 的 bfs 4.1.1、ugrep 7.8.4、ripgrep 14.1.1，以及远端 macOS 的 ripgrep 13.0.0。链接依赖包括 Oniguruma、PCRE2、Compact库、Rust crate andRun库材料。Cargo.lock 的Collect范围保守包含Optional、构建andTests依赖，不代表所有库都链接进每个平台。

ugrep 的 BSD-3-Clause 版权、条件and免责声明CompleteRetain。ripgrep Retain MIT/Unlicense 两份Text，zstd 采用 BSD 选项；GCC Run库Retain GPL Textand Runtime Library Exception 3.1，不把这One例outer误写成要求应用整体采用 GPL。Sharp/libvips 由真实 Computer Use 包引入，声明Retain LGPL-3.0-or-later 材料，其Built-in库Original text缺口Continue登记在待核验清单Medium。

Upgrade原生Tools时，先Check构建Configurationand源码包，更New组件Version、上游 URL、源码校验Valueand实际许可File；再更New `sources.json` 的Configuration哈希。生产者打包会Check组件Version，打出的Archive同时附许可材料。Archive的Final SHA-256 在包outer维护，不能把含有自身哈希的File放回同OneArchive。更New仓库ArchiveandConfiguration pin 后，再更New材料Medium的Two进制InputArchive记录、重New生成根通知，并Check各平台Preparation产物。

仓库已有的 18 个InputArchive保持Raw校验Value，其许可材料随源码仓库Save在这里；不要脱离声明单独转发OldInputArchive。Preparationand重New打包后的Table of Contents/Archive会自带通知，`SOURCES.json` 额outer记录实际Two进制哈希。

- ARMS 按Current生产依赖图进入声明，部分Raw材料仍待补齐；不沿用Other分支已移除它的结论。`@dukelib/sheets-wasm@0.1.21` 已取得 `wasm-v0.1.21` 对应 commit 的Raw LICENSE。
- Current有 21 个包未取得对应Version的Complete LICENSE File，RetainPublish方许可Label识、可取得的 README 许可段及Label准条款，逐项记录在 `npm-overrides.json` 的 `evidenceKind` Character段。`reviewEvidence` Save本次 npm Archive哈希及可取得的固定上游树Evidence。Label准条款不能冒称上游Raw版权声明；它们Continue出现在清单的 `reviewRequired`，严格CheckFailed。其Medium 6 个Yes sharp 预编译的 `@img/sharp-libvips-*`（只由真实 Computer Use 包引入）：Publish方只声明 LGPL-3.0-or-later，并在 README 许可段列出 aom、cairo、glib 等About 28 个Built-in库，各Built-in库对应Version的Original text尚未Collect；Label准条款取自 SPDX license-list-data v3.27.0（其 LGPL-3.0 Text已inner含 GPL-3.0 全Text）。
- `embedded-components.json` 记录 Canvas 0.1.100 的 Skia 子模块and quickjs-wasi 2.2.0 的 QuickJS-NG 子模块固定 revision 及CompleteOriginal text。现Filled充固定 Skia DEPS Medium的Font、Image、Compact库材料，以及 QuickJS 的 WASI libc、LLVM runtime、Mbed TLS、Project Everest and Ada URL parser 材料；`buildEvidence` Save构建脚本and SDK submodule Source，按Original textCharacter节校验。Mbed TLS 采用 Apache-2.0 选项，FreeType 采用 FTL 选项。各平台FinalTwo进制、Rust/C++ Run库及All嵌套依赖的对应关系仍未Completed核验，两项 reviewRequired Retain。
- 原生Source清单Medium的 Rust Label准库 revision `6a6eaca656978778f7c1c750ee0c3db87f8bffb2` 尚无Original text快照。本次从两个 Windows ripgrep InputArchive的 PE File重New提取出Identical revision，但公开 rust-lang/rust 无对应 commit；没有用Other Rust Version的材料替代。连Same as above述 npm 包、Copy源码、inner嵌组件与链接SourceIssue，`inventory.json` 的 `reviewRequired` Current共 25 项。
- shadcn、AI Elements、Fig 注册表and Material Icon Theme 的CurrentFile及核验许可证均已记录。Current checkout 没有最初Copy revision，因此 `importRevision` 为 null；固定的许可参考 commit 不冒充最初CopyVersion。
- 预编译原生Tools的编译器/PCRE2 String与构建Input已记录。musl 的Exact补丁Version未能从现有Two进制恢复，Retain上游 COPYRIGHT 参考并明确Label记。源码Configurationand材料清单不等于每个平台FinalInstall包的Complete链接Audit。

FinalInstall包仍应Passed发行流程实际生成并Check；本Table of Contents不把类型CheckPassed、动态加载or“未修改”当成 LGPL/MPL 等许可义务的通用豁免。

`runtime/sources.json` Save Node 22.16.0（远端）and 24.14.0（Current SEA）的固定VersionOriginal textSource与 SHA-256。Upgrade Node 时必须先更New对应材料。Electron Original text来自构建Medium实际下载并解包的Target平台Archive，不用宿主 `node_modules/electron/dist` 替代。DesktopConfiguration的 `afterExtract` 在 macOS 清理前Copy材料；`afterPack` 不execute许可校验。验证时应覆盖该Configuration hook。

`copied-components.json` YesCopy content的登记入口，`inventory.json` Save对应File、固定上游参考and SHA-256，根 `THIRD-PARTY-NOTICES.md` 由生成器OutputRaw版权及许可Text。最初引入的 commit 未记录时Retain `importRevision: null`，不把本次核验的Version当成最初Version。

Knip Documentation镜像现已登记：Raw导入的 169 个File与上游 Knip 6.0.6 的固定参考Submit逐One匹配，补齐 ISC Original text；随镜像Copy的 Source Sans Pro 与 Hack Font按FontinnerVersion单独登记Raw许可。Source、Version与Local改动Description见 [镜像 README](../docs/knip/docs/README.md)。

Apache-2.0 Copy contentMedium的 148 个已确认改编File包含FileinnerSourceand `Modified by CodeFusion:` 声明，并登记到 `modifiedFiles`；生成时校验该声明仍存在。Markdown frontmatter、脚本 shebang and JavaScript directive 保持有效。未确认源自上游的自有File不Append上游归属。

| inner容                                  | Local范围                                                                                           | 上游许可与修改Description                                                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| shadcn/ui                             | `packages/ui/src/components/ui/`、`packages/ui/src/styles.css` 的上游衍生部分                      | MIT；Local修改包含样式、国际化and组件组合，自有组件不归属于上游。                                                                                      |
| AI Elements                           | `packages/ui/src/components/ai-elements/`、`.agents/skills/ai-elements/`（含 references、scripts） | Apache-2.0，Copyright 2023 Vercel, Inc.；Local修改包含样式、导入路径、组件扩展及Skills使用Description，参考 commit Medium包含SkillsBody。                            |
| agent-browser、dogfood、electron Skills | `.agents/skills/` 下对应Three个Table of Contents                                                                   | Apache-2.0，Copyright 2025 Vercel Inc.；固定 v0.20.0 的实际 commit Check原Skillsand LICENSE，LocalDescriptionand使用About定有修改。                                  |
| VS Code IPC 与基础Tools                | `packages/rpc/src/`、`packages/rpc/examples/` Medium的衍生部分，及 `wire-codec.ts` 对该传输格式的适配  | MIT，Retain Microsoft Raw版权行；Local进行了模块拆分、传输扩展、注释and封装修改，不k所有LocalImplementation归属于上游。                                           |
| Superpowers Skills描述                  | `packages/ui/src/lib/builtinSkillI18n.ts` Medium的 Superpowers 描述及翻译                              | MIT，Copyright (c) 2025 Jesse Vincent；对应上游 v5.1.0。原PluginsTable of ContentsCurrent仅余 LICENSE，不声明仍分发已Delete的整包Implementation。该FileOtherSkills描述不在此授权范围。 |

已Check `@pierre/diffs@1.1.22` 的实际Install包：生产依赖声明已经包含其 Apache-2.0 Label识及Raw LICENSE，不另造One份重复声明。

- React Best Practices：上游 `vercel-labs/agent-skills` 的固定参考 `063bee94c3f4df8453406c830b0a7df0f2860278` Medium，根 README 与Skills frontmatter 声明 MIT，但树Medium无Complete LICENSE File。RetainLocal Shu Ding / Vercel 署名；未编造上游版权年份or许可证Original text。现已登记到 `copied-components.json`，参与Input哈希and严格门禁。Source：[README](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/README.md)、[Skills声明](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices/SKILL.md)。
- `webfetch-processing.ts` 的清单判词称其Prompt来自 Gemini CLI，但本次取得的上游 `cfbcaa8df13ea4610bb379b377b56d62980c0032` 的 `web-fetch.ts` 未找到被Point to认的句子；无法据此Add Google 归属并宣称Issue解决。
- Windows Browser导入Medium的解密Implementation、MixedSourceSkills描述、商Label资产andCompatible层的授权/SourceIssue，需要各自的Evidence，不能PassedAppend通用 NOTICE Close。
- 原清单提及 `apps/cli/.agents/skills/` 下的Skills，但该Table of Contents在Current checkout Medium不存在；锁FileMedium残留SourceLetter息不代表还分发那些File。

待核验条目以Current `inventory.json` 的 `reviewRequired` 为准。其余Source疑点尚未证明属于Third-partyCopy，不凭E似性推定权利人；需要另行Check。基础声明New鲜度CheckPassed不代表这些BoundariesIssue已经解决。具体规则与验收见 [SPEC.md](SPEC.md)。

基础Label识Check只对下列ExactVersion接受原Publish方的 `MIT/X11` Label识，不扩展通用 allowlist，
不把Label识视为Complete上游许可Text。UpgradeVersionor许可Character段变化后重New阻断。

- `buffers@0.1.1`：npm 包Missing许可Character段。原作者在
  [固定Submit](https://github.com/bitpay/node-buffers/commit/1b745ee35d33eb166e15ef1866073a07c6d7de87)
  为同OneVersionSupplement `license: MIT/X11`。该Submit的 `index.js` 与Current冻结Install的Publish包逐Character节One致；
  SHA-256 为 `97801e296ba5f3c32242f647e1daac5917e300367fed7935ab1e62f40adb1b8a`。
  Raw metadata 快照Save在 `upstream/buffers-0.1.1-package.json`，SHA-256 为
  `eb42a43d5b685e6de2f2f4a5e18a70255be72349def7eedf504b912dd908913e`。
- `chainsaw@0.1.0`：冻结Install的 npm 包自身声明 `MIT/X11`；RetainRaw metadata 快照
  `upstream/chainsaw-0.1.0-package.json`，不覆盖Publish方Character段。

这两个包由表格解析构建依赖引入；Current生产依赖图未包含它们。若以后进入发行产物，
仍须Collect该Version的Complete许可Original text。现有 `reviewRequired` 材料缺口ContinueRetain，严格Check不得绕过。

`@fontsource/noto-sans-sc@5.3.1` 的随包许可为 `OFL-1.1`；Original textSave在 [Font许可快照](upstream/noto-sans-sc-5.3.1-LICENSE.txt)，SHA-256 为 `18aabf190848725e2576eefb5c29ba06aac1029d02132252a7f312eac2e50cf3`。Official条件见 [SIL OFL 1.1 Original text](https://openfontlicense.org/open-font-license-official-text/)。

该依赖由 `office-runtime` 声明为构建依赖。PDF Plugins构建从 `400.css` 选择原有 WOFF2 分片并原样Copy，不改Fontinner部Name；`apps/cli/packages/office-runtime/scripts/build.mjs` k随包版权与Complete许可WritePlugins的 `THIRD_PARTY_NOTICES.txt`。Font作为Plugins资源分发，ContinueRetain OFL 许可，不单独SalesFont。

许可门禁仅登记这OneExact包名、Version与许可Label识；Other包、Versionor许可仍需核验。此记录不替代FinalInstall包Audit，不Close既有材料缺口。
