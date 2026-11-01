Notice: This extension is bundled. It can be disabled but not uninstalled.

## IDE Server 下载续传

WSL 内的 IDE Server 包使用 `$SERVER_DATA_DIR/.download-cache/<commit>/<os>-<arch>/*.part` 保存未完成下载。网络中断或窗口关闭后，下次连接通过 HTTP Range / wget continue 从已有字节继续；多个窗口由 commit 级安装锁串行，拿锁后会重新检查 server 是否已经安装。

缓存以 commit、平台、架构和下载 URL 隔离。URL 变化、gzip 或 md5 校验失败时会丢弃 partial；安装及解压校验成功后清理缓存。纯传输失败不会删除 partial。
