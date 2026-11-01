# AICoding Deeplink Extension

This extension registers the product URI handler and forwards deeplink requests to the workbench via `deeplink.handle`.

## URL Format

```text
qoder://aicoding.aicoding-deeplink/{path}?{params}
```

Lingma builds use the `lingma://` scheme with the same host and path.

## Supported Paths

- `/chat`
- `/quest`
- `/newchat`
- `/rule`
- `/command`
- `/mcp/add`

Examples:

```text
qoder://aicoding.aicoding-deeplink/chat?text=Help%20me%20write%20a%20function&mode=agent
qoder://aicoding.aicoding-deeplink/rule?name=typescript-strict&text=Always%20use%20strict%20types
qoder://aicoding.aicoding-deeplink/quest?text=Fix%20the%20login%20bug&agentClass=LocalWorktree

qoder://aicoding.deeplink/prompt?text=Help%20me%20write%20a%20function
qoder://aicoding.deeplink/rule?name=typescript-strict&text=Always%20use%20strict%20types
qoder://aicoding.deeplink/quest?text=Fix%20the%20login%20bug&agentClass=LocalWorktree
```
