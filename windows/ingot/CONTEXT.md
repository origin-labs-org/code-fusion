
PluginsSettings页及其市场浏览/Install体验的领域词汇表。2026-07 商店化重Design引入了One批容易混淆的术语，本FileYes唯OneAdjudicationSource。

## Language

**Official Marketplace（Official Marketplace）**:
CodeFusion OfficialOperations的唯OneDistribution Channels，市场 id 为 `cf-plugins-official`，inner容 = Built-inPlugins + CDN Plugins。Yes"分发渠道"而非"作者归属"——其Medium可以收录社区作者的Plugins。
_Avoid_: 把 claude-plugins-official 称作"官方市场"；"官方"泛Point toOne切受Letter市场

**Builtin Plugin（Built-inPlugins）**:
随应用包OneFrom分发、Start时播种进Official Marketplace的Plugins。YesOfficialPlugins的子集。
_Avoid_: 预装Plugins、bundled plugin（口语Available，Documentation统One"内置"）

**CDN Plugin（CDN Plugins）**:
Official MarketplaceMediumPassedOfficial CDN 以 sha256 校验的 zip 包分发、按需下载Install的Plugins。
_Avoid_: NetworkPlugins、OnlinePlugins

**Personal Source（PersonalSource）**:
User自行Add的One切PluginsSource：claude-plugins-official、git/GitHub/URL/LocalTable of Contents市场、inline Plugins。
_Avoid_: Third-party市场（claude-plugins-official 也归此类，"Third-Party"名不副实）

**Catalog Auto-Refresh（Table of ContentsAutoRefresh）**:
进入商店页时对 Official Marketplace Table of Contents的节流BackgroundRefresh，User无感知；只覆盖Official Marketplace。
_Avoid_: 与 Manual Refresh 混用；把它称作"检查更新"（更New角Label只YesRefresh的副产物）

**Manual Refresh（Manual Refresh）**:
商店页顶栏Refresh按钮触发的全市场Refresh，不受AutoRefresh节流影响。
_Avoid_: Refresh、Check for Updates（口语Available，Documentation统One"手动刷新"）

**Public Segment（公开）**:
商店list页的分段之One，展示Official MarketplaceMedium由产品Team维护的条目；PublishCharacter段 `publisherType` 为 `official`，OldTable of Contents未提供时Default公开。
_Avoid_: Official tab、商店 tab

**Community Segment（社区）**:
Official Marketplace收录的outer部维护Plugins；从 `external_plugins/` Publish为 `publisherType: community`，与用途分类独立。

**Personal Segment（Personal）**:
商店list页的另One分段，展示AllPersonalSource的Table of Contents，按市场grouping。
_Avoid_: Third-party tab、我的 tab

**Featured（精选）**:
公开分段顶部的策展区，名单由Official CDN Table of Contents的 `featured` Character段Remote控制。仅存在于公开分段。
_Avoid_: 与 Recommended 混用

**Recommended（推荐）**:
Personal分段顶部的策展区，名单由仓inner `recommendedPlugins.json` 维护（Current推 claude-plugins-official 的精选Plugins）。仅存在于Personal分段。
_Avoid_: 与 Featured 混用

**Manage Installed View（PluginsManage）**:
市场Right上角的“PluginsManage”进入同OnePagesinner的ManageView；Retain全局DefaultandProject覆盖，可Back浏览并RetainSearch、Source与Manage范围。More菜单仅暂停/Enable与卸载，更Newand恢复继承使用独立操作。

**UI Plugin（Boundary面Plugins）**:
清单声明有效的 `ui.surfaces`，PublishTable of Contents携带 `componentTypes: ["ui", …]`。未Install时使用Table of ContentsCapabilities，Install后以实际清单为准；暂停不改变分类。归属、用途and UI CapabilitiesYes独立维度。UI 专区andSearch均限定CurrentSource分段。

**Default UI Recommendations（DefaultBoundary面推荐）**:
Side Pane 的独立精选名单，由Customer端Configuration接口的 `uiPluginRecommendations` 下发，关联Complete市场Table of Contents展示，未Install、Disabled也可推荐；点击后分别Install、Enableor打开真实面板。开发InstallandUserInstall不Auto加入，与市场innerComplete UI 专区不同。

**Store Listing（商店Letter息）**:
Table of Contents条目携带的展示性Metadata：Show名、icon、分类、开发者、网站/隐私政策/Service条款链接、hero 图、ExamplePrompt。描述"Store Presentation"，不影响Plugins功能。
_Avoid_: PluginsMetadata（含糊，可能Point to manifest）

**Plugin Manifest（Plugins清单）**:
Plugins包inner `plugin.json` 的功能性定义（commands/agents/skills/hooks/mcpServers/userConfig…）。描述"插件是什么、做什么"。
_Avoid_: marketplace.json（那YesTable of Contents，不Yes清单）

**Example Prompt（ExamplePrompt）**:
Store Listing 提供的可点击Prompt，点击后New Session并预填（不AutoSend）。YesDetails页唯One的"New Chat"入口（原「Try Now」按钮已于 2026-07-14 移除）。
_Avoid_: 快捷Point to令、prompt Template、Try Now

**Plugin Lifecycle（PluginsLifecycle）**:
User从发现PluginsStart，经过View、Install、Configuration、启停、使用、Check for Updates、Upgrade、Persistence恢复，直到卸载or恢复Built-inPlugins的Complete产品路径。每stages都必须同时验证可见 UI Statusand对应的PersistenceorRun时Result。
_Avoid_: 仅把“Install成功”称为CompleteLifecycle

**Restorable Builtin（可恢复Built-inPlugins）**:
被User卸载并进入Persistence抑制Status的 Builtin Plugin。应用重启不得Auto重New播种；它Continue出现在 Public Segment，并Passed“Install”入口execute干净恢复。
_Avoid_: 未Install CDN Plugins、临时禁用的Built-inPlugins

**Orphaned Installed Plugin（孤立已InstallPlugins）**:
对应 Personal Source 已被Delete、但InstallTable of ContentsandUserData仍Retain的Plugins。它仍可使用、Configuration、启停and卸载；Source重NewAdd前不能更New，重NewAdd同OneSource后恢复Table of Contents关联。
_Avoid_: Install损坏、manifest 缺失、已卸载Plugins
