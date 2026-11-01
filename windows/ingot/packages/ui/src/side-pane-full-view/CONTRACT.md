# side-pane-full-view

Side Pane CompleteView：面板占满Window，Chat成为第One个 tab，并在面板 tab 上方提供浮动InputWindow。行为合同见 `docs/ui/side-pane-full-view.md`。

Invariants：

- 唯OneStatus owner Yes `useSidePaneFullView`，记录按 workspace + Chat owner 存在 `taskSidePaneMemory`；Sidebar、WorkspaceHeader、浮窗显隐都只读派生，不回写原有Status。
- Chat区只有One个 `SessionPane` Instance；宿主只改变定位方式，不移动 DOM、不重New挂载，Draft与Attachment因此只有One份。
- 不覆盖 react-resizable-panels Manage的 panel flex：库以各 panel 的 `offsetWidth` 之and作为 group 尺寸，压成 0 会让 resize 得到 NaN。CompleteViewPassed面板outer框 `absolute inset-0` 铺满 Group。
- controller 对e引用只在Status变化时更New，它会进入 memo 的 WorkspaceShellLayout。

交集：

- `SessionPane` / `ConversationTimeline` / `V4WorkspaceChatArea` Passed `useConversationPanePresentation` Read展示形态并上报RunStatus、Blocking interaction与Input区High度；不在CompleteView下读到Default docked，行为不变。
- 浮窗形态下 `ConversationTimeline` 经 `onLatestTurnSummaryChange` 上报最后One个回合（turnKey、RunStatus、RunDuration、Final answer，同One个 render unit），`SessionPane` 把Duration交To单行Input框占位，把 turnKey / RunStatus / Answer经 `reportFloatingStatus` 交To宿主；宿主按 owner 记录基线并推进Answer气泡（`reduceFloatingAnswerBubbles`）：基线之后出现的已结束回合才弹出，不要求观察到Running。
- 快捷键 `toggleSidePaneFullView` 在 `packages/shared/src/shortcutCommands.ts` Command表登记，Processing器只在Desktop端注册。
