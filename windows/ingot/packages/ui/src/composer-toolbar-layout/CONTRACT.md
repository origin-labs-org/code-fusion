
登记现有 `useComposerToolbarFit` and `fitComposerToolbar` 的布局职责，Retain原入口andImplementation。

- 只ReadTools栏 DOM 尺寸、更New紧凑Show属性；不持有Model Selection、PermissionsorSessionStatus。
- React hook 统OneManage尺寸及inner容观察器，并在卸载时清理；测量Replica不改变实际控件交互。
- 普通入口与合并Model入口沿用各自已有的收缩顺序；Desktop与窄屏共用同One布局函Count。
- `iconOnly`（单行Input框，Side Pane CompleteView浮窗）：Tools栏宽度随inner容变化，没有可测的Available宽度；不测量、不克隆，按同One收缩顺序直接收到最后One级。Close后回到正常测量并按实际宽度恢复。
- 契AboutTests验证公开布局入口；各档位回归Continue由 `composerToolbarFit.test.ts` 覆盖。
