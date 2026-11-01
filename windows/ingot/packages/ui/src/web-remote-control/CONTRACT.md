# web-remote-control-ui

展示Desktop远控Status、Device导航，并转发 OAuth CompletedEvents。

宽窄屏共用 TaskViewReporter，从Submitted的CompleteTask导航、实际聊天表面与 Page Visibility 派生View声明；首页、Draft、Background、遮盖与卸载Clear声明。View Reporter and手机 Home/chat Status由稳定的 Shell 持有，断点变化只替换布局inner容；初始聊天意图不随断点重复execute。最后导航Location与瞬时View分开，不Save另One份导航，也不写Task未读。Main 校验Connect与 bridge 后交ToDesktop唯One writer。详见 [TasklistRefresh语义](../../../../docs/task-list-refresh-semantics.md)。

dialog 只Retain UI 投影；Main 重读凭据，OAuth ServiceYes认证唯One事实源。身份比较必须同时Check workspaceKey 与 remoteSessionId。弹窗经 index 暴露，Device header 与 auth hook Yes独立入口，避免引入Irrelevant UI。

Complete语义见 [Relay V2 spec](../../../../docs/web-remote-control/relay-v2-pairing.md)。
