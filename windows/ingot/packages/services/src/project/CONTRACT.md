
唯One写者YesCurrent Host 的 tasks-index Storage。Service负责真实Table of Contents校验、DefaultTable of Contents创建与OldSettings双写；AutoArchive由本模块的定时扫描器execute（Start首轮、每小时、SettingsChanges补扫），不挂在任何Reador UI 动作上；Repository 在事务inner维护Project、roots 与Task归属。UI 只经 hooks 调用此契About。Remote调用使用拥有组织态的现有 Host attachment，不让 main/relay 创建业务Replica。

Table of Contents解析的 task 归属与 roots 来自同One读快照。已知 task 无Project时Back空附加Table of Contents；引用悬空ProjectorReadFailed直接Deny。prepareSession 的 cwd 创建后固定；Edit roots 只影响下One次 runtime materialization。DeleteProject不DeleteSession；移动不写 CLI 事实、时间or cwd。CLI continuous/replayable 流不由本模块修改。

全局创建显式空归属，不按Table of Contents猜Project。跨 host 移动Failed；同 host 缺Table of Contents时先BackError，User明确确认后原子Append root 与移动。可Delete容器永久Retain，恢复仅由New时明确选择同 roots 的已删Project。

远端装配器在 prepareSession and resolveSessionDirectories 后，Passed既有 workspace identity resolver 为Back的真实 cwd 登记并Back workspaceIdentity；不CopyRequestMedium的身份，resolver Failed直接Deny。readTree Back前对AllProject roots（包括无Task的空Project）与历史Task cwd 去重并Completed同One身份Preparation，Failed不Publish树，防止Sidebar动态订阅落到未映射的Events源。它只提供导航/Isolated身份，不改 cwd and附加Table of Contents；UI 不得从远端真实路径InferenceLocal machine workspace。导航Continue严格比较Task与Table of Contents解析Result的 cwd and身份，不以路径E同绕过DeviceIsolated。

readProjects 只QueryProject/roots，不加载Taskor触发 Agent，用于Table of ContentsManage；readTree 同样只读，两者都不触发AutoArchive。Old settings 集合由Local machineSubmit的Project/入口派生；Window只写 lastActiveWorkspace。派生端口不得调用 settings orNetwork，SettingsFile锁inner重读，防止Delete入口被迟到响应复活。

Missing virtualProjects 握手Capabilities的远端只使用单 root 读适配器。它Read远端Old app Data，不写Local machineProject，不Start Agent，Project组织操作显式Deny；创建/恢复只Back既有 cwd 与空附加Table of Contents。合成 ID 由 host/cwd 稳定导出，Upgrade时只Allow入口的Version CAS 解析，不形成持久权威Project。

Old单 root 投影的 `directoryMatchPath` 按远端 platform 与 readDirectory 的同One normalize 规则派生，只用于Table of Contents匹配。原 root、合成 ID、Task cwd 与归属保持不变，该Value不落库orWrite口Cache；等价Table of Contents的多个历史 ID 不合并。

readDirectory YesProject选Table of Contents的 Host 路由入口：Unspecified path Back所属 Host 的 home，Point to定 path 沿所属 Host 的ProjectSave规则 normalize 后复用FileService readdir，Back规范化 path 与Table of Contents条目，不增加 realpath or符Number链接等价规则。Old远端同样Passed已Connect device的 systemService.info 与 fileService.readdir 浏览and验证；路径Triage与规范化明确采用远端 platform 对应规则，仍禁止ProjectNewand组织Write。Table of Contents端口由装配层注入；FailedDeny，不NewTable of Contents/Project/Session。不依赖Desktop平台接口，手机使用同One RPC。

主Table of ContentsAvailable性见 `docs/project-primary-root-availability.md`：所属 Host 在 readTree/readProjects Medium异步探测主Table of Contents，BackOptional primaryRootStatus，不写库、不持久Cache；prepareSession 再次Check，Invalid直接Deny，不复活or替换 cwd。Sidebar消费同One投影置灰Title并禁用New入口，Title仍可展开已有Task并Read历史，focus Refresh沿用Request序Number；空Project与附加Table of ContentsInvalid不误禁用，远端仅经已有 owner attachment Check。

Local仍Allow 0..n roots；可Letter ownerHostId 非 local 的持库宿主只Allow恰OKOne个固定 root。Remote创建必须有Project，prepareSession、reserveCreatedTask 与 moveTask 不得产生无归属or附加Table of Contents；根路径更Newand缺 root 拖动在写事务MediumDeny。Customer端 hostId 不能改变持库身份。历史迁移Data不被裁剪，Failed不得部分Write。

未归类 Composer 可传 UUID draftId，Table of Contents由 Host 在 workspaceDirectory 下OK性派生；ConcurrencyandRetry只Preparation同OneTable of Contents。reuseDraft 表示Customer端已拿到该Table of Contents，缺失时报Wrong，不重New mkdir。无 draftId 的Other调用保持独立分配，远端仍要求Project；Draftand接纳记录不进入ProjectData库。
