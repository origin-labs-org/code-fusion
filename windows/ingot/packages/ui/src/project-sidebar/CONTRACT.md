
Host projectService 的 readTree Decide行集合、Project归属and CLI 事实镜像；UI 只Save折叠、View与表单Draft。实时 sessions-index 只附加 activity，不补行、不写回归属。Read以Request序NumberDeny迟到Result；workspace/remote endpoint 变化立即CancelOldResult资格。

Settings页复用公开的 `useOptionalProjectDirectory` Read同OneTable of Contents owner；Recent projectsPassed `resolveRecentRemoteProjectPreference` 按 Source + Table of Contents固定唯One入口 ID，Continue既有Project恢复链路。缺失or歧义不生成创建意图，ConnectCompleted仍复验原入口。

恢复时Passed公开的 `resolveEntryProject` 从所属 Host Project树解析有效Project，复用Old入口的唯One匹配规则。原Project ID 显式传To Root Draft owner，同时更Newinner存与PersistenceDraft范围，不从同Table of ContentsCache反推归属。

创建经 Host prepareSession 固化 cwd，Draft持有 projectId，Initial turn前由 Host 原子预留归属。选择OtherProject会重建尚未提升的预热Instance，SubmittedTask不受影响。拖动只发 moveTask，缺 root 经确认Retry，Failed保持原树。软删ProjectRetainTask归属；Timeline可见；恢复需User显式选择同 roots 的已删Project。

Desktopand手机共用组件；沿用现有 task 行操作、shared-host attachment、continuous/replayable 传输。CLI 不接收Project ID。

composer 的“创建Project”复用Sidebar ProjectCreation：Current为RemoteSession时Default该Device，其余DefaultLocal。ProjectServiceAvailable即可创建，不能沿用打开原生Folder的Capabilities门禁。Save只RefreshTable of Contents，Cancel不Write，两者不切换Project/Workspaceor改写聊天Draft。独立DeviceConnect后的创建Continue受Current聊天Back资格About束，普通创建不继承该Device。

远控Mode的Auto未读由 desktop base Table of Contents owner 唯OneSubmit。Main 验证后的 Web 实际View逐Events进入该 owner，同OneTask的Completed写与View读/CAS 串行；ExactRead所属 Source Current marker，不使用listCache。重复View不清手动未读，Old attachment 回包不再Write，Web Shared组件不成为第Two个Auto写者。详见 [TasklistRefresh语义](../../../../docs/task-list-refresh-semantics.md)。

Local machine入口 ID Decide远端可见Project集合，远端 readTree Decide这些Project的权威inner容；OfflineCache只含Nameand roots，不含Session索引。RequestSubmit前重读入口list，Deny移除后迟到Result；Old入口仅唯One cwd 匹配才解析。未Add的远端Project不Auto进入树。同名/同 ID 跨 Host 的Sort、选择and去重必须使用 Host + Project ID。

Web 远端 attachment 的整体Optional `windowProjectDirectory` Capabilities提供WindowProjectService、远端入口Serviceand只读Project变化流。Table of Contents owner One次选择Complete组，Read、修改、accepted snapshot 身份与订阅不可混用Windowand Source；无Capabilities时沿用 base Table of Contents。有Capabilities但就绪校验Failed必须报Wrong。原Workspace project/broadcast Service不替换，非Table of Contents消费者保持 Source 语义。bridge Service换代释放Old订阅并Deny迟到Result。详见 `docs/web-remote-control/wide-screen-task-list.md`。

LocalandRemoteProject平铺混排，DeviceLabel识与Connection Status放在Project行，Connection Status只读ConnectManage器；Offline可Connector移除Local machineMembers，Online可显式选择已有Projector创建并Add入口。选择器 readTree 不Write口，只有User选择/创建成功调用 addEntry。New使用 Host 分配的 workspaceIdentity；同 cwd 不跨 Source 复用 logical attachment。Host 移除后Reconnect不得创建Membersor重建入口。

远端Project prepare/历史 task 已OK cwd 与 identity，导航k两者OneFrom传To原 open-project/Host bind；普通Table of Contents选择才execute canonical resolver。不得再次 realpath 后以Aliases重建身份，不能放宽Bind后Exact identity Check来掩盖路径分叉。

UI 纠偏：分区复用 WorkspacePurposeSection and原折叠/顺序偏OK；Project行恢复Old行High、间距及 hover/focus/touch 操作。Project菜单用非模态Right键导航，Edit弹窗独占模态限制。TimelinePassedPlugin Marketplace下的筛选菜单开放为「Recently Updated」。Project加Number直接ShowName、Device、源Folder。ProjectEditor 持有唯OneDraft，DesktopDevice全集从 Source 投影Read，不取Project open set；无 Source ManageCapabilities的 Web／手机只投影既有 Host Table of Contents，不扩大ManagePermissions。选择Device无Connect副作用；有Table of Contents须先确认再原子清Table of Contents并切Device。OfflineDevice在显式Select Folderor已有Project时复用 Root 唯OneConnect向导，保持原Project页签；只有New增Device进入Settings。Connect层Collapse期间Retain表单。Device切换、Canceland卸载使OldTable of ContentsResultInvalid。创建前只为没有Members的已识别Device显式登记，已有Members严格复查 membership；远端Save后按原 ID 登记Local machine入口，登记FailedRetry不再创建Project。不打开 workspace tab or Agent。

DesktopLocalProjectAddTable of ContentsPassed IPlatformService.selectDirectories 调FromSystem多选；Result仅合并去重到EditorDraft，Save才Submit。远端与 Web/手机Table of Contents浏览Passed projectService.readDirectory(hostId)，不从Current tab 推导FileService；DirectoryBrowser 的迟到响应沿用Request序NumberTriage。选择在途与Save/Close互斥，Cancel不修改Draft。见 docs/ui/project-local-directory-picker.md。

有源Folder的New（含恢复）在 Host Members登记and saveProject 前Show本次Table of ContentsTrust确认，展示所选Device及Complete roots。ProjectEditor Yes唯OneDraftand确认Request owner；CancelRetain表单，Hide/卸载令OldQuery与确认Invalid，单次Save以在途引用去重。确认只授权本次创建，不Persistence、不改变 Hook Trust；重复使用Table of Contents仍确认，Local零 roots 直接创建。EditandAdd已有RemoteProject保持原行为；已SaveProject的入口登记Retry复用 created，不再次创建or确认。见 docs/specs/project-creation-folder-confirmation.md。

LocalProject行根据 roots Quantityand展开态ShowFolder：0/1 root 使用 Folder/FolderOpen，多个 root 使用 Folders/FoldersOpen。composer CurrentProjectand菜单候选复用同OneQuantity规则，保持Collapse图Label。图Label直接派生自CurrentProject，不维护Replica。RemoteProject行复用Connect展示Model的五态图Label，Connected为Medium性云，展开/Collapse不改变Device图Label。不Show独立箭头；Connect进度与ErrorDiagnostics沿用原有入口。hover/focus/touch RetainMore、ViewFile、New TaskThree个入口，Right键复用E同操作定义；按钮不触发行折叠。ViewFile沿用现有 WorkspaceFileTree，多 root 先选择，空 root 禁用；远端经现有Connect/身份Bind，手机经 shared-host 切换，迟到Result不能覆盖New goal。

每个 Host + project ID 的折叠Status归常驻Sidebar，Project行只接收Value与切换Command；File Tree替换list后Back不能Reset折叠Status。

Editor的 roots/primary 只属于表单Draft，Save才Passed saveProject Submit；有 roots Show紧凑listand末行Add，空 roots 才展示整块空态。已有Project的Delete入口复用 deleteProject，并携带原 hostId；成功Refresh后Close，FailedRetain弹窗，Save/Delete互斥。主要Table of Contents只Decide后续NewTask cwd，不重绑Legacy tasks。

Old体验Retain：By Project选择器复用Run层稳定SortandUpdated at，从同 Host/project 的未ArchiveMembers（含置顶）派生Collapse未读点。偏OK hook 只拥有View/折叠的 browser persistence；Project点击无导航。Task交互 owner 只Save尚在途的 pin 意图，Host 树始EndYes唯OneSubmitted行集合；Archive成功复用 UI 清理。Task行按 Shell Current workspaceKey 定位选Medium态，手机Label记按CompleteTarget地址；只有置顶区Task提供File Tree按钮，按Task固化 cwd 与Exact identity/session 打开，不ReadProjectNew主Table of Contents。远端同步/Logs沿用既有接口与Desktop SSH/WSL、手机 replayable Boundaries，不New增业务Status所有者。

Project折叠复用Shared Collapsible 的 300ms High度与淡入淡出，单One open Value仍来自偏OK owner；不能条件卸载SkipCollapse动效。普通Task行不传递File Tree回调；置顶区Task复用同OneFile Tree owner andRequest序Number，手机沿用可Letter切换，晚到Result不得覆盖CloseorNew选择。ProjectFile入口与原Right键/Archive/置顶Retain。

Project树Read owner 接受New快照后，仅对同 Host + workspaceKey + taskId 的未Archive到Archived转换调用既有 removeTaskState。Archive后的CurrentDetailsExit到原WorkspaceDraft，不Auto SelectNext同名Task；首次Archived、Offline缺行、不同 attachment、Failed/迟到Result不触发清理。Title由 active-task hook 经已有 scoped TaskService.getTaskMeta Read同One Host 索引，Body冷恢复不参与Title authority。

`ProjectDirectoryProvider` Yes shell innerProject树ReadandSort偏Okay唯One UI owner；`ProjectSidebar` 与公开 `ProjectComposerMenu` 共用该投影。菜单不得从 tabs/cwd 生成ProjectorInference归属。候选为未DeleteProject（包括Offline入口），按Sidebar顺序，SearchNameand roots；Offline不Optional。选Medium来自Draft projectId + Host 身份，Command复用 onCreateTask -> prepareSession，Table of ContentsBind与Desktop/手机导航仍由 Root/Host 承担。零 roots 不被过滤。Old ChatEmptyState 的 tab 菜单退场。

Archive Management经 index 公开，属于 project-sidebar/ui。RootWorkspaceContent 提供单OneProjectTable of Contents owner，嵌套 Provider 复用；Settings、Sidebar、composer 共用树。Archive按 Host+projectId grouping，Delete容器and未归类不按Table of Contents重绑；操作复用模块inner mutation adapter 与现有 Controller/TaskService。Pages只Save筛选/分页/确认候选and在途Status，批量部分Failed不伪造All成功。见 `docs/superpowers/specs/2026-09-11-archive-management.md`。

Sidebar分区Title与置顶行RetainOldCharacterNumber/缩进，空态由 ProjectTaskRows 统One展示。SortableProjects 持有 dnd-kit 暂态位移，Sort只在同 Host/置顶分区inner经原 reorderProjects Submit，Task原生拖入仍发 moveTask。

ProjectNode 从同One dnd-kit active/over 派生Project插入蓝线的Location；只Label记同置顶分区的Other可Sort节点，Allow跨 Host，释放/cancel随拖拽暂态清除，不New增SortStatus。见 `docs/project-drag-insertion-indicator.md`。

拖拽 context 仅进入 ProjectNode Sortouter壳；菜单/Title/Taskinner容Passed memo 浅比较复用，Events项只在 activator attributes 变化时更New。inner容仍由原Project投影and回调驱动，不维护第Two份Sort/ProjectStatus。

主Table of ContentsAvailable性见 `docs/project-primary-root-availability.md`：所属 Host 在 readTree/readProjects Medium异步探测主Table of Contents，BackOptional primaryRootStatus，不写库、不持久Cache；prepareSession 再次Check，Invalid直接Deny，不复活or替换 cwd。Sidebar消费同One投影置灰Title并禁用New与ViewFile入口（含多 root 菜单andRight键），Title仍可展开已有Task并Read历史，focus Refresh沿用Request序Number；空Project与附加Table of ContentsInvalid不误禁用，远端仅经已有 owner attachment Check。

分区Title兼作折叠与拖拽入口，操作按钮保持独立；PurposeSections 持有 dnd-kit 暂态并限制纵轴，WorkspacePurposeSection 从 active/over 派生Target蓝线。Submit只写原 renderer-local sectionOrder，Cancel不写；Sidebar滚动容器禁止横向滚动。见 `docs/ui/sidebar-purpose-section-order.md`。

Initial turnCompleted接线见 `docs/task-first-submit-visibility.md`：SharedTable of Contents接收真实 Host 行后，同次SubmitTable of Contents与既有Details回调；ConcurrencyInvalid合并为后续Read，不能持续Cancel在途Result。Service换代/卸载CancelOldResult及待Completed导航。

Plugin Marketplace下胶囊按钮打开原全局Search，旁侧筛选仅 projects / timeline。偏OK owner Save view，Default projects，IgnoreOld sort/time 偏OK，RetainExpanded State。Project与 composer ReadCurrent控制端Sidebar偏Okay复合身份顺序。projects Retain全局置顶andRun优先；timeline 只取未Archive task（含置顶与已DeleteProject历史），按 CLI updatedAt / createdAt / taskId 倒序andComplete身份稳定Sort，20/+20；分页后只插入LocalCalendarDateTitle，不ShowProject/Host grouping、不重排、不改变Task key。Recently Updated向Shared TaskList 显式传递 timeline 行样式，ShowTitle、Bind cwd 末级名、E对时间；无Status不Show圆点但Retain对齐槽；By ProjectRetain default 行。筛选两项Left侧使用 Folder/Clock，Right侧Retain单选勾。选择器and行渲染使用同OneMode，不能再次按RunStatusSort。切换只修改本Customer端偏OK，不改导航、归属、Host/CLI 时间or continuous/replayable Boundaries。详见 virtual-project-design 的 SBV01–SBV06。

Project区不按 Host grouping，Local/Remote按复合 projectKey 在同One区Sort。Show顺序由现有Sidebar偏OK唯One持有，远端组织态不接收 UI SortWrite；Offline可Sort，跨置顶Boundaries不改变 pinned。RemoteProjectShowDeviceStatus，只有先选定并Save唯One固定Table of Contents才能New Session；Task区只ShowLocal未归类Task。RemoteProjectEditor不Allow更换/AppendTable of Contents。

RemoteProject菜单、OfflineProject占位及Details断线横幅SharedConnection Status投影 hook；组件仅Read Source/attachment StatusConcurrency送原ReconnectCommand，不能按路径Inference身份。拖拽浮层只读Current拖拽Data，不SubmitProject顺序。

DesktopProjectConnect由 Root 分派：已有 tab 走原地Reconnect；未加载的已SaveProjectPassed公开
`remote-project-connection.ts` 从Local machineMembersTable of Contents解析Target并复用 Host connectHost。
需要认证、Install、Upgrade时复用原 dispatcher/唯One向导，携带Table of Contentsand Profile；普通成功不创建 tab。
交接前重读Project与 host membership，移除/替换后的迟到Result不打开Old意图。手机仍走既有 Host Connect。

原Project交接只携带Exact Profile/Target、Table of Contentsand已有入口Label识；Source 偏OK表示Device选Table of Contents，不与 Profile 偏OK同时Submit。
ProcessingCompleted由 Root 复验入口并Bind原Table of Contents，NewConnect仍进入Project选择。Direct Server 不走 Source Profile 向导，维持原 Host Connect与Error语义。

未加载 tab 的ProjectConnect按 Host Default Profile 规则选线，只使用该线路的Status与Error；Device展示聚合不Decide操作Target。
Root 的原ProjectCompleted guard 从MembersTable of Contents异步复验 entryId、membershipId 与Table of Contents，Bind与PersistenceBack后Waiting校验再Submit导航。
MembersInvalid走已有Cancel语义，仅清理New attachment，不进入NewTable of Contents选择；Desktop continuous 与手机 replayable Boundaries保持原有归属。

已有ProjectPassed同One ProjectEditor 弹窗inner的 RemoteProjectPicker 浏览，Name、DeviceandTable of Contents仍由原Draft持有。仅显式选择Project后登记所属 Host 并调用 addEntry；始End使用远端Project ID，不能按路径复用or调用 saveProject。Back、Close、Members换代使在途listand选择Invalid。Old远端的 legacySingleRoot 只限制New，No limit浏览or登记原Project。list行按inner容定High，超出可视High度后滚动，不Compact多行Nameand路径。

```text
原创建Draft → 显式打开已有Project → 必要时Connect → 只读list
     ↑ Back（RetainDraft）                    ↓ 显式选择
     └────── CancelOldRequest资格         membership 校验 → addEntry(原Project ID)
```

聊天Project菜单的「NewRemoteConnect…」复用 Root 的DeviceAddBack契About。Text、Attachment及Project选择Continue由现有 composer/store 持有，Back引用仅Check聊天Instance并接收实际 Source Result。Connected successfully后每次ShowTargetDevice的Folder选择；确认Table of Contents后唯One匹配复用原Project，多匹配显式选择，零匹配复用Shared创建与Trust确认。登记入口并经 Root PreparationWorkspaceCompleted后进入TargetProjectNewDraft，User手动Send；顶层CancelRetain原Draft并明确恢复后的Target。聊天切换、NewDraftand owner 卸载使OldResult及OldContinue操作Invalid；Web／手机Capabilities门禁Continue由壳层提供。

首次主动Connect与已Connect device的显式Table of Contents浏览共用原版持续Run介绍；已读只使用 `remoteBoundaryIntroAcknowledgedVersion: 1`，只在「Got it」后Write。NewLabel记缺失（含OldCharacter段Version 2）补看One次，存量Version 3 由Settings owner 迁移；BackgroundCompleted、LocalTable of Contents、ReadFailedandInvalid epoch 不消费Description。

Project菜单与RemoteProject行共用只读Remote身份浮层，Name与地址只读既有Table of Contents投影；浮层Status与Project行StatusTextCharacter共用展示Model短Status。仅Project行在Desktop端传入DeviceSettings入口：`pending` 时浮层底部Show操作名入口，点击定位“Settings › RemoteDevice”对应Device卡，浮层不直接executeConnect动作；紧凑单行RetainOnline/OfflineDevice名。SidebarSession行（Projectinner、置顶区、Recently Updated）hover/focus 不ShowRemote身份Details，原有Session操作Retain。鼠Label移出行与浮层、键盘移出or Escape AutoClose，无Close叉与点击锁定。TextCharacterOptional择andCopy，选区不改变Close规则；触发区与Details区跨区移动沿用Close缓冲，ShowStatus仅归身份浮层组件。

聊天的Connect后Table of Contents流程由 ProjectComposerMenu 持有One次发From意图。ComposerSubmissionPendingContext 仅向CurrentInput框投影Submit阻塞；ConnectBackground化、CancelorDraft owner Invalid解除该投影。Table of Contents确认后ReadTarget Host 的Project；唯One匹配沿实际Project ID 登记入口，Root Preparation与导航Completed才释放门禁。异步期间Bind原 Host membership，attachment Submit导航前再次Check membership、Project ID and固定 root。详见 docs/issues/remote-connection-ux/21-chat-settings-round-trip.md。

聊天ConnectBackgroundCollapse只Retain既有Back owner，解除原DraftSubmit门禁；显式Continue由Connect owner 校验 Source，由聊天 owner 复验发From时已有Members的 membership，Root 同步Label记校验Medium并在异步校验后重验原意图and tab，Deliver后才消费，再进入共同Table of Contents流程。Table of Contents流程继承该Members资格，迟到Result不能重建已移除Members。首次无Members仍在明确选择后登记；Web 不New增Connect owner。

ConnectCompleted前的Members资格ReadFailed不等同于CancelorMembersInvalid。Root Retain同OneBack意图的Retry资格，kError交回WaitingCompleted的Connect flow；前台Continue禁发，沿用该 flow 的实际Error、显式RetryandCancel。CancelUndo在途资格Result，Background可见性仍只影响原聊天门禁，不对Other聊天加锁。

By Project、By Group、Recently UpdatedShared同One ProjectDirectory Task树与TaskCommand。grouping呈现复用Delete前的组件，保持原整行拖拽、Right键菜单and空组New语义。
`useTaskGroups` 只订阅控制端 Host 的Structures，Members身份为 canonical workspace key + taskId；
View不创建Connector Agent，不以缺席清理Members，不修改ProjectorSession事实。
Old grouped 偏OK在没有有效New版选择时映射到By Group。
Draft placement 独立于Project选择；普通Project选择与聊天RemoteTable of Contents确认均沿用原Draftgrouping，既有Session不Read残留Draftgrouping。创建 ACK 后，权威Table of Contents确认同时触发 UI 提升与独立幂等入组；组织Request不占用SharedTable of ContentsRead，Assistgrouping重读不进入Initial turn屏障。导航Cancel立即结束 UI Waiting，尚未确认的组织回调Continue由原Table of Contents owner Retain，确认后只executeOne次；迟到Result不得重New打开Details。
grouping手工移动Submit节点/Source/锚点，Host 事务Processing并广播Refresh。`grouped/` 的嵌套 view 只做展示andCurrent手势预览，不恢复Legacy tasks事实Cacheor整表 applyOrder。吸顶浮层位于统One渐隐容器之outer，Hash/CollapseAll操作挂在既有listTools栏。CloseDraft行只从 Composer Draft owner 清除grouping意图。

Composer 头部Passed `ProjectComposerMenu.showEditProject` EnableCurrentProject Plus Edit入口；`children` 放置分支等既有控件，顺序为Project、children、Edit按钮。CurrentProject解析仍由菜单持有。复用 ProjectEditor 与Table of ContentsService，Online且非 legacySingleRoot 才能Edit；Host/project 身份、SessionorDraft切换使已打开EditorInvalid。Save/Delete仅RefreshTable of Contents，不调用导航；Other选择器Default不Enable入口。
