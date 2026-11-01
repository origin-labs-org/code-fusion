# CLI subagent configuration

纯解析模块，独立 CLI loader 注入Textand禁用Status；Host ready 快照直接使用，不重复解析。解析RetainSource、namespace 与Diagnostics，fallback 只提供空的动态Configuration，不能Read磁盘or恢复OldTemplate。

初始化and每轮Read时序Continue由 bootstrap owner 负责；本模块不拥有Cache、Sub-sessionor副作用。
