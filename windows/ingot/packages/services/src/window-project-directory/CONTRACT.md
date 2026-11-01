
`windowProjectDirectory` Yes整体Optional的WindowTable of ContentsCapabilities。Project读写与远端Members入口复用 owning Window Host 的现有Service；只读变化流只转发该Window的 `state:projects`。不SaveProject、MembersorTask Status，不暴露Complete broadcast Write与 claim。

Three个频道为 `window-project`、`window-remote-projects`、`window-project-changes`。Host 在手机 replayable 的 remote attachment 上Complete装配后暴露；原WorkspaceService与Desktop attachment 不变。Customer端只根据 bridge 的显式Capabilities创建整组 proxy，在Pre-release调用变化Service `getCapabilities` 并验证 `version: 1`。缺Capabilities维持Legacy version行为；已声明Capabilities但缺Serviceor就绪Failed明确Deny，不能静默切回 Source Table of Contents。

订阅直接沿用原Window broadcast；Cancel订阅释放原 listener。bridge 换代由调用者清理Old proxy 与订阅，不增加独立 attachment、Retry、PersistenceorTable of ContentsCache。
