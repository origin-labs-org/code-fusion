# mobile-ui

复用登录与远控DeviceBoundary面的Brand、平台图Labeland底部选择弹层。

包子路径保持稳定。组件只依赖 props 与既有Theme；不RequestService、不持有Device身份or认证。BottomSheet 沿用 Radix 的可访QuestionName、焦点圈定与Close语义，调用方拥有 open。

Complete语义见 [Relay V2 spec](../../../../../docs/web-remote-control/relay-v2-pairing.md)。
