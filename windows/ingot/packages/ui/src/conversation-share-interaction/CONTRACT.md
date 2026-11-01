
该模块Connect分享浮窗、范围事务and预检Request。公开入口分别对应Boundary面展示、store 动作工厂andRequest响应Processing；消费者不得从未登记File导入Implementation。

- 范围Draft唯One owner 为 conversationShareSelectionStore：勾选只修改 pending，确认Submit，Cancel回滚；Close、Session切换与Publish锁定沿用既有语义。
- 预检Cache与PublishStatus唯One owner 为 SessionPane。模块接收引用及回调，不Retain第Two份Cache，不写Data库。
- Request按代际Invalid，effect 清理阻止Old响应写回；响应Processing还校验Current scope。条目构建成功后才Submit元Letter息，Processing异常Write可Retry阻断。
- 顺序：User勾选 → store Draft → SessionPane 发From预检 → Current代际SubmitCache → 展示CheckResult；确认后才改变Final范围。
- 浮窗使用outer部受控Status；Publish时禁止Close，选择期间 Esc 只Cancel范围Draft。Mobile Remote Control不增加分享入口。
- 拆分入口避免 store 消费方为了加载动作工厂而加载 React View。Shared UI、国际化、Logs与Service类型Passed既有依赖访Question。
