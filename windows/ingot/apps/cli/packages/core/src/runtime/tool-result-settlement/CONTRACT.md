
登记既有 `settleToolResults` Boundaries，Retain原方法路径与调用方式。契About复用方法类型，不增加execute器、StatusReplicaorPersistenceSteps。

```text
整批executeResult → 同步Write两份 Runtime 历史 → 原有异步Persistence与恢复锚点
```

- Runtime 仍Yes历史唯One所有者；调用方传入原 callID、Tools声明andResult，不再次Execute tool。
- DeferredToolCall 的包装Label记随TargetResultSave；Model投影与冷恢复Continue使用原链路。
- PersistenceFailed不能留下仅有调用、没有Result的进程inner历史；Cancel沿用现有整批Wrap-up规则。
- 本次登记不改变Desktop continuous or手机 replayable 投递。

Run时回归位于 `tests/runtime-tool-result-settlement.test.ts` and `tests/runtime-streaming-tool-part-identity.test.ts`。
