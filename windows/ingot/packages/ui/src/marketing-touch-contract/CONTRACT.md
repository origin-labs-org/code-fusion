
`createMarketingTouchController` Yes同步工厂。每个控制器独占其 banner/dialog、generation、待展示资源与动作Status。Query、Preparation、上报、executeandRefresh由调用方注入；UI 观察同One个 store，不另存已确认Eventslist。

```text
User动作 → CloseCurrent展示并作废OldQuery → execute动作 → 异步上报 confirm
                                              └─ Claim成功 → Refresh资格
```

outer链、导航andCopy不改变资格，不立即Refresh，避免异步 confirm 前重NewQuery并打开OldEvents。以后Service端再次投放仍可展示。dispose 作废未CompletedQuery并释放资源，Old回执不得重New打开弹窗。

回归见 `packages/ui/test/marketingTouchController.test.ts` and `packages/desktop/test/e2e/ui-shell/marketing-touch-delivery.test.ts`。本次登记Retain原入口and依赖方向。
