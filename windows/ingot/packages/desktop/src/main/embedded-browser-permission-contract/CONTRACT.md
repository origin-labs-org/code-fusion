
现有 `applyEmbeddedBrowserPermissionPolicy` Yes Electron partition 的装配入口。初始化Waiting站点Permissions记录加载，再注册 request/check/device handler；每个 partition 只装配One次。

站点PermissionsManage器持有持久授权，Current policy Instance持有Session授权and待决Request。request 与 check 都按Label准 URL origin Query；路径and尾斜杠不改变站点，Protocolor主机不同则Isolated。未授权敏感Permissions交To注入的 prompt，UnknownPermissionsDeny。

```text
Electron request/check → Label准 origin → 同One授权记录 → Allow / Deny / User决策
```

Device选项与PersistencePassed已有 desktop 模块Completed。本模块不改变Permissions清理、主Window路由or跨进程Protocol。回归见 `packages/desktop/test/embeddedBrowserPermissionPolicy.test.ts` and `packages/desktop/test/e2e/browser-permission-prompt.test.ts`。
