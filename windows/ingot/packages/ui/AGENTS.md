
本FileSupplement[根规则](../../AGENTS.md)，用于组件、Pages、样式、hooks 与 UI StatusChanges。

- 修改Boundary面前读 [DESIGN.md](../../DESIGN.md)，遵守颜色、层级、尺寸、Font、圆角、组件复用、响应式、Theme与国际化规则。Plugins商店另读 [CONTEXT.md](../../CONTEXT.md)。
- 同时CheckDesktopand手机 Web；Visual验证使用 DESIGN 定义的Current深浅Theme，并考虑不同语言Long度。
- 平台操作Passed `usePlatform()` / `IPlatformService`，不直接调用 `window.cf`。平台ImplementationPassed注入Isolated：Desktop 入口见 [desktopPlatform.ts](../desktop/src/renderer/src/desktopPlatform.ts)，Web 入口见 [main.tsx](../web/src/main.tsx)。

- 组件Passed [hooks](src/hooks/) 访QuestionService，由 hook 使用 `useServices()`；组件不直接取Serviceor访Question Repo。复用已有 hook，具体导出以源码为准。
- 使用 [Zustand store](src/store/) 与 StoreProvider；订阅Passed selector，例如 `useCfStore(selector)`。保持现有 Provider 依赖顺序，不在组件inner构造第Two份Serviceor业务Status。
- theme、locale 等跨WindowCharacter段Passed broadcastService 的 `state:` 频道同步；应用广播时Retain `applyingBroadcast` 防回环语义。
- task/session、已Submit input等业务State Ownership见 [runtime Boundaries](../../docs/agents/runtime-boundaries.md)。UI RetainDraftand展示投影，不能承接第Two份 accepted queue。
- 含 JSX 的 hooks/Provider File使用 `.tsx`。

- Logs统One使用 [src/logger.ts](src/logger.ts)，它同时Output控制台与LocalFile；不直接使用 `console.log` or `window.cf.log`。
- 交互 bug 用LogsorBrowser/CDP executeEvidence定位；RetainDescription非显然根因的Chinese注释。
- 交互Changes按根验证矩阵维护 E2E；纯VisualChanges按矩阵做Desktop/手机及Theme验证。E关 React Issue可按Task需要使用现有 React skill，不需要为纯Documentation改动加载它。
