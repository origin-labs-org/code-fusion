# Conversation Session Manual Review E2E

`manual-review/pending/` Save尚未Completed人工产品预期确认的 conversation case。

> **V4 formal gate 清理（2026-07-11，Task 2）**：又有 32 个实际调用
> `prepareConversationE2E()` 的 legacy formal spec 原样移动到 `pending/`，没有Deleteor改写
> 业务断言。Current conversation-session 共 121 个 spec：formal 29 个、pending 92 个；
> formal 已不再Exact导入Old聚合 helper，也不再调用 `prepareConversationE2E()`。
> 这 32 个 moved spec 只Retain为后续按领域迁移的语料and人工 review 入口，不YesCurrent V4
> formal 门禁Evidence。

> **v4 硬切降级Label记（2026-07-05，删波次 1）**：原主Table of Contents的All 41 个门禁 spec 已整体迁入 `pending/`。
> 原因：v4 竖切后Old UI（`ChatView` / `TID_CHAT_*` testid）已Delete，这些 spec 的 DOM 断言AllInvalid；
> 按 `docs/v4-refactor/11-deletion-plan.md` 的处置，case 的产品语义仍以
> `docs/conversation-session-case-catalog.md` 为权威，M4 期间按 catalog 逐条以
> v4 testid（`TID_V4_*`，见 `packages/shared/src/test-ids.ts`）重写后移回主Table of Contents，coverage matrix Evidence同步重建。

这些 spec 的职责YesAutoexecuteUser路径、留下 UI / network / log / session artifact，方便人工逐条 review。它们不属于Default conversation 质量门禁；review Completed并补齐OK性断言后，再把对应 spec 移回 `packages/desktop/test/e2e/conversation-session/`。

转正流程and fixture Table of ContentsAbout定见 `docs/testing/conversation-session-e2e-development-workflow.md`。

人工 review DefaultLabel准：除非 case 明确写着要验证 fault / negative / error recovery，否则Run过程Medium出现 `ChatViewErrorBanner` / `ChatErrorBanner` 就视为该正向 case 不Passed。

Run方式：

```bash
CF_E2E_MANUAL_REVIEW=1 pnpm --filter @origin-ai/cf-desktop test:e2e
```

Point to定单条：

```bash
CF_E2E_MANUAL_REVIEW=1 pnpm --filter @origin-ai/cf-desktop test:e2e -- --spec './test/e2e/conversation-session/manual-review/pending/<case>.test.ts'
```

已有 case-local fixture 的 pending spec 可以在转正前execute合同Check：

```bash
pnpm --filter @origin-ai/cf-desktop e2e:fixture:check -- --spec \
  './test/e2e/conversation-session/manual-review/pending/<case>.test.ts'
```

fixture JSON 的 `spec` 固定Point to向 `./test/e2e/conversation-session/<case>.test.ts`，表示未来转正后的
canonical formal target，不重复记录Current pending 路径。已有 case-local fixture 的 pending case Auto走
replay；缺 fixture 的 case 才走 live/capture。Formal与 pending 的覆盖率全量入口Yes仓库根Table of Contents的
`pnpm test:e2e:all:coverage`；只有Configuration了真实 `E2E_PROVIDER_API_KEY` 时，入口才会附带
独立真实 provider smoke，否则会明确Skip该outer部环Context项。
