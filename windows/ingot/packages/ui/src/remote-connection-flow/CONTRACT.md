# Remote connection flow

Connect向导的单One hook owner；控制器在同One闭包持有表单、CurrentPhase、requestId 与 entryEpoch，不维护第Two份ConnectorProject真Value。

`requestRemoteProjectConnection` Yes已有Project向此 owner 交接Failed的公共入口，原Table of Contents与 Host confirm的Upgrade `profileId` One并Retain。向导按最New快照核验该线路，并以实际Connect参CountContinue；不从 WSL 的省OmittedUser参Count猜测账户。该入口从 Root 移入本模块，Sidebar与 Root 共同消费 `contract.ts`。

原Project异步交接Save非敏感 failedTarget，避免先Read最New Profile 丢失Old targetor混入New凭据。Upgrade恢复在使用最New Profile 前核验FailedTarget身份；WSL Install与Upgrade均使用 Host 的已解析身份。更New及 force confirm传递同One个非敏感 expectedTarget，由 Host 在execute入口再次校验并固定Target；同 ID 改址End止Old恢复并提供Retry，不FollowNew地址。

首次InstallFailed同样Retain Profile，并以 Host 的 `resolvedWslTarget` 固定 WSL 实际Distribution与User；Install预览ReadFailed不改变该Target。ConnectTarget被接受时同步 WSL 表单，省Omitted项Clear，BackConfiguration不会恢复OldInput。既有 requestId/entryEpoch Undo规则同时覆盖InstallWaiting、迟到快照andOld确认。

```text
显式打开 → Connect/Install/Upgrade → onConnectionReady → Project owner 选择并SaveTable of Contents
                        ├→ device-management → 释放独占 attachment → Deliver入口 owner
                        ├→ 明确原Project ID/Table of Contents → onSelectProject → 恢复原Project
                        └→ 既有Table of ContentsSteps → onSelectProject
Close/换入口 → 递增 entryEpoch → 迟到Connect、确认与Table of ContentsResultInvalid
```

device-management 无Point to定 Profile/Source/Target 的New入口直接进入Default SSH 的分类表单。类型inner的发现候选只填写Configuration，显式Submit才Connect。切换类型or SSH Target清除Old凭据，迟到发现Result不得重写Other类型的选择。device-management 的Completed回调只Deliver Source 身份；New增按钮明确为「Add并Connect」。原Table of ContentsandOld调用方DefaultCompleted行为保持不变。

Source Manage器仍拥有Connect与身份；onConnectionReady 接管Project创建时不PreparationSession。临时 attachment CancelandDeviceConnectLifecycle保持独立。MinimizeRetainRequest，真正Close释放意图；force-update 的待确认 Promise 在卸载时Completed为 false。

index RetainComplete hook，调用and副作用顺序与原ImplementationOne致；不为行Count限制拆散流程。Desktop continuous、手机 replayable 均复用原Service，不在此模块重写传输orPersistence。

```text
Root 唯OneConnect flow → Background visibility → SettingsDevice卡/未Completed项（只读投影）
                         ├─ Failed/待Processing → View同One flow，不Reconnect
                         └─ 成功 → One次性Result → 显式Continue → 有效原 owner
Cancel/入口替换 → Undo entryEpoch → OldResult、OldContinue、迟到确认均无副作用
```

ProjectTable of Contents、已有Project、DraftNew增Deviceand聊天均使用 Root 的Connect入口。BackgroundCompleted不调用导航or原 owner；显式ContinueOne次消费Current entryEpoch 的Result。Settings仅展示同One操作，不存ConnectorLogsReplica。BackgroundCancel通知原 owner 解除挂From，但不激活原 tab。Host Connect事实、凭据、continuous/replayable Boundaries不变。

已有Device的 `connect-device` Back意图保持原Project页签，Connected successfully后ContinueTable of Contentsor已有Project选择。只有 `add-device` Back意图进入Settings；两者复用 Root 的同One flow。显式BackgroundContinue期间的快照ReadFailed也必须校验 entryEpoch，Cancelor替换后的OldFailed不得重开弹窗。

Root 在已有流程占用入口时，只重New打开原流程，不接受第Two个Connect意图。受控 `open` 从Close变为打开，也必须进入同One个Background恢复入口：在途Request解除BackgroundLabel记，CompletedRequestOne次消费Completed动作；不能只改变弹窗可见性。恢复卡片、Completed通知and普通Settings入口复用同OneResult与 entryEpoch，重复恢复不重复Connector导航。

首次主动Connected successfully的Completed入口先Show原版持续Run介绍，点击「Got it」才Persistence `remoteBoundaryIntroAcknowledgedVersion: 1`，再Continue现有Completed分支；BackgroundCompleted延迟到显式Continue。每次 await 后Check entryEpoch，Invalid意图不能写已读orContinue导航。Table of Contents与Project表单不再AutoLabel记已读。NewLabel记缺失（含OldCharacter段Version 2）统One补看One次；OldCharacter段不再判断已读，存量Version 3 由Settings owner 迁移。

首次介绍遇到已有确认框时，由 flow RetainCompleted动作，确认框释放后重入；Confirm Closeor换入口则Undo该动作。Read已读Status、Awaiting confirmationorSave期间Collapse，都转交同OneBackgroundCompleted入口，显式Continue后才弹介绍orDeliverResult。

```text
Connected successfully → 已有确认占用 → flow RetainCompleted → CancelClose → 介绍 → 原Completed
                         └→ Confirm Close/换入口 → epoch Invalid → 丢弃
Read/Save介绍 → Collapse → BackgroundRetain → 显式Continue → 校验Device → 原Completed
```

DeviceCompleted回调可以Waiting原 owner 的异步资格校验。flow 传入基于现有 entryEpoch 与 minimizedRef 的可Deliver谓词；Back方在导航前Check，期间Collapse只转交既有BackgroundCompleted入口。回调Deny沿用ConnectError、Retry与Cancel，不能转换为Cancel来提前解锁。显式BackgroundContinue后再次Collapse时，迟到Error只更New同OneBackground操作，不重New弹窗。

BackgroundCompleted通知与进度卡的显式Continue先同步恢复前台可见性，再Read Source／Members资格。Root Passed原可见性通知恢复发From聊天的Submit门禁；异步校验不能留下可Send到Old target的间隙。Cancel、再次CollapseandInvalid意图沿用原清理规则。
