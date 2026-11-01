# aicoding-completion 扩展

> NES/NEXT（Next Edit Suggestion）—— AI 行间代码补全。产品参考：[NEXT 行间建议](https://docs.qoder.com/zh/user-guide/next-edit-suggestion)。

## 功能概述

基于当前代码上下文、修改历史和光标位置，预测下一段代码变更，支持：

- **跨文件编辑**：在一个文件修改时，预测其他相关文件的变更
- **函数级补全**：预测完整函数实现
- **自动导入**：检测未导入符号并添加 import
- **多点预测**：修改变量/函数名时，识别同文件内所有引用位置并给出更新建议

显示方式：根据变更宽度自动选择 Inline 或 Side by Side；Tab 采纳、Esc 拒绝；跨文件时支持 Tab to Jump 跳转。

---

## 核心流水线

```
触发 → 上下文收集 → 模型请求 → <next_edit> 解析 → 编辑队列 → 行间展示
```

| 阶段 | 职责 |
|------|------|
| **触发** | 光标变更、输入、采纳后、自动编辑等；`TriggerState` 管理触发上下文 |
| **上下文收集** | diff 历史、LSP 上下文、auto-import、光标历史、Linter 错误 |
| **模型请求** | `NESLanguageModelClient` 通过 `PluginApiManager` 调用 `aicoding-agent` 的 `triggerEditPredict` |
| **解析** | 流式解析 `<actions>` 内 `<next_edit>` 块，增量提取完整 action |
| **编辑队列** | `NextEditQueueManager` 管理多步编辑，支持采纳/拒绝、行号更新 |
| **行间展示** | `CustomInlineEdit` 实现 `InlineCompletionItem`，支持单文件/跨文件 |

---

## 关键模块

### 1. 触发与状态

- **`trigger-state.ts`**：`TriggerState` 管理触发来源（光标、输入、采纳、错误、自动导入等）及上下文（是否在注释/字符串）
- **`typing-speed-detector.ts`**：`DynamicDebounceManager` 动态防抖，根据输入速度调整触发延迟

### 2. 上下文收集

- **`diff-history/`**：`ModelManager` 管理文件版本与 diff 历史；`DiffWorkerPool` 异步计算 diff；`formatDiffHistory` 生成 prompt 用 diff 文本
- **`lsp-context/`**：`LSPContextManager` 负责 LSP 相关代码片段（`getRelatedCodes`）和 Import 分析（`getImportContext`）；`SemanticAnalyzer`、`LSPQueryManager`、`ImportAnalyzer` 协同；含断路器防 LSP 超时雪崩
- **`auto-import/`**：基于 LSP CodeAction 的自动导入；`AutoImportProvider`、`createAutoImportInlineEdit` 提供补全项
- **`document/tracker.ts`**：光标历史、最近浏览片段，用于 prompt

### 3. 模型请求与解析

- **`request/model.ts`**：`NESLanguageModelClient` 发起流式请求；`parseActionsIncremental` 增量解析 `<next_edit>`；首个完整 action 返回后立即展示，其余通过 `remainingActionsPromise` 异步追加
- **`plugin-api-manager.ts`**：对接 `aicoding-agent` 扩展的 `completion.triggerEditPredict`、`completion.onEditPredictAction`

### 4. 编辑队列

- **`next-edit-queue.ts`**：`NextEditQueueManager` 维护 `NextEditItem[]`；`getNext()` 按序取未使用项；`updatePositionsAfterEdit` 在采纳后更新后续项行号；支持跨文件（`filePath`）

### 5. 行间展示

- **`inline-edit/item.ts`**：`CustomInlineEdit` 实现 `vscode.InlineCompletionItem`；支持 `uri`、`displayLocation`、`action` 实现跨文件跳转；`diffStats` 用于埋点
- **`jump-file/item.ts`**：跨文件跳转时的 `JumpFileItem`

### 6. 配置

- **`config/`**：`GlobalConfigManager`、`ConfigConstants`、`FeatureController`；LSP/Import 开关、语言禁用、实验特性等
- **`common/config-keys.ts`**：配置 key 统一用 `aicoding` namespace

---

## `<next_edit>` 协议格式

模型响应包裹在 `<actions>...</actions>` 中，每个编辑为 `<next_edit>` 块：

```xml
<actions>
  <next_edit>
    <next_file>相对路径或空</next_file>   <!-- 可选，跨文件时指定目标文件 -->
    <next_start_line>起始行号</next_start_line>
    <next_end_line>结束行号</next_end_line>
    <next_content>替换内容</next_content>
  </next_edit>
  ...
</actions>
```

**操作语义**：

| startLine / endLine | content | 含义 |
|---------------------|---------|------|
| 相等 | 非空 | 插入：在指定行插入，末尾自动补 `\n` |
| 不等 | 空 | 删除：删除该行范围 |
| 不等 | 非空 | 替换：替换该行范围 |

行号为 **1-based**。解析时用正则增量匹配完整 `<next_edit>` 块，流式返回首个完整 action 后立即展示。

---

## 构建与入口

- **入口**：`src/extension.ts`
- **构建**：Webpack，`extension.webpack.config.js`（IDE 打包）与根目录 `webpack.config.js`（本地 `npm run compile`）；主入口 `extension`，Worker 入口 `diff-worker`。扩展图标：`media-qoder` / `media-lingma` 按环境变量 `APPNAME`（默认 `Qoder`）同步或复制到 `media/`，与 `aicoding-agent` 一致。
- **依赖**：`aicoding.aicoding-agent`（提供模型 API）
- **脚本**：`npm run compile` / `watch` / `build`；`npm run test` 跑 Jest

---

## 约束与注意点

1. **禁止动态 import**：按项目规范，使用静态 `import`
2. **配置 namespace**：统一用 `aicoding`，不用 `qoder`/`lingma`
3. **行号一致性**：模型与 prompt 使用 1-based；内部 `vscode.Range` 为 0-based，转换时需注意
4. **LSP 断路器**：连续超时 3 次会打开断路器，30 秒后恢复，避免 LSP 阻塞主流程
5. **diff 计算**：大文件可启用 Worker Thread（`diff-worker`），超时或失败会 fallback 到同步计算
6. **采纳后行号**：队列中后续编辑项需通过 `updatePositionsAfterEdit` 根据已采纳编辑的 `newLineCount` 更新行号
7. **跨文件路径**：`<next_file>` 可为相对路径，需结合 `workspaceFolder` 解析为绝对路径
