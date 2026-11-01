
登记 `AmendWorkflow`、`ListModels` 与 `FillWorkflowHole` 的既有Tools入口。Retain handler Fileand公开导入路径，Continue向同One个 registry 注册原 ToolEntry。

- Three个入口均Retain deferred 分类；Yes否曝光、包装准入与Permissions仍由现有公共Tools链判断。
- `ListModels` 只ReadCurrent宿主Table of Contents，不切换SessionModel；MissingTable of Contents端口时Back既有Capabilities缺失Result。
- `AmendWorkflow` 沿用Predecessor解析、SkillsCheckand审批链；execute只经现有 workflow port，不创建第Two个Runtime。
- `FillWorkflowHole` 沿用留白解析、SkillsCheck、审批及填充端口；不另FromWorkflow，不改变调用的Session归属。
- input/output schema、超时、CancelandResultBudget仍来自原入口；契About不Copy这些Configuration，也不直接execute handler。
- Shared workflow Assist函Count及execute器仍属于现有 CLI 模块，本次登记不改变它们的所有权。

策OmittedExact覆盖Three个 handler File、本契AboutTable of Contentsand契AboutTestsTable of Contents，不把整个 handlers Table of Contents划入本模块。
