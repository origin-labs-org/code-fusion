# plugin-sandbox

Electron Main 适配层，拥有沙箱inner容、guest、端口andBrowser分区。Host 登记适配器仅转发Request，不拥有Task事实。

- 登记Bind实际 Host attachment 的 ownerWebContentsId、workspace、session、server、scope and Agent Run凭证；同凭证重复登记Back不可变句柄，不覆写 HTML。sandboxId/initId 仅Service单次 Electron Lifecycle。
- partition 为 `persist:plugin-sandbox-v2-<hash(appIdentity)>`。shell/plugin 两个不同 origin 都由可Letter appIdentity 派生；随机 sandboxId 位于资源路径。Chromium 的顶层站点Storage键必须稳定，才能使 localStorage/IndexedDB 跨进程恢复。
- 稳定 origin 不授予资源Permissions。protocol 校验 origin、Instance路径and登记；session RequestCheck实际 guest 与TargetInstance；will-attach-webview 验证 owner、partition and句柄。重载、销毁与越Boundary导航UndoOld登记。
- guest 固定 contextIsolation/sandbox/webSecurity，禁用 Node、子框架 Node、webviewTag、plugins、dialogs/popups。MessagePort 在受Letter guest 就绪后分发，shell 只转发 JSON-RPC；Old端口不能替代NewInstance。
- CSP 使用 default-src none；资源域、Connect域、frame 域按声明派生。frame-ancestors 只Allow该稳定 shell origin；form-action none。既有 cf/csp 扩展只放宽 unsafe-eval/wasm-unsafe-eval，不增加BrowserCapabilities。
- 原生 camera/microphone/geolocation/clipboardWrite 仍按资源声明and既有确认策Omitted授权；Bind实际 guest/frame、owner、Run凭证，异步确认andSystem authorizationBack后再验证。InvalidPages的确认不能授权替换Pages。
- guest Input产生 5 秒One次性手势 token。CloseInstance同时释放 ports and实际 guest，partition 持久Retain。
- 上限 64；Main 不抢占OtherWindowor刚Preparation的Instance，只清Expired且未被 guest pin 的登记。Renderer owner Decide业务回收；容量不足明确报Wrong。
- `setExecutionActive` 仅接受宿主 sender 对Current sandboxId/initId 的 MCP Request，Gen UI 不接入。复用Target guest 的可逆 capturer Events，不改变全WindowBackground节流；登记Undo、guest/owner 销毁释放Events。Renderer page owner 按RetainPages的可见性RequestEvents，不根据 session executeStatusStopPages；Main 不Save第Two份业务Status。
- Undo登记先关端口，再由 Main 单次导航 guest 到 about:blank，WaitingOldPlugins frame 移除后 close；IPC dispose Waiting同One个Stop Promise。Electron 附着 webview 的 destroyed 可能仅释放包装对e，不YesStopPagesWrite的屏障；Plugins beforeunload 不能阻止宿主释放。
- Clear all data先阻止New登记、Undo登记并Waiting所有 guest Stop（含已在 dispose 的Instance），再 clearStorageData/clearCache，覆盖所有NewOld MCP App 分区。StopFailed不能ContinueReport清理成功；flushStorageData 不YesCompleted屏障。平时RetainOld v1 分区，不迁移orAuto合并；本模块不访QuestionPlugins SQLite or业务File。

公开入口 `index.ts` 不暴露 registry/preload/assets。Main 不execute MCP Permission policy，不SaveSession、Queue、widgetState；受Letter Host 提供已验证 HTML 与InstanceBind。

稳定 origin 下所有InstanceProtocol响应（包括 shell、alias 与静态脚本）必须使用 `Cache-Control: no-store`。PagesStorage仍Persistence，但响应Cache不得绕过实际 guest 与Instance路径校验；真实 Electron 验证必须同时包含冷RequestandCacheHit候选。

Gen UI 的 CSS/inner kit 使用 Visualize Plugins的同One份固定资源，构建Copy到沙箱资源Table of Contents，Main 在BackDocumentation时注入；不再在 guest 里execute另One套 Widgets。bridge/Tweak 先于作者Segments，inner kit 后于Segments。Floating UI、Lucide、D3 的固定 CDN script URL 在 Gen UI partition Request闸门inner映射到同OneInstance的随包File，按 `vendor/manifest.json` Exact匹配，不扩大 CSP or开放任意File。缺失FileFailed，不回退Network；Retain现有脚本加载顺序，D3 仍按需。Tweak 的私有回调经现有 Gen UI 方法，不向Pages开放 callTool。MCP Documentation不加载or重定向这些资源。

资源Complete性由 Visualize 的 `assets/runtime-manifest.json` 维护，Structures仅为 `files → File名 → sha256`，记录Current CSS、inner kit、calendar and Tweak File的 SHA-256。Desktop资源TestsCheck实际CopyCharacter节与清单；Tweak 注释Changes也需要同步哈希。资源NameChanges须同时更New Desktop、CLI SEA、Remote预构建、Service端Remote部署与Plugins seed 校验入口；Missing清单or必需File仍按现有规则Failed，不回退到OldName。Plugins的许可入口统One为 `skills/visualize/LICENSE.md`，Retain许可限制与Third-party依赖声明。

Offline依赖Continue由 `assets/vendor/manifest.json` 记录固定 npm Version、包Complete性、脚本及许可File哈希。更New时Check包Complete性、提取声明的分发Fileand许可证，再更New哈希；Desktop 与独立导出共用这些File，导出脚本k其嵌入为 data URL。验收覆盖Copy资源的哈希、各打包清单路径存在性与许可入口可解析性；交互andSessionStatus契About不变。

Host preload enables state-preserving atomic moves only for explicitly marked sandbox webviews. The hook is installed before Electron registers its custom element; ordinary detach/disposal and unmarked webviews retain their original behavior. Main copy-image IPC validates sender owner, sandboxId/initId and bounded content/viewport geometry before and after native capture, crops using the actual image scale, and writes the native clipboard. It exposes neither arbitrary guest IDs nor image bytes to untrusted page code.

`contentKind: "gen-ui"` 由Desktop Host 签发独立凭证，不要求 pluginId/serverName，也不能携带原生Permissions。使用inner存分区 `gen-ui-<appIdentity>`；跨重开恢复依赖 Gen UI Service，不依赖BrowserStorage。HTML outer壳包含先于作者脚本execute的已转义Status快照与专用 `gen-ui.js`，不注入OldCompatible桥。Connect、子框架and表单Submit禁用，静态资源限制为 Gen UI 固定域。其余 owner、guest、端口、手势andUndo机制复用本契About。
