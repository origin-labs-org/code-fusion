
`config/default.json` Yes随Customer端Publish的DefaultConfiguration，必须Retain。Desktop 从打包FileRead，
Web 在构建时导入；远端Request failedorMissing有效Character段时使用Built-inValue。

New版CommunityandFeedback入口RequestCurrent endpoint 的 `GET /api/v1/client/configs`，
Read `data.configs.feedbackUrl`：

- `community_urls["zh-CN" | "en-US"]`：只按Current语言回退到Built-in入口，不跨语言回退。
- `feedback_url`：远端有效地址优先，否则使用Built-in地址。
- `feedback_use_external_form`：远端布尔Value优先，`false` 也Yes有效覆盖。

Request携带 `app_version`；Desktop 另带 `platform-arch`，Web 省Omitted平台参Count。
成功响应仅做 1 小时inner存Cache，Request使用 `cache: no-store`，Failed不Cache。

```text
Current endpoint client/configs -> 有效HelpCharacter段 -> 平台入口
                  | 缺失 / Failed
                  v
          Built-in default.json -> 平台入口
```

Old CDN default.json 仅为Legacy versionCustomer端CompatibleRetain；New版无Requestor URL 构造链路，
不要因此Delete线上OldFileor本Table of ContentsBuilt-inFile。Built-inFile的OtherCharacter段与既有消费者保持不变。

详细规则见 [User Community入口Configuration](../docs/ui/settings-community-link-config.md)。
