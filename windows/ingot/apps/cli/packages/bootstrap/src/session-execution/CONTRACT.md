
原生 V4 handler 曾从OldProtocolTable of Contents获取Request鉴权投影与Wrap-up租About，导致Protocol依赖方向倒置。两种入口共用这里的ProtocolIrrelevantCapabilities，OldProtocol只Retain重导出以Compatible存量调用方。

session record 始EndYes residencyFinalizationCount 的唯One owner；租About不能替代 Core 的Command准入与 busy/idle。鉴权材料只对Currentexecute冻结，不能加入可Persistence intent。

```text
入口 → 拷贝本轮鉴权 → 原 record 同步持有租About → execute/Failed → 幂等释放
```

不创建Queue、Cache、定时器or第Two份SessionStatus。同步异常与异步Failed均Retain原Error。
