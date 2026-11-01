import { CF_OFFICIAL_PLUGIN_MARKETPLACE } from "@origin-ai/cf-contracts";

export interface OfficialPluginListingSeed {
  displayName?: string;
  displayName_i18n?: Record<string, string>;
  description_i18n?: Record<string, string>;
  category?: string;
  author?: { name: string; url?: string };
  icon?: string;
  homepage?: string;
  privacyPolicy?: string;
  termsOfService?: string;
  heroImage?: string;
  examplePrompts?: string[];
  examplePrompts_i18n?: Record<string, string[]>;
}

export const OFFICIAL_BROWSER_USE_PLUGIN_NAME = "browser-use";
export const OFFICIAL_BROWSER_USE_PLUGIN_ID = `${OFFICIAL_BROWSER_USE_PLUGIN_NAME}@${CF_OFFICIAL_PLUGIN_MARKETPLACE}`;

export const OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME = "node-repl-host";
export const OFFICIAL_NODE_REPL_HOST_PLUGIN_ID = `${OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME}@${CF_OFFICIAL_PLUGIN_MARKETPLACE}`;
export const OFFICIAL_CUA_PLUGIN_NAME = "computer-use";
export const OFFICIAL_CUA_PLUGIN_ID = `${OFFICIAL_CUA_PLUGIN_NAME}@${CF_OFFICIAL_PLUGIN_MARKETPLACE}`;

export interface OfficialPluginDefinition {
  
  componentTypes?: readonly string[];
  defaultEnabled?: boolean;
  listing?: OfficialPluginListingSeed;
  
  hostMcpServerNames?: readonly string[];
  name: string;
  
  requiredSeedPaths?: readonly string[];
  rootCandidates: readonly string[];
  /** Extra top-level paths intentionally staged as plugin runtime assets. */
  runtimeTopLevelPaths?: readonly string[];
  version: string;
}

const ZAI_AUTHOR = { name: "Z.ai", url: "https://z.ai" } as const;
const OFFICIAL_PLUGIN_ASSETS_BASE_URL = "https://cdn-cf.z.ai/cf/official-plugin/assets";

export const OFFICIAL_NODE_REPL_HOST_REQUIRED_SEED_PATHS = ["dist/mcp/server.js"] as const;

export const OFFICIAL_OFFICE_VIEWER_RUNTIME_PATHS = [
  "dist/server.mjs",
  "dist/ui/assets.json",
  "dist/ui/panel.html",
] as const;

export const OFFICIAL_BROWSER_USE_REQUIRED_SEED_PATHS = [
  "docs/api.json",
  "docs/documents.json",
  "docs/overview.md",
  "docs/recording.md",
  "docs/workflow.md",
  "scripts/browser-client.mjs",
  "skills/control-browser/SKILL.md",
  "skills/web-gui-tester/SKILL.md",
] as const;

export const OFFICIAL_CUA_REQUIRED_SEED_PATHS = [
  "docs/computer-use.md",
  "scripts/computer-use-client.mjs",
  "skills/computer-use/SKILL.md",
] as const;

export const OFFICIAL_CF_GUIDE_REQUIRED_SEED_PATHS = [
  "skills/cf-configuration-guide/SKILL.md",
] as const;

export const OFFICIAL_PLUGIN_DEFINITIONS: readonly OfficialPluginDefinition[] = [
  {
    defaultEnabled: true,
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Visualize",
      displayName_i18n: { "zh-CN": "交互视图" },
      description_i18n: { "zh-CN": "在对话中创建交互图表、解释和设计预览。" },
    },
    name: "visualize",
    requiredSeedPaths: [
      "skills/visualize/SKILL.md",
      "skills/visualize/references/api.md",
      "skills/visualize/references/styles.md",
      "skills/visualize/tweak.md",
      "skills/visualize/LICENSE.md",
      "skills/visualize/scripts/render.py",
      "skills/visualize/assets/visualize.css",
      "skills/visualize/assets/visualize.html",
      "skills/visualize/assets/calendar.js",
      "skills/visualize/assets/runtime-manifest.json",
      "skills/visualize/scripts/vendor.py",
      "skills/visualize/assets/vendor/manifest.json",
      "skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js",
      "skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js.LICENSE",
      "skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js",
      "skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js.LICENSE",
      "skills/visualize/assets/vendor/lucide-1.17.0.js",
      "skills/visualize/assets/vendor/lucide-1.17.0.js.LICENSE",
      "skills/visualize/assets/vendor/d3-7.9.0.min.js",
      "skills/visualize/assets/vendor/d3-7.9.0.min.js.LICENSE",
      "skills/visualize/widgets/calendar.md",
      "skills/visualize/examples/calendar.html",
      "skills/visualize/assets/standalone-host-bridge.js",
      "skills/visualize/assets/standalone-shell.js",
    ],
    rootCandidates: [
      "packages/visualize-plugin",
      "../visualize-plugin",
      "../../visualize-plugin",
      "../../../visualize-plugin",
    ],
    version: "0.1.0",
  },
  {
    //
    defaultEnabled: true,
    name: OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME,
    requiredSeedPaths: OFFICIAL_NODE_REPL_HOST_REQUIRED_SEED_PATHS,
    rootCandidates: [
      "packages/node-repl-host",
      "../node-repl-host",
      "../../node-repl-host",
      "../../../node-repl-host",
    ],
    version: "0.6.1",
  },
  {
    listing: {
      author: ZAI_AUTHOR,
      category: "developer-tools",
      displayName: "Android Emulator",
      displayName_i18n: { "zh-CN": "Android 模拟器" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/android-emulator/icon.png`,
      description_i18n: {
        "zh-CN": "提供 Android 开发工作流与模拟器自动化能力。",
      },
    },
    name: "android-emulator",
    rootCandidates: [
      "packages/android-emulator-plugin",
      "../android-emulator-plugin",
      "../../android-emulator-plugin",
      "../../../android-emulator-plugin",
    ],
    version: "0.1.0",
  },
  {
    defaultEnabled: true,
    hostMcpServerNames: ["node_repl"],
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Browser Use",
      displayName_i18n: { "zh-CN": "浏览器操作" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/browser-use/icon.png`,
      description_i18n: {
        "zh-CN": "Operate CodeFusion\'s built-in browser to inspect web pages and verify interactions.",
      },
    },
    name: OFFICIAL_BROWSER_USE_PLUGIN_NAME,
    requiredSeedPaths: OFFICIAL_BROWSER_USE_REQUIRED_SEED_PATHS,
    rootCandidates: [
      "packages/browser-use-plugin",
      "../browser-use-plugin",
      "../../browser-use-plugin",
      "../../../browser-use-plugin",
    ],
    version: "0.5.1",
  },
  ...(
    [
      ["documents", "docx", "Documents", "Word文档", "0.2.0"],
      ["pdf", "pdf", "PDF", "PDF", "0.2.1"],
      ["presentations", "pptx", "Presentations", "演示文档", "0.2.0"],
      ["spreadsheets", "xlsx", "Spreadsheets", "电子表格", "0.2.0"],
    ] as const
  ).map(
    ([name, skill, displayName, chineseName, version]): OfficialPluginDefinition => ({
      componentTypes: ["ui"],
      defaultEnabled: true,
      listing: {
        author: ZAI_AUTHOR,
        category: "productivity",
        displayName,
        displayName_i18n: { "zh-CN": chineseName },
        icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/document-skills/icon.png`,
        description_i18n: { "zh-CN": `创建、Edit与Review${chineseName}（${skill.toUpperCase()}）。` },
      },
      name,
      requiredSeedPaths: [
        "agents/visual-judge.md",
        `skills/${skill}/SKILL.md`,
        `skills/${skill}-viewer/SKILL.md`,
        ...OFFICIAL_OFFICE_VIEWER_RUNTIME_PATHS,
      ],
      rootCandidates: [
        `packages/${name}-plugin`,
        `../${name}-plugin`,
        `../../${name}-plugin`,
        `../../../${name}-plugin`,
      ],
      version,
    }),
  ),
  {
    defaultEnabled: true,
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Image Search",
      displayName_i18n: { "zh-CN": "搜图" },
      description_i18n: { "zh-CN": "查找插图与参考配图。" },
    },
    name: "image-search",
    requiredSeedPaths: [".mcp.json"],
    rootCandidates: [
      "packages/image-search-plugin",
      "../image-search-plugin",
      "../../image-search-plugin",
      "../../../image-search-plugin",
    ],
    version: "0.1.1",
  },
  {
    listing: {
      author: ZAI_AUTHOR,
      category: "developer-tools",
      displayName: "iOS Simulator",
      displayName_i18n: { "zh-CN": "iOS 模拟器" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/ios-simulator/icon.png`,
      description_i18n: {
        "zh-CN": "提供 iOS 开发工作流与模拟器自动化能力。",
      },
    },
    name: "ios-simulator",
    rootCandidates: [
      "packages/ios-simulator-plugin",
      "../ios-simulator-plugin",
      "../../ios-simulator-plugin",
      "../../../ios-simulator-plugin",
    ],
    version: "0.1.0",
  },
  {
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "Restore Legacy Sessions",
      displayName_i18n: { "zh-CN": "恢复旧版会话" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/restore-legacy-sessions/icon.png`,
      description_i18n: {
        "zh-CN": "将旧版会话恢复为 CodeFusion 任务与会话记录。",
      },
    },
    name: "restore-legacy-sessions",
    rootCandidates: [
      "packages/restore-legacy-sessions-plugin",
      "../restore-legacy-sessions-plugin",
      "../../restore-legacy-sessions-plugin",
      "../../../restore-legacy-sessions-plugin",
    ],
    version: "0.1.0",
  },
  {
    defaultEnabled: true,
    name: "plugin-creator",
    version: "0.1.1",
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "Plugin Creator",
      displayName_i18n: { "zh-CN": "插件创建器" },
      description_i18n: {
        "zh-CN": "开发、校验 CodeFusion 插件，完成本地 dev 市场安装、试用与更新。",
      },
    },
    rootCandidates: [
      "packages/plugin-creator-plugin",
      "../plugin-creator-plugin",
      "../../plugin-creator-plugin",
      "../../../plugin-creator-plugin",
    ],
    requiredSeedPaths: [
      "skills/plugin-creator/SKILL.md",
      "skills/plugin-creator/scripts/create-basic-plugin.mjs",
      "skills/plugin-creator/scripts/marketplace-files.mjs",
      "skills/plugin-creator/scripts/upsert-dev-marketplace.mjs",
      "skills/plugin-creator/scripts/scaffold-files.mjs",
      "skills/plugin-creator/scripts/validate-plugin.mjs",
      "skills/plugin-creator/references/plugin-json-spec.md",
      "skills/plugin-creator/references/installing-and-updating.md",
    ],
  },
  {
    defaultEnabled: true,
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "Skill Creator",
      displayName_i18n: { "zh-CN": "技能创建器" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/skill-creator/icon.png`,
      description_i18n: { "zh-CN": "创建、编辑和验证可复用的 CodeFusion 技能。" },
    },
    name: "skill-creator",
    rootCandidates: [
      "packages/skill-creator-plugin",
      "../skill-creator-plugin",
      "../../skill-creator-plugin",
      "../../../skill-creator-plugin",
    ],
    version: "0.1.0",
  },
  {
    defaultEnabled: true,
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "CodeFusion Guide",
      displayName_i18n: { "zh-CN": "CodeFusion 使用指南" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/cf-guide/icon.png`,
      description_i18n: {
        "zh-CN": "提供 CodeFusion 配置指南与插件、技能、MCP、命令和钩子诊断。",
      },
      examplePrompts: [
        "How do I configure MCP servers in CodeFusion?",
        "Diagnose my current CodeFusion setup",
      ],
      examplePrompts_i18n: {
        "zh-CN": ["CodeFusion 里怎么配置 MCP 服务器？", "帮我诊断当前的 CodeFusion 配置"],
      },
    },
    name: "cf-guide",
    requiredSeedPaths: OFFICIAL_CF_GUIDE_REQUIRED_SEED_PATHS,
    rootCandidates: [
      "packages/cf-guide-plugin",
      "../cf-guide-plugin",
      "../../cf-guide-plugin",
      "../../../cf-guide-plugin",
    ],
    version: "0.3.0",
  },
  {
    name: "computer-use",
    hostMcpServerNames: ["node_repl"],
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Computer Use",
      displayName_i18n: { "zh-CN": "电脑控制" },
      description_i18n: {
        "zh-CN": "自动化桌面应用：智能体驱动鼠标、键盘与界面元素，代你完成实际任务。",
      },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/cf-cua/icon.png`,
    },
    rootCandidates: [
      "packages/cf-cua-plugin",
      "../cf-cua-plugin",
      "../../cf-cua-plugin",
      "../../../cf-cua-plugin",
    ],
    requiredSeedPaths: OFFICIAL_CUA_REQUIRED_SEED_PATHS,
    runtimeTopLevelPaths: ["node_modules"],
    version: "0.6.5",
  },
];

export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set(
  OFFICIAL_PLUGIN_DEFINITIONS.filter((definition) => definition.defaultEnabled).map(
    (definition) => `${definition.name}@${CF_OFFICIAL_PLUGIN_MARKETPLACE}`,
  ),
);

export function resolveOfficialPluginHostMcpServerNames(pluginId: string): string[] {
  const definition = OFFICIAL_PLUGIN_DEFINITIONS.find(
    (candidate) => `${candidate.name}@${CF_OFFICIAL_PLUGIN_MARKETPLACE}` === pluginId,
  );
  return definition?.hostMcpServerNames ? [...definition.hostMcpServerNames] : [];
}

export function resolveOfficialPluginNameByHostMcpServerName(
  serverName: string,
): string | undefined {
  return OFFICIAL_PLUGIN_DEFINITIONS.find((definition) =>
    definition.hostMcpServerNames?.includes(serverName),
  )?.name;
}
