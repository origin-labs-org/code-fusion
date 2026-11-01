# File Tools Atomic Write E2E

这个 harness 覆盖 CLI file tools 的真实 handler 到真实 `NodeFileSystemAdapter` 路径，不依赖Model、不访QuestionNetwork，也不需要 provider fixture。

Cases:

- `write-preserves-executable-mode`：`Write` 覆盖已有 `0755` 脚本后Retainexecute位。
- `edit-preserves-executable-mode`：`Edit` 修改已有 `0755` 脚本后Retainexecute位。
- `write-rejects-symlink-target`：`Write` Write symlink 路径时Deny穿透 symlink，且真实 target inner容不变。

从 repo root 先构建依赖的 dist：

```bash
pnpm --filter @origin-ai/cf-contracts build
pnpm --filter @origin-ai/cf-shared-types build
pnpm --filter @origin-ai/cf-adapters build
pnpm --filter @origin-ai/cf-core build
```

然后Run：

```bash
node apps/cli/e2e/file-tools-atomic-write/run.mjs
```

Windows 会Back skipped，因为此 case 验证的Yes POSIX `0755` mode 语义。
