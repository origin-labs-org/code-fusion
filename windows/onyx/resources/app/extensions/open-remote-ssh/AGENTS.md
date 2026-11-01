# open-remote-ssh

Lingma IDE 一方的 Open Remote SSH 扩展。负责把 `vscode-remote://ssh-remote+...` URI 解析成可用的 SSH 通道、安装/启动远端 server、维护 askpass / tunnel / 重连。

## 修改标记约定

`extensions/open-remote-devcontainer`、`extensions/open-remote-ssh`、`extensions/open-remote-wsl` 都是 Lingma IDE 一方插件，不按 `src/vs/**` 的上游代码合并规则处理。修改这些目录时**不需要**添加 Lingma 编辑标记或 region 包裹。

## 关键架构约束

### SSH 密码桥接（Agents Window in-place vs 主 IDE 窗口）

- 真源：`src/aicodingSSHBridge.ts`。
- 调用入口：`src/authResolver.ts` 4 处密码 prompt（password / passphrase / keyboardInteractive / proxyCommand）+ `src/askpassServer.ts` 1 处 askpass。
- 仅当 **`inPlaceConnectMode === true` 且 `activeInPlaceAuthority === request.authority`** 时才把密码请求桥到 `aicoding.ssh.requestPassword` 命令；其余情况（含主 IDE 窗口）直接走 `vscode.window.showInputBox`。
- handler 端（`src/lingma/agents-window/browser/agentsWindowSSHSessionService.ts`）必须再做 source / authority / status 三重校验，缺一不可。仅靠 status 守卫会让 Agents Window 的 pending deferred 抢占主 IDE 窗口的密码框（曾经的 Bug 81819403）。
- 跨进程哨兵字符串值是 `'__LINGMA_FALLBACK__'`，**值不能改**（双侧字面比对，改值需扩展进程与主进程原子升级）；常量名使用 `AICODING_BRIDGE_FALLBACK_SENTINEL`。
- `tryRequestPasswordViaCommand` 的 catch **只**对「`command 'xxx' not found`」静默回退；其他异常原样抛出，由 `requestPasswordWithAicodingBridgeOrInputBox` 记录 `error` 并回退原生 InputBox。**不要改回静默 `catch {}`**——会重新掩盖类似 81819403 的回归。

### Resolver 串行化

`RemoteSSHResolver` 内部的 `sshConnection`、`tunnels`、`socksTunnel`、`proxyConnections` 是单例状态。Agents Window 在旧 authority 还在重连 / server install 时切换新 host 会触发并发 `resolveAuthority`；resolver 必须串行处理 resolve、cleanup/auth/install/tunnel 前要先核对 active in-place authority，否则旧请求会抢占新 tunnel。

### ProxyJump 端口语义

`ProxyJump` 链路里有两类端口，不能混用：

- 跳板机 SSH 端口：只来自跳板机 Host 块的 `Port`，或 `ProxyJump user@host:port` 中的端口；都没有时按 OpenSSH 语义回退到 22。
- 目标机转发端口：最后一跳使用目标 Host 块的 `Port` / authority 里的端口；中间多跳使用下一跳自己的 `Port` / `ProxyJump host:port`。

不要让跳板机 SSH 端口继承最终目标机的 `sshPort`。例如 `Host target; Port 3737; ProxyJump jump` 只表示从跳板机转发到目标 3737，不表示连接跳板机也要用 3737；否则会让“目标机自定义端口 + 默认 22 跳板机”的配置误连跳板机端口。

### ProxyCommand 本地启动语义

`ProxyCommand` 在本地 UI extension host 上执行，启动方式必须由客户端平台决定，与远端系统无关。SSH 与非 SSH ProxyCommand 必须复用 `prepareProxyCommandSpawn()`：Windows 的 `.bat` / `.cmd`（扩展名大小写不敏感）通过 shell 启动，`.exe`、裸命令和显式 `cmd /c` 直接按独立参数 spawn，不能添加 Unix shell 的 `exec`；macOS/Linux 保持 `exec <command>` 的进程替换语义。需要管道、重定向等 Windows shell 能力时，SSH config 应显式写 `cmd /c` 或使用批处理文件，不能对任意可执行程序隐式启用 shell。

### OpenSSH ControlMaster 复用

普通 Editor / Quest Remote SSH 会保守复用用户本机已有的 OpenSSH ControlMaster 会话。该能力不暴露成产品设置项，默认行为等价内部 `"auto"`：先要求本扩展解析到 Host 配置里有 `ControlMaster` 和 `ControlPath` 提示，再要求非 Windows、本机 `ssh`/`scp` 可用、`ssh -G <host>` 计算出有效 `ControlMaster` 和非空 `ControlPath`、且 `ssh -O check <host>` 确认已有 master session 时才启用 OpenSSH transport；任一预检失败都记录原因并回落现有 `ssh2` transport。代码仍兼容读取隐藏诊断键 `remote.SSH.useOpenSSHControlMaster`，`"always"` 可用于诊断，预检失败时应直接报错；`"never"` 可临时完全回到 `ssh2`。

OpenSSH transport 只允许清理本扩展启动的 `ssh -N -L/-D` / `scp` 子进程或 cancel 本扩展创建的 forward，禁止执行 `ssh -O exit` 或关闭用户自己的 master session。OpenSSH mux client 在复用 master 后可能以 code 0 退出，但端口转发仍挂在 master 上；此时必须继续检测本地端口是否可连，不要把 code 0 当作隧道失败。`"auto"` 下若 OpenSSH transport 运行期失败，应记录原因并让该 host 后续重试回退 `ssh2`；`"always"` 仍保留诊断失败。该 v1 能力只覆盖普通 Remote SSH；`resolveExecServer()`、`aicoding.openRemoteSsh.ensureSession` 和 Dev Container nested SSH 仍强制走 `ssh2`，以保护 raw stream、SFTP、`execStream` 和 Docker forwarder 兼容性。Quest 入口不得另起认证链路，仍通过本 resolver、AskpassServer 与 Agents Window in-place bridge 接管密码/OTP。

### Unix server 安装脚本执行方式

Unix/Linux 远端安装 `qoder-server` 时，安装脚本应通过 `printf %s <gzip+base64-script> | base64 -d/-D | gzip -dc | bash` 作为单条 exec 命令执行，不要改成 `conn.execPartial('bash', ..., { stdin })`。AIS/ssctl 这类 `127.0.0.1:<port>` 本地直连隧道上，`ssh2` 打开 `bash` 后再通过 channel stdin 写入脚本可能卡住，表现为 SSH 认证和 `uname` 正常，但脚本第一行 marker 都没有输出；同时不能退回 `bash -c '<escaped script>'`，csh/tcsh 登录 shell 不理解 POSIX 单引号转义，会把 bash 脚本拆开当成本 shell 执行。

脚本载荷必须先压缩再 base64，避免 base64 膨胀后单条 SSH exec command 超过部分 sshd / 本地隧道链路约 32KB 的敏感区间。若日志里出现 `Installation script execution completed` 后 stdout/stderr 都为 0，且找不到第一行 `SCRIPT_START_MARKER_*`，优先检查安装命令长度是否重新膨胀。

若 gzip+base64 单条命令仍没有输出可解析的 `${scriptId}: start/end`，允许 fallback 到分块写入 raw base64 临时文件再 `base64 -d/-D | bash`。fallback 仍不得使用 SSH channel stdin，也不得把完整 bash 脚本塞回 `bash -c`；每条写入命令应保持小尺寸，兼容 AIS/ssctl 和 csh/tcsh 登录 shell。

安装脚本在输出 `${scriptId}: start/end` 结果 marker 前不得同步 kill 可能匹配当前脚本自身的进程。ProxyJump SOCKS 端口变化需要重启 Go/Cosy 时，必须先保证 install stdout 可被 `parseServerInstallOutput` 解析，再通过后置/后台动作重启；后台动作的 stdout/stderr 必须重定向，不能污染 install result。

### IDE Server 包下载续传

所有 Remote SSH 下载分支都必须按 `commit + platform + arch + URL` 复用 partial，而不是在每次 resolve 时删除重下：

- Unix 远端直连：`$SERVER_DATA_DIR/.download-cache/<commit>/<platform>-<arch>/*.part`。
- Windows 远端直连：同样位于 `$SERVER_DATA_DIR/.download-cache/<commit>/win32-<arch>/`，通过 HTTP Range 追加。
- ProxyJump 跳板机下载：`$HOME/.aicoding-server-download-cache/<target-key>/<commit>/<platform>-<arch>/`；路径前缀必须品牌中性。
- 目标机不可联网时的本机下载：系统临时目录下 `aicoding-server-download-cache/<target-key>/<commit>/<platform>-<arch>/`。

`target-key` 必须由目标 SSH 的 host / port / username 派生，避免两个不同目标通过同一跳板机或同一客户端并发下载相同版本时写入同一个 partial。传输错误、超时或 IDE 退出时保留 partial，下次连接从已有字节继续；服务端忽略 Range 并返回 200 时必须安全覆盖，不能把完整响应追加到 partial。URL 改变或 gzip / md5 校验失败时删除 partial，安装成功后清理。多窗口仍由 commit 级安装锁串行，拿锁后重新检查 server 是否已由其他窗口安装。跳板机到目标机、本机到目标机的二次传输当前采用完整重试，但源下载缓存必须保留，避免传输失败后再次从 CDN 下载。

### Askpass server 单例 + per-authority context

`AskpassServer` 是 resolver 内部单例。`ensureAskpassServerWithBridgeContext(authority)` 会复用同一实例，但替换 `bridgeContextProvider` 闭包，使新一轮 prompt 拿到当前 authority 的 in-place context。理论上同一实例上若残留旧 authority 的 pendingRequests，resolve 时会读到新 context；目前是低概率边角，长期可考虑切 authority 时 reset pendingRequests 或随请求 capture context 快照。

Unix/macOS askpass IPC 必须使用短 socket 路径。macOS 的 Unix domain socket 路径长度限制很小，不能把 socket 放进 `~/Library/Caches/<appName>/askpass-<long-hash>.sock` 这类用户目录；尤其扩展宿主为三方插件兼容会把 `vscode.env.appName` 暴露成 `Visual Studio Code`，目录名会变成较长的 `visual-studio-code`。当前约束是优先使用 `/tmp/aicoding-ssh-<uid>/ap-<pid>-<random>.sock` 这类短、品牌中性的路径，并在 `listen` 失败后清理 server/socket 状态再 fallback 到下一个安全目录。

### `getSSHAuthHandler(authority, ...)`

proxy / jump host / main connection 三个调用点都传**最终目标 authority**（不是 proxy host / jump host 的虚拟 authority）。React Dialog 跟随 session 目标 authority 校验，proxy/jump 的密码 prompt 也归属于这次 in-place 连接。React 端可在 Dialog 标题里区分 "Proxy / Jump host / Password for X" 提升用户体验。

## `resolveExecServer` 契约（nested remote authority）

为支持 `dev-container+...@ssh-remote+...` 这类 nested authority，本扩展必须实现 `RemoteAuthorityResolver.resolveExecServer(authority, context)`。内核会先对 parent `ssh-remote+...` 调 `resolveExecServer()`，然后把返回的 `ExecServer` 作为 `RemoteAuthorityResolverContext.execServer` 传给内层 dev-container resolver。

**约束（不可破坏）**：

- `resolveExecServer` 必须复用现有 SSH 认证、ProxyJump、askpass、连接池和 in-place guard 体系，不允许绕开 `RemoteSSHResolver.resolve()` 另起一套 SSH 认证逻辑。
- 返回的 `SshExecServer.spawn()` 必须保留 stdout/stderr 分流、stdin 写入和真实 exit code。不能退回到 `sessionExec` 那种只收集输出、exit code 需要 marker 修补的接口。
- `SshExecServer.fs` 通过 SFTP 提供 devcontainer 需要的 `stat/read/write/mkdirp/rm/rename/readdir/connect` 子集；不支持或 SSH server 不支持的能力要抛出可诊断错误。
- `tcpConnect()` / `fs.connect()` 必须走 ssh2 forwarding 能力，使 dev-container 可以通过 parent SSH 连接访问远端 TCP/Unix socket。
- `ExecServer` 生命周期由 parent authority resolver 管理，dev-container executor dispose 不应关闭底层 SSH 连接。

## Cross-extension session 入口（legacy `aicoding.openRemoteSsh.*` 命令族）

为兼容旧单层 `dev-container+<hex json with sshHost>` authority，以及少数尚未迁到 ExecServer 的 fallback 路径，本扩展仍暴露一组 `vscode.commands`：

| 命令 | 入参 | 返回 | 用途 |
|---|---|---|---|
| `aicoding.openRemoteSsh.apiVersion` | – | `number` | 兼容性探测；当前 `1` |
| `aicoding.openRemoteSsh.ensureSession` | `sshAuthority, { skipInPlaceGuard?: boolean }` | `sessionId: string` | 复用 pool / 新建一条 SSH 连接，返回不透明 id |
| `aicoding.openRemoteSsh.sessionExec` | `sessionId, cmd, { stdin?, timeoutMs? }` | `{exitCode, stdout, stderr}` | 在已建立的 SSH 上跑命令 |
| `aicoding.openRemoteSsh.sessionAddTunnel` | `sessionId, TunnelConfig` | `{localPort, tunnelName}` | 建 TCP / SOCKS / Unix-socket 隧道 |
| `aicoding.openRemoteSsh.sessionCloseTunnel` | `sessionId, tunnelName?` | – | 关闭单条/全部隧道 |
| `aicoding.openRemoteSsh.sessionDispose` | `sessionId` | – | 释放 cross-extension 引用，**不**关闭底层 SSH 连接（pool 保活） |

**约束（不可破坏）**：

- `api` 字段保持 `"none"` —— 不通过 `extensions.exports` 暴露。原因：VS Code `extHostExtensionService.ts:1199` 对 `api === 'none'` 直接返回 `undefined`，且我们想避开 cross-extension 静态耦合。
- `skipInPlaceGuard: true` 仅 cross-extension caller 可用；它绕过 `rejectIfStaleInPlaceResolve`（authResolver.ts:604-622）。原因：dev-container 等 peer 不参与 in-place authority 生命周期，不应被 in-place 校验拒掉。**VS Code 内核自身的 reconnect 路径不会传该参数**，所以 81819403 类回归不会被引入。
- 新 SSH DevContainer 默认路径不得调用 `ensureSession/sessionExec`；它必须走 nested authority + `resolveExecServer`。修改时不要把 legacy 命令族继续做厚来替代 ExecServer。
- `sessionId` 用 sshAuthority 字面值作为 key，**调用方不要尝试解析**。Pool key（`sshConnectionKey`，authResolver.ts:770）由 host/user/port/proxy 派生，cross-extension 不接触。
- 同一 ext-host 进程内（两扩展都是 `extensionKind: ["ui"]`）的 caller 可以读 `globalThis[__aicodingOpenRemoteSshRegistry__]` 拿到原始 `SSHConnection` 实例，用于需要 ssh2 `ClientChannel` 双向 stdio 的场景（dev-container inline forwarder）。跨进程 caller 拿到 `undefined`，**这是正常 fallback 信号**。

**`SSHConnection.execStream(cmd)`**：返回原始 `ClientChannel`（Duplex Stream），让调用方做 `socket.pipe(channel)` + `channel.pipe(socket)` 原生背压。区别于 `exec`（收集 stdout/stderr 到完成）。仅供同 ext-host 调用方使用。

**cacheKey 含 parent host 约束**：dev-container 侧 `connectionCache` key 以 docker host 为前缀，本地为 `local`，nested SSH 为 parent authority，legacy fallback 为 `ssh-remote+${sshHost}`。跨 host 同路径不能撞 key。本扩展不维护该 cache，但 invariant 写在这里方便交叉对照。

## webpack shim：core-js engine-user-agent

`src/shims/coreJsEngineUserAgent.ts` + 两份 webpack 配置里的 `NormalModuleReplacementPlugin`，把 `core-js-pure/internals/engine-user-agent` 替换成返回空字符串的 stub。

- **为什么**：core-js-pure 经 `simple-socks → @babel/runtime-corejs3` 间接进入打包；该模块在 Node 扩展宿主下读取 `globalThis.navigator` 会触发 `PendingMigrationError: navigator is now a global` 噪音 / warning。
- **为什么安全**：原模块在 Node 上下文本就返回 `''`，shim 行为等价；core-js 下游分支（如 `engine-v8-version`）优先走 `process.versions.v8`，不依赖此值。
- **副作用半径**：ssh2 / ssh2-streams 不依赖 core-js-pure。

如果未来添加新依赖间接拉入 `engine-user-agent` 且需要真实 UA 字符串，需要把 shim 改成根据上下文返回值。

## webpack shim：ssh2 util.isDate 兼容（Node 23+ / Electron 42）

Node 23+ / Electron 42 移除了 `util.isDate`（DEP0047），而当前依赖的 `ssh2@1.14`（jeanp413 fork）在 `lib/protocol/SFTP.js` 顶层仍执行：

```js
const { inherits, isDate } = require('util');
```

若模块加载时捕获到的 `isDate` 为 `undefined`，`createWriteStream()` 会在发出第一个 SFTP OPEN 请求前抛错；生产包压缩后表现为 `l is not a function`，日志落在 `[Local Download] Failed`，同时影响本地下载后上传、fallback 上传、跳板机传输和 nested Dev Container 文件写入。

当前用**两层互补**方式修复，二者均需保留：

1. **全局补丁**：`src/shims/patchUtilIsDate.ts`（`extension.ts` 首行 import）+ `webpack.config.js` 的 `BannerPlugin`（在 module graph 外 prepend 一次 `require("util")` 补丁），在 **ssh2 首次被 require 之前**给真正的 `require('util')` 对象补上 `isDate`。
   - **禁止** `import * as util from 'util'` / `node:util` 后再赋值：esModuleInterop 下 `__importStar()` 得到的是 namespace **副本**，给副本设 `isDate` 对 ssh2 不可见（历史修复曾因此静默失效）。正确做法：`import util from 'util'`（default import）或 `require('util')`，再 `util.isDate = util.types.isDate`。
2. **模块替换**：`src/shims/ssh2Util.ts` + 两份 webpack 配置（`webpack.config.js` / `extension.webpack.config.js`）的 `NormalModuleReplacementPlugin`，把 `ssh2/lib/protocol` 上下文的 `require('util')` 替换成保留完整 `util` 导出（`inspect` / `inherits` 等）并把旧 `util.isDate` 别名到 `util.types.isDate` 的 shim；该替换只作用于 `ssh2/lib/protocol`，不全局改写 Node `util`。

如果 fork 后续同步了上游 `util.types.isDate` 修复，两层 shim 仍保持等价行为。

## 子目录 / 关键文件

| 路径 | 职责 |
|------|------|
| `src/extension.ts` | 扩展激活入口 |
| `src/authResolver.ts` | `RemoteSSHResolver` — resolve、auth、tunnel、server install |
| `src/sshExecServer.ts` | SSH-backed `vscode.ExecServer`，供 nested authority 的 dev-container resolver 使用 |
| `src/askpassServer.ts` | Unix socket askpass 服务，对接 SSH 二进制 |
| `src/aicodingSSHBridge.ts` | Agents Window in-place 密码桥（真源） |
| `src/serverSetup.ts` | 远端 server 安装脚本 |
| `src/sshDestination.ts` | URI 解析、authority 编码 |
| `src/shims/coreJsEngineUserAgent.ts` | webpack module replacement stub |
| `src/shims/ssh2Util.ts` | `ssh2/lib/protocol` 的 `util.isDate` 兼容层（webpack module replacement） |
| `src/shims/patchUtilIsDate.ts` | 在 ssh2 加载前恢复全局 `util.isDate`（Node 23+ / Electron 42） |

上游侧细节看 `README.md` 与上游 commit history。
