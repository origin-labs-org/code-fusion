
[English](./README.md)

本Plugins注册 CodeFusion OfficialImage Search MCP Service，让 Agent 在制作Documentation、Presentation、海报orWeb时可以Search插图与参考配图。

- MCP Service `image_search`（HTTP），命名空间为 `plugin:image-search:image_search`。

- CodeFusion Session已登录且可访Question `${CF_BASE_URL}`；该Service使用 CodeFusion Official JWT 鉴权，无需手动Configuration Token or API Key。
- 可访Question CodeFusion API 的Network环Context。
- Installor更NewPlugins后需New CodeFusion Session。

Install后用Natural语言提出配图需求即可，例如「To封面找One张风力发电场的照片」，Agent 会调用Image SearchTools。
`documents`、`pdf`、`presentations` 等Plugins已不再Built-in该 MCP Service，需要在Documentation制作过程Medium使用Image Search时，
请与它们One并Install本Plugins。

- 本Plugins仅声明 MCP Service，不包含Command、Skills、Hooks or Agent。
- SearchResult经 CodeFusion Service来自Third-party图库，用于对outerDeliver前请自行确认Image授权。
