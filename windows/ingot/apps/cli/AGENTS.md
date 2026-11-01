
这里Yes TypeScript Node.js Coding Agent CLI，支持主流Modeland操作System。通用TaskBoundaries、spec、验证andSubmit条件遵循[根 AGENTS.md](../../AGENTS.md)；本FileSupplement CLI 特有规则。Node Version以仓库 [mise.toml](../../mise.toml) 为准。

- CLI spec 位于 `apps/cli/docs/design/v2/`；New功能、行为变化先更New，bugfix and纯重构按根规则判断。下Text未带 `apps/cli/` 的代码与Documentation路径E对于本Table of Contents。
- 改动任何 tool（New增、Delete、schema、Permissions、execute、prompt、adapter、Events、UI/V4 投影等）之前，必须先阅读并更New `docs/design/v2/tool/00-tool-change-chain.md`，按端到端链路Check。
- 其次YesTests case 很关键，能证明ResultYes否符合预期
- 功能Documentation更New到Final行为，复用已有 spec；bugfix 用回归Evidence留痕，非显然根因and防回归About束在修复点留Chinese注释。
- agent 友OkayProject，留OKLogsor者接口，让 agent 能完全接手操作
- Long程Task优先：核心 agent loop Default面向可持续Run的复杂TaskDesign，不用 tool call timesCount做硬Stop。资源与安全Boundaries应由 token/context limit Auto compact、UserCancel、PermissionsDeny、Tools超时、Output截断、provider retry 上限等明确条件承担。
- 单个源FileDefault上限为 800 行。已确认的存量超限File由根 `.oxlintrc.json` Exact登记为行Count告警；不要为满足行Count机械拆分，职责分离确有收益时再重构。OtherCheck仍严格execute。
- String、CountCharacter等常量应提取为命名变量or常量，不要在业务逻辑Medium直接散落Character面量，便于One处修改、统One维护。
- 修改Data库Structures时必须同步 CLI 负责人，仔细Design migration
- 键盘操作优先，核心逻辑都可以走键盘操作。鼠Label操作Yes增益Capabilities

- 与操作System交互之前，需要考虑同时支持 windows、mac、linux
- 保持Default的Publish路径为Label准 Node.js CLI 打包方式。
- Project自有的环Context变量统One使用 `CF_` Prefix命名，但不要随便New增环Context变量；New增前必须先在 `docs/design/v2` 的 spec Medium定义用途、优先级、Error行为andTests覆盖，能用ConfigurationFile、CLI 参Countor session Configuration表达的Capabilities，优先不要做成环Context变量。

- 所有功能Default需要同时面向 Windows、macOS、Linux Design；不要只按Current开发机的System行为Implementation。
- 路径Processing优先使用 Node.js Label准库 `path`、`url`、`fs` 等跨平台 API，不手写路径分隔符、绝对路径Prefix、换行符or临时Table of ContentsLocation。
- Runouter部Command时优先使用 `child_process.spawn` / `execFile` 的参CountArrayForm，避免依赖 shell String拼接、POSIX 专属语法、管道、重定向orBuilt-inCommand。
- 需要调用SystemCommand、Editor、shell、包Manage器or可executeFile时，要考虑 Windows 的 `.cmd` / `.exe`、空格路径、参Count转义、环Context变量大小写and shell Variance。
- FileSystem逻辑要考虑大小写敏感Variance、PermissionsModelVariance、符Number链接支持Variance、可execute位Variance、换行符Varianceand路径Long度限制。
- Terminal交互要基于Capabilities检测，而不Yes假设固定Terminal特性；颜色、TTY、Unicode、交互式Input、Window尺寸andLetterNumberProcessing都需要有非交互orCapabilities不足时的退路。
- 涉及UserTable of Contents、CacheTable of Contents、ConfigurationTable of Contents、临时Table of ContentsandProjectTable of Contents时，应Passed明确的跨平台解析逻辑获得，不硬编码 Unix 风格Table of ContentsStructures。
- New增与System交互E关的Capabilities时，应Supplementor更New覆盖跨平台Variance的Tests；无法在CurrentSystem验证的行为，要在ImplementationandDescriptionMedium明确Remaining风险。

- 模块之间的交互必须Passed显式、有限、稳定的接口Completed。
- 每个模块都应当可以被单独理解、Testsand替换，并对outer提供严格的类型声明、接口定义or schema 声明。
- 模块之间不Yes直接耦合Implementation，而YesPassedLabel准化契About互E调度。调用方不应依赖被调用模块的inner部Implementation、Table of ContentsStructures、隐式全局StatusorUndeclaredAbout定。
- 模块对outer暴露的契About应清楚描述 capability、Input、Output、Error形态、StatusChangesand副作用。
- 当Data会跨越进程、Storage、Network、Plugins、Tool callor LLM Boundaries时，应优先使用可Run时校验的 schema 描述，而不仅Yes TypeScript 类型。
- New增模块间交互时，应先补齐接口契About，再Implementation具体逻辑。

- 所有outer部副作用必须可被统One观察、审批、Cancel、Retry、Queued、AuditandTests。业务逻辑只表达意图，不直接触碰outer部世Boundary。
- 所有outer部 I/O 都必须收敛到明确的基础设施层or adapter Medium，包括Network Requests、FileSystem读写、子进程调用、环Context变量Read、TerminalInputOutput、Cache、Data库、System剪贴板andouter部Service访Question。
- 除入口层、基础设施层and adapter outer，业务模块不得直接调用 `fetch`、`http`、`fs`、`child_process`、`process.env` 等底层 I/O API，而应依赖Projectinner定义的接口、service or adapter。
- I/O adapter 对outer必须提供稳定的类型声明or schema，明确Input、Output、Error类型、超时、Cancel、Retry语义、幂等性and副作用范围。
- Network访Question应Passed统OneRequest入口Completed，便于集MediumManage超时、Retry、退避、鉴权、代理、自定义证书、限流、Logs、AuditandError归One化。
- File读写应Passed统OneFileSystem入口Completed，便于集MediumManage原子Write、Concurrency控制、临时File、QueueWrite、PermissionsError、路径规范化and跨平台Variance。
- 子进程execute应Passed统Oneexecute入口Completed，便于集MediumManage sandbox、Permissions审批、环Context变量、超时、Cancel、Output截断、StreamingOutputandExit码归One化。
- 当 I/O 操作需要异步化、Queued、Retry、降级orAudit时，应在 I/O Boundaries层Processing，不应把这些机制散落到业务逻辑Medium。

- 每个 tool 都应声明明确的 `inputSchema`、`outputSchema`、Yes否只读、Yes否破坏性、Yes否Concurrency安全、最大Output大小、超时、Cancel语义andPermissions需求。
- tool 的副作用范围应显式声明，例如 `none`、`workspace`、`git`、`network`、`system`。PermissionsSystem、sandbox and审批流程应Read这些声明，不依赖调用点临时猜测。
- 有副作用的 tool 应尽量声明幂等性and可恢复策Omitted，便于后续ImplementationRetry、回滚、QueueexecuteandFailed恢复。
- 大体积 tool Result不应直接回灌ModelContext；应落盘or进入 artifact/storage，只BackSummary、预览and可追踪引用。
- MCP、plugin、subagent 等outer部扩展必须Passed capability 声明、schema 校验、命名空间IsolatedandPermissions收口接入，不应直接获得inner部模块ImplementationCapabilities。

- Coding agent CLI 应把 session、message、tool call、permission、checkpoint、Queueand pending Status视为One等Status对e，支持恢复、分叉、回滚andConcurrency session。
- TUI 只负责Input采集、布局渲染and临时交互态，例如光Label、Input框、滚动LocationandCurrent弹窗选择；session、mode、model、tool、todo、permission、checkpoint 等业务Status不得Save在 TUI 层，必须由 server/bootstrap/core/session Storage并Passed显式接口or session event 下发。
- TUI Medium的折叠/展开Point to示符统One使用 `+`/`-`（折叠为 `+`，展开为 `-`），不要使用 `v` and `>`。
- 与User交互E关的确认、选择、Input、进度、Error恢复等Capabilities，应面向 TUI and CodeFusion Protocol V4 Customer端Design为稳定的交互Request/响应接口or session event；不同Customer端只Yes呈现and传输适配层，不应把交互流程写死在单OneFrontendMedium。
- 所有Taskexecute都必须携带可传播的 `traceId`。`traceId` Default对应One次顶层 session 的CompleteTask链，session inner创建的子 session、subagent、RetryTask、BackgroundQueueTaskand异步 I/O 都应归属到同One个 `traceId`。
- `traceId` 位于 `sessionId` 之上；`sessionId`、`turnId`、`messageId`、`toolCallId`、`spanId`、`parentSpanId` 等应作为 `traceId` 下的Structures化子Label识，用于还原Complete调用链。
- 所有模块、service、adapter、tool runtime、provider client、I/O adapter andPermissions判断逻辑都应接收并Continue传递统One的executeContext，不得在Medium途丢弃、覆盖or临时生成Irrelevant联的 `traceId`。
- 任何异步Task、Tool call、outer部 I/O、跨模块调用or子 session，如果无法关联到 `traceId`，都视为不可Observability行为，应避免引入。
- provider、model、MCP、Storage、Network代理and证书都应Passed adapter 接入；session-core 不应写死具体供应商、传输Protocolor部署环Context。
- Configuration需要有明确层级and优先级，例如 system、user、project、session、CLI 参Countand环Context变量；安全E关Configuration应能追踪Source。
- 拥抱 `.agents Protocol` and `AGENTS.md` 的规范；后续Design尤其YesConfiguration发现、ConfigurationRead、优先级解析等E关Capabilities时，Default需要Compatible `.agents Protocol`。
- 从Version 1StartRetain调试andObservability入口，覆盖Model request、context 组成、token/cost、tool call、I/O、Permissions判断、Retry、Queue积压andQueue丢弃。
- Logs、trace and调试Output应避免泄露密钥、token、隐私DataandCompleteUserinner容；需要High敏Letter息时必须显式进入受控 debug 路径。

- ErrorYesOne等Design对e。New增功能时需要优先考虑Failed路径、Error归属、传播方式andFinalUserNotice。
- Default让Error向上冒泡，直到到达真正有CapabilitiesProcessing它的层。不要在Low层模块随意吞掉Error、仅打印Logs后Continue execution，or提前把Error转换成普通String。
- 只有在能够恢复、Retry、降级、Add context、转换为User可操作Notice，or处于 CLI 入口Boundaries时，才捕获Error。
- 抛出or包装Error时应RetainRawError原因，并Supplement必要Context，避免丢失调用链andSystemErrorLetter息。
- User能感知System深层的Status；Error、Waiting、Retry、Permissions、Model、Toolsand I/O Status都应沿调用链向上暴露到 CLI/TUI 等UserBoundary面，同时避免泄露密钥、隐私andCompleteRawinner容。
- 底层业务模块不应直接调用 `process.exit`、直接OutputError到Terminal，orDecideFinalExit码；CLI 入口层负责统One格式化Error、OutputNotice并SettingsExit码。
- 不依赖ErrorText做流程判断；需要区分Error类型时，使用稳定的Error类型、Error码orStructures化Character段。
- Tests应覆盖关键Failed路径，尤其YesConfiguration缺失、Permission denied、NetworkFailed、FileSystem异常、UserInput非法andouter部CommandFailed等 CLI 常见Error。

- 每个功能级别的Changes创建One个独立Submit。
- 不要kIrrelevant的功能、重构、依赖更Newand格式调整混在同One个SubmitMedium。
- 保持Submit足够小，以便独立Review。
- 当One个功能的Changes涉及多个File时，k这些FileOneFromSubmit。
- 如果One项Task需要多个功能级别的Changes，按照应Review的顺序拆分为多个独立Submit。

以下Command从 z-code 仓库根Table of Contentsexecute；若Current已在 `apps/cli`，省Omitted `--dir apps/cli`。

- CLI 代码Changes除根验证矩阵outer，Run `pnpm --dir apps/cli typecheck`、`pnpm --dir apps/cli lint`，以及受影响 CLI 包与调用方的Tests。用 CLI 自身的 package scripts / Turbo 选择范围，不能用根 `pnpm test:unit:affected` 代替。
- 无法可靠OK影响范围，or修改 CLI 公共Configuration、Tests基础设施时，Run `pnpm --dir apps/cli test`。必要CheckPassed后不重复Run；纯Documentation、环Context阻塞、Submit条件均遵循根规则。
