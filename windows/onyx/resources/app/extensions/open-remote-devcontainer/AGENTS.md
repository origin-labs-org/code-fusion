# open-remote-devcontainer

Lingma IDE 一方的 Dev Containers 扩展，对接 VS Code 的 `dev-container+...` authority。

## 修改标记约定

和 `extensions/open-remote-ssh`、`extensions/open-remote-wsl` 一样，本扩展是 Lingma IDE 一方插件，**不**按 `src/vs/**` 的上游合并规则处理。修改这里**不需要**添加 `LINGMA EDIT` 标记。

## 双模式：本地 docker / SSH 远端 docker

从 v0.1 起本扩展支持两种 docker host：

1. **本地模式**：`DevContainerAuthorityData.sshHost` 缺失，行为与 v0 完全一致——本地 host shell / docker CLI 在本机执行；`@devcontainers/cli` 负责完整 devcontainer.json 语义。
2. **SSH 模式（默认长期路线）**：authority 使用 `dev-container+<hex(JSON)>@ssh-remote+<host>`。`open-remote-ssh` 作为 parent authority 暴露 `RemoteAuthorityResolverContext.execServer`，dev-container resolver 里的 host shell、`@devcontainers/cli` 和 docker CLI 都通过 `ExecServerDockerHostExecutor` 落到 SSH host；docker 必须装在远端 host 上。

模式选择优先看 resolver context：`context.execServer` 存在时必须使用 parent authority/ExecServer；只有旧单层 SSH authority 兼容路径才读取 `authorityData.sshHost` 并回退到 `SshDockerHostExecutor`。**一次解析一个 executor 实例**——本地、nested SSH、旧 SSH fallback 路径不互相污染。

### 不可破坏的本地路径不变量

- `LocalDockerHostExecutor` 内部 `cp.spawn(dockerPath, args)`，行为与 v0 字节级一致；本地 dev container 用户的体验不受 SSH 改动影响。
- `scripts/forwarder.js` 独立 Node 子进程仅本地模式使用；SSH 模式走 `src/inlineForwarder.ts`（ext-host 内联）。
- `@devcontainers/cli` 是本地和 SSH 模式的统一容器生命周期入口。SSH 模式必须先把 bundled CLI 同步到远端 `~/.aicoding-devcontainers/cli`，再用远端 Node 执行；Node 必须优先使用当前 IDE server commit 对应的远端 server node，再 fallback 到其他已安装 server node。当前 commit 的固定布局必须覆盖 `~/<serverDataFolder>/bin/<commit>/node`、`~/<serverDataFolder>/bin/<commit>/bin/node`、`~/<serverDataFolder>/bin/<commit>/server/node` 和 `~/<serverDataFolder>/cli/servers/<commit>/server/node`；固定布局找不到时才扫描 `bin/*` / `cli/servers/*` 和 `find "$dataDir" -maxdepth 5 -type f -name node`，最后才回退到远端 PATH，避免低版本系统 Node 跑不动 bundled CLI，也避免远端残留多个 server commit 时随机使用旧 commit 的 node。不要新增自拼 `docker build` / `docker run` 分支，否则会丢失 features、compose、lifecycle hooks 等 devcontainer 语义。同步时不要只按远端文件存在性跳过，避免扩展升级后远端残留旧 CLI。
- 本地路径**不**激活 `aicoding.open-remote-ssh`，**不**注册 cross-extension session——纯本地用户从未触发 SSH 路径。

## Authority data：nested authority 与 legacy `sshHost`

```ts
interface DevContainerAuthorityData {
    workspacePath: string;           // 在 docker host 上的路径（本地或远端）
    devcontainerPath: string;        // .devcontainer/devcontainer.json
    devContainerName?: string;       // devcontainer.json 的 name，仅用于 Workbench 标签
    containerId?: string;            // Attach to Running 场景填这个
    rebuild?: boolean;               // resolver 内一次性处理 rebuild intent
    rebuildNonce?: string;           // 防止同一个 authority reload 后重复 rebuild
    sshHost?: string;                // deprecated：旧单层 SSH authority 兼容字段
}
```

- SSH 窗口的 `Reopen in Container` / `Rebuild and Reopen in Container` 只负责读取/校验远端 devcontainer.json，然后打开 `vscode-remote://dev-container+<hex>@ssh-remote+<host>/<containerWorkspaceFolder>`，并使用 `forceReuseWindow: true`。不要在原 SSH 窗口预先 `containerManager.up()` / `rebuild()`。
- 新入口应把 `devcontainer.json` 的 `name` 写入 `devContainerName`。Dev Container 窗口激活后会为当前 exact authority 注册 label formatter，Workbench 标题、Explorer 根节点和左下角远端状态应显示 `Dev Container: <name> @ <ssh-host>`；旧 authority 没有 name 时至少显示 `Dev Container @ <ssh-host>`。
- 容器生命周期集中在 dev-container resolver：读配置、`initializeCommand`、`@devcontainers/cli up/rebuild`、安装 IDE Server、forwarder、cache/history 都在 resolver 状态机内完成。镜像 pull/build 自然发生在 resolver 的 `Running devcontainers CLI up` 阶段。
- `sshHost` 只用于旧单层 SSH authority 和临时 fallback。新入口不要把 SSH host 塞进 JSON，parent host 必须由 authority chain 表达。
- `authorityData.containerId` 存在时，resolver cache key 必须包含 containerId；nested SSH 场景还必须包含 parent authority，避免远端 host 与本地/其他 host 同路径缓存撞 key。

## IDockerHostExecutor 抽象边界

所有 docker / host 命令收敛在 `src/utils/executor/`：

| 文件 | 职责 |
|---|---|
| `IDockerHostExecutor.ts` | 接口：`exec / execStreaming / spawnInteractive / execHostCommand / isRemoteHost / dispose` |
| `localDockerHostExecutor.ts` | 本地实现：`child_process.spawn(dockerPath)` |
| `execServerDockerHostExecutor.ts` | nested SSH 实现：通过 parent `vscode.ExecServer` 执行 host shell、docker CLI 和双向 forwarder |
| `sshDockerHostExecutor.ts` | SSH 实现：路由到 `aicoding.openRemoteSsh.sessionExec` 命令；`spawnInteractive` 经 `globalThis[AICODING_SSH_REGISTRY_KEY]` 拿原始 SSHConnection（同 ext-host） |
| `index.ts` | 工厂；`createDockerHostExecutorForCurrentWindow()` 在 SSH 窗口优先用 `workspace.getRemoteExecServer()`，旧路径才激活 open-remote-ssh |

新增 docker 调用点时必须接入 executor，不要直接 `cp.spawn('docker', ...)`。
新 nested SSH 路径不得调用 `aicoding.openRemoteSsh.ensureSession/sessionExec`。open-remote-ssh 的 legacy `sessionExec` 命令本身不暴露远端进程 exit code；`SshDockerHostExecutor` 必须在命令尾部注入 exit-code marker 并剥离 marker 后返回真实 `exitCode`，否则 Docker 失败会被误判为成功。
通过 `execHostCommand` 跑远端探测脚本时，不要在脚本中途 `exit 0` 提前结束 shell；这会绕过 `SshDockerHostExecutor` 注入的 exit-code marker，导致 stdout / exitCode 解析不稳定。需要提前命中时，把结果存到变量，最后统一 `printf` 返回。
通过 `execHostCommand` 跑多行探测脚本时，应执行 `/bin/sh -s` 并通过 `stdin` 传脚本，不要把带嵌套引号的多行 POSIX shell 直接作为命令字符串交给远端默认 shell；csh/tcsh 默认 shell 会提前解释这些引号并破坏脚本。
SSH 模式下所有直接 `docker ...` 调用都必须经 `SshDockerHostExecutor` 统一补上远端登录 shell 的 PATH（见 `src/utils/remoteLoginPath.ts`），不能只在 `ContainerManager` 的远端 `@devcontainers/cli` 分支补 PATH。macOS SSH 非交互 exec 常见默认 PATH 不包含 `/usr/local/bin` / `/opt/homebrew/bin`，会让 Docker 探测误报不可用。
SSH DevContainer 安装容器内 IDE server 这类生成脚本必须走 `docker exec -i ... bash -s` + `stdin`，不要用 `docker exec ... bash -c <large script>`。外层 SSH host 的默认 shell 可能是 csh/tcsh，完整 bash 脚本作为参数会被 host shell 先拆解，出现 `Badly placed ()'s` / `Illegal variable name` / `SERVER_SCRIPT: Undefined variable`。
`inlineForwarder` 虽然必须用 raw `SSHConnection.execStream()` 保留双向字节流，也不能自己拼 `docker ...`；必须先通过 `SshDockerHostExecutor.buildDockerCommand()` 生成带 `remoteDockerPath` 和登录 shell PATH 的命令，再传给 `execStream()`。SSH / nested SSH forwarder 也不能写死容器内 `node`，必须复用 `ContainerManager.findNodeInContainer()` 解析出的 Node 路径，确保容器 PATH 没有 `node` 时能回退到 qoder-server 自带 Node。
本地 `scripts/forwarder.js` 是 local-only 路径，但也必须接收并使用 `remote.aicodingDevContainers.dockerPath`，默认值仍为 `docker`。不要在 forwarder 子进程里重新写死 Docker CLI 名称，否则配置了自定义 dockerPath 的本地用户会在 server 已启动后断在转发阶段。
`SshDockerHostExecutor.dispose()` 不要调用 `aicoding.openRemoteSsh.sessionDispose`。open-remote-ssh 目前按 authority 作为 opaque sessionId；旧 fallback 路径会创建多个短生命周期 executor 共享同一个 sessionId，任一 executor dispose 都可能把其他路径刚复用到的 session 删掉，触发 `Unknown SSH session id`。
SSH 模式下容器创建必须走远端 `@devcontainers/cli up`，由 CLI 输出 containerId；不要在本扩展里手写 `docker run -d` 并解析 stdout。

## configParser 双路径读 devcontainer.json

`findDevContainerConfig / parseDevContainerConfig / resolveDevContainerContext` 接受可选 `executor`：

- `executor?.isRemoteHost() === true`：通过 `executor.execHostCommand('test -f ... && cat ...')` 读取——devcontainer.json 在 SSH host 上，本地 ext-host 看不到。
- 否则：保留 `fs.promises.access / readFile` 不动。

**严禁**在 SSH 路径用 `vscode.workspace.fs.readFile(Uri.from({authority:'ssh-remote+host'}))`——dev-container 解析阶段窗口只有一个 active authority，访问 ssh-remote URI 会触发 VS Code 内核去解析第二个 authority，VS Code 不允许。

### 自动 Reopen 提示

激活阶段检测 `.devcontainer/devcontainer.json` / `.devcontainer.json` 也必须走同一套双路径 IO：

- 本地窗口用 `workspaceFolder.uri.fsPath` + 本地 `findDevContainerConfig`。
- SSH Remote 窗口用当前 `workspaceFolder.uri` + `vscode.workspace.fs.stat` 检查 `.devcontainer/devcontainer.json`。
- SSH Remote 自动提示默认可用；启动阶段自动探测失败只写 Remote-DevContainer 日志，不弹错误 toast，避免普通 SSH 工作区被 Docker / SSH 检测错误打扰。
- SSH Remote 自动提示不要创建 `DockerHostExecutor` / 调 `aicoding.openRemoteSsh.ensureSession`。当前窗口已经是 `ssh-remote`，为了一个提示再建 cross-extension session 会重复 resolve / install / tunnel。
- 激活阶段不能 `await` 会等待用户输入的 UI API（如 `showInformationMessage`）。自动提示必须在激活返回后后台异步调度，否则 `onCommand:openremotedevcontainer.reopenInContainer` 场景会卡在“激活插件”，命令 handler 无法及时派发。

## 双模式 forwarder

- **IDE Server 本地连接**：本地 Docker 模式继续使用 `scripts/forwarder.js`（独立 Node 子进程）→ `docker exec -i ...` 子进程。**原逻辑不动。**
- **IDE Server SSH 连接**：SSH / nested SSH 模式使用 `src/inlineForwarder.ts`（ext-host 内 `net.createServer`）→ `sshConnection.execStream(...)` 或 parent `ExecServer` stream → `docker exec -i ... <resolved-node> -e <bridge>`。bridge 是一段内联 JS，在容器里开 TCP socket 到 vscode-server 端口；`<resolved-node>` 必须来自 `ContainerManager.findNodeInContainer()`，不要直接假设容器 PATH 中存在 `node`。
- **业务端口转发**：`DevContainerResolver.tunnelFactory()` 接管 VS Code Ports 视图 / `Ports: Forward a Port` 触发的实际转发。端口候选发现仍走上游 `remote.autoForwardPorts` 与 `/proc` 扫描链路；resolver 只在收到 `TunnelOptions` 后创建本机 `127.0.0.1:<localPort>` listener，把每条连接桥接到容器内 `127.0.0.1:<remotePort>`。本地 Docker 业务端口也在 ext-host 内通过 `IDockerHostExecutor.spawnInteractive(['exec', '-i', ...])` 桥接，不复用 `scripts/forwarder.js`，避免污染 IDE Server 连接缓存和生命周期。
- Dev Container resolver 必须声明 `candidatePortSource = vscode.CandidatePortSource.Hybrid`。只用 `Process` 会漏掉 `npx serve .`、部分 FastAPI/前端 dev server 这类“命令行不包含端口、只在终端输出 URL”的场景；`Hybrid` 同时覆盖进程候选和输出 URL。不要在扩展里重写一套端口扫描，除非确认上游 candidate finder 没有启动或不能覆盖当前 authority。
- 业务端口转发必须返回可 dispose 的 `vscode.Tunnel`，关闭 forwarded port 时要关闭本地 listener，并清理已打开的 socket / SSH channel / ExecServer 进程 / docker exec 子进程。
- `tunnelFactory()` 不能只依赖 resolver 实例内存里的 active container。Dev Container 窗口重载或 ext-host 重启后，Ports 转发可能发生在一个新激活的扩展实例上；此时必须用当前 `vscode.env.remoteAuthority` + `connectionCache` 恢复 containerId、remoteUser、executor 和容器内 Node 路径。
- `tunnelFactory` 会被 VS Code 当普通回调函数保存和调用，构造 resolver 时必须显式 bind 到实例；否则回调内访问 `this.*` 会丢失上下文。

为何 SSH 不复用独立子进程：ssh2 `ClientChannel` 是 ext-host 进程内对象，跨进程传不动；命令 API 也不能传 stream。
显式 `devcontainer.json.forwardPorts` 的启动期预转发本次仍未实现；当前修复的是“端口被 VS Code 发现或用户手动输入后，resolver 能完成实际转发”的能力。

## SSH Remote 入口默认启用

SSH Remote 场景不再需要额外 feature flag。`Reopen in Container` / `Rebuild and Reopen in Container` / 容器树列表会直接根据当前窗口的 `ssh-remote+...` authority 构造 SSH executor；如果远端 Docker 不存在、SSH session 不可用或 devcontainer 配置不支持，则在实际执行路径报对应错误。本地路径仍保持原行为，不激活 `aicoding.open-remote-ssh`。
SSH Remote 下 Dev Containers 视图的 Running / Exited 分组默认折叠，避免视图注册时自动执行 Docker 查询并触发第二条 SSH resolve；用户展开分组或手动刷新时再按需连接 Docker host。
SSH Remote 空窗口（`workspaceFolders=none`）也必须按 SSH host 处理。判断当前 SSH host 时优先使用 `vscode.env.remoteAuthority`，不能只从 `workspace.workspaceFolders[0].uri.authority` 取值，否则 Dev Containers 面板会误走本地 Docker 并显示 Docker 不可用。

## 缓存 / 重连

`connectionCache` key 基础形态为 `${dockerHostCacheKey}:${workspacePath}:${devcontainerPath}`。本地为 `local`；nested SSH 为 parent authority（如 `ssh-remote+...`）；旧单层 SSH fallback 为 `ssh-remote+${sshHost}`。`authorityData.containerId` 存在时必须追加 `:${containerId}`。最终 key 还必须追加当前 IDE server 的 `${version}:${commit}`，缓存值也要记录 `serverVersion/serverCommit`。重连前除检查容器和端口存活，还必须校验 server 版本一致；否则升级 IDE 后会复用旧容器内 server，WebSocket 握手报 `Client refused: version mismatch`。缓存 storage key 已升到 `aicoding.devContainersConnectionCache_v1`，不要继续读取旧 v0 缓存。

### 容器内 IDE Server 下载续传

`src/serverSetup.ts` 把未完成的 server 包保存在容器内 `$SERVER_DATA_DIR/.download-cache/<commit>/<platform>-<arch>/server.tar.gz.part`，而不是一次性临时目录。`curl` 必须使用 Range 续传，`wget` 必须使用 continue；网络中断只保留 partial 并释放安装锁，下次 attach 从已有字节继续。URL 改变、gzip / md5 完整性校验失败时必须删除 partial，安装并校验成功后也要清理缓存。并发窗口用 commit 级 `.install-<commit>.lock` 串行安装，拿锁后必须重新检查 `SERVER_SCRIPT`。

这套逻辑运行在目标容器内部，因此本地 Docker、nested SSH host 上的 Dev Container、旧 `sshHost` fallback 必须保持同一行为；不得为 SSH Dev Container 在扩展里另起下载或 SSH 认证实现。

## 不可破坏的现有约束

- 本地路径行为字节级不变（参见 Step 2 of 实施计划）。
- 同步密码桥 / askpass 完全交由 open-remote-ssh 处理；本扩展**不**自己实现 SSH 认证。
- nested SSH 路径通过 `RemoteAuthorityResolverContext.execServer` 获取父 SSH host 能力；旧单层 fallback 才通过 `commands.executeCommand('aicoding.openRemoteSsh.ensureSession', sshAuthority, { skipInPlaceGuard: true })` 获取 SSH session。`skipInPlaceGuard` 仅在 legacy cross-extension flow 使用——正常 nested flow 不应依赖它。
- `runInitializeCommand` 在 SSH 模式跑在**远端 host shell**（与 VS Code 官方 Dev Containers 行为一致），不在本地宿主跑。devcontainer.json 作者需要自己处理远端可用 PATH。
- Dev Container 业务端口转发由本扩展 resolver 的 `tunnelFactory` 实现，支持本地 Docker、旧单层 SSH fallback、nested SSH Dev Container 三种 executor。不要把业务端口混入 `createResolverResult()` 或 `connectionCache`；那里只描述 IDE Server 连接。

## 子目录 / 关键文件

| 路径 | 职责 |
|---|---|
| `src/extension.ts` | 扩展激活 + 命令注册；负责 `extractSshHostFromCurrentWindow()` |
| `src/authResolver.ts` | `DevContainerResolver` — resolve / cache / forwarder 分发 |
| `src/containerManager.ts` | 容器生命周期；`up()` / `rebuild()` 双模式 |
| `src/configParser.ts` | devcontainer.json 解析（双模式 IO） |
| `src/serverSetup.ts` | 容器内 vscode-server 安装脚本 |
| `src/forwarder.ts` | 独立 Node 子进程（本地模式） |
| `src/inlineForwarder.ts` | ext-host 内 TCP server（SSH 模式） |
| `src/utils/authority.ts` | authority hex JSON 编解码 + `DevContainerAuthorityData` |
| `src/utils/docker.ts` | docker.* 工具函数；全部接 `executor` 参数 |
| `src/utils/remoteLoginPath.ts` | SSH host 登录 shell PATH 探测；供直接 Docker 调用和远端 CLI 调用复用 |
| `src/utils/executor/` | IDockerHostExecutor 抽象 + 双实现 + 工厂 |
