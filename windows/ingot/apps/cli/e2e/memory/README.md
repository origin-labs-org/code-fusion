# Memory E2E

这套 E2E 从真实 `createCfApp` 入口Run，使用Isolated的临时 workspace/storage andLocal
scripted provider。它验证 Memory 主链路已经正确组合，不依赖线上Model：

- Main Memory prompt 与冻结 fixture 逐CharacterOne致，并在 tool continuation Medium持续存在；
- scripted provider 同时识别 `default-index` 与 `semantic-recall` 两套合同，并从构建产物ReadCurrent
  active branch；
- Current `default-index` 构建Medium，非空 `MEMORY.md` 以 exact request user-context source 进入每个
  Main request，并按聚合Character段语义使该段只渲染One次 `# agentsMd`；不发 Selector Request、
  不注入 `relevant_memory`；
- 若唯One生产常量切换为 `semantic-recall`，同One runner 验证无 pointer/index，并在Complete tool
  continuation 后消费One次 `relevant_memory`；
- project root 已有事实不会被 dormant Recall Auto修改；
- 成功 Main turn 后的Background Extraction、`MEMORY.md` pointer 更New、显式 drain andFile落盘；
- Extraction provider request 在飞时Close session 会立即 abort；close 不Waiting其NaturalBack，迟到
  tool-use 不写File也不触发下One轮；
- Extraction Completed后New session，从Default分支的 request user-context source 消费New pointer，且仍
  不发 Selector Request；
- custom agent persistent Memory prompt、tool projection、独立 root andWrite；
- Memory disabled 时无 prompt、selector、Extraction or root 创建。
- `memory.extractionEnabled=false` 的 headless Runtime 仍Retain Main Memory prompt 与Current retrieval
  branch，但显式 drain 后没有 Extraction request，已有 `MEMORY.md` 与事实File保持不变；该断言按
  Main/Extraction Category判断，不把 semantic direct-answer 时Allow异步StartorCancel的 Selector 当成
  Extraction gate 的Evidence。

Run：

`--memory-bench` 另outer从 CLI `run` 入口Start真实子进程，注入IsolatedConfigurationand scripted provider，验证
阻塞 Extraction 时进程仍存活、Write后才Exit，以及Default headless、Memory Close与 SIGTERM Cancel。
该 fixture 使用非Streaming provider；CLI text/JSON/stream-json 的FinalOutput顺序由 `memory-bench.test.ts`
覆盖。Run independently `pnpm --dir apps/cli/e2e/memory run e2e:bench`，产物路径打印在控制台，
包含各场景的 provider capture、Lifecycle顺序、stdout/stderr、Final Memory File与Result。

```bash
pnpm --dir apps/cli run test:e2e:memory
```

复用已构建产物：

```bash
pnpm --dir apps/cli/e2e/memory run e2e -- --artifacts /tmp/cf-memory-e2e
```

Output：

```text
provider-capture.json
trajectory.jsonl
trajectory-summary.json
memory-files.json
result.json
```

`trajectory.jsonl` 按 `main | selector | extraction | custom_agent` 分类Save真实 provider request；
Evidence校验根据构建产物Medium的 active branch Deny任何 pointer/index 与 Selector/Recall Mixed组合。
冻结 fixture 另由 `memory-provider-body.test.ts` 直接校验Request体合同；Desktop WDIO 从真实抓包提取同One `# Memory` 段and
`MEMORY.md` user-context source 复用该合同。
Dream Current没有产品触发入口，因此不在这里增加Tests入口；gate、lock、tool loop and
`memory_update` 由 core runtime integration tests 覆盖，Final Anthropic Messages Request体由
`memory-provider-body.test.ts` 覆盖。
