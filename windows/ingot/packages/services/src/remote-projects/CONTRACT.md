
Local machine SQLite Yes“UserAdd了哪些远端Project”的唯One权威。远端Project CRUD Continue走远端 project Service。入口仅Save基础Letter息，不SaveSession索引、归属、Messagesor待execute操作。ConnectRuntime与凭据沿用既有Service。

New增Yes明确User动作，Refresh只更New已有 entry ID，并比较RequestStart时 lastSyncedAt。移除后重NewAdd产生New ID，OldNetwork响应无法复活or覆盖New入口。ConcurrencyRefresh仅One个Version可Submit，其余下One次Refresh重读。移除 host 仅级联Local machine入口，事务Mediumexecute；Save host 在事务innerCheck 20 个上限。所有Changes经 afterChange 在Current Host Publish，Desktop与手机Read同One份Local machineData，不创建New runtime orMessages恢复路径。

schema 由 project-storage 的Start迁移Preparation。本模块仅操作 hosts 与 remote_project_entries；工厂注入已迁移的Connect，不打开第Two个Data库，不接触 CLI。settings 双写由装配层从Submit后的入口快照派生，不能把Old settings 再次导入。

直接Connect远端 owner 的Customer端没有Local machine Controller 入口表。装配时以 controller=false 禁止All入口Write，readDirectory Back空Table of Contents且不访QuestionData库；Current owner 的权威Project仍从 projectService Read。不能因为Query不支持 Controller 入口就把整个权威Project树Deny掉。

历史影子 host 的 target_json=NULL 占位不属于Connect入口，不展示、不计容量。未改变Cacheinner容的Refresh仍推进 CAS Version，但不广播Project变化。

connectHost 从Members表取得已SaveConnect，再Passed装配端口调用既有Connect器的 retain 路径；自身不加载凭据、不Retry、不创建 Host/runtime，不增加入口。readDirectory 可附加ConnectManage器提供的Current connectionStatus，Character段仅为实时展示投影，禁止落盘or成为ConnectInstance的第Two owner。

ConnectMembersInstance由 membership_id Label识；显式移除/重加换代。握手 bindHost 比较Start时的Instance ID，条件不匹配不得插入。Old地址与稳定 Source 合并时只迁移Local machine入口，重复的已解析ProjectRetainTarget现有 entry ID；Old稳定 Source 不Allow直接改绑成另One个稳定 Source。ConnectInstanceand Profile 路由依然归既有ConnectManage器/Directory。

createRemoteProjectConnectionAdmission 为装配层提供 probe 前 admission / online 前 commit 的窄端口，AutoConnect只读Members关系。bindHost 的 createDistinctHost 仅供既有身份更换确认Passed后使用：条件匹配时New增独立 Source，RetainOld Source 与入口，不迁移归属。

Old workspace 入口首次匹配Project时，仅接受同 Host 唯One包含该 cwd 的Project；零匹配or多匹配Retain原入口WaitingUser选择。若多个Old入口解析到同OneProject，Retain已经解析的 entry ID 并去除重复Old入口，迟到响应不能再PassedOld ID Write。

Connect器在 admission/commit 每次Waiting后复查Canceland物理Connect owner。未Publish socket 由Current connect 调用独占并在统One finally 释放，直到成功移交 online map；Close回调只能影响它实际拥有的 online 对e，不能使另One条已OnlineConnectOffline。

Connection Status端口同时投影CurrentErrorand原Status名，online 后不得回退ReadOld持久Error。ProjectConnectLogs使用 hostId+membershipId 关联现有Connect进度Context，UI 只消费CurrentMembers；该 key 不Yes workspace 身份，不参与Task/QueueIsolated。
