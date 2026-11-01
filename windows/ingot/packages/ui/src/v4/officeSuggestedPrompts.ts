import finderIcon from "@/onboarding/assets/finder.png";
import terminalIcon from "@/onboarding/assets/terminal.png";
import feishuIcon from "@/onboarding/assets/feishu.png";
import type { DraftSuggestedPromptItem } from "@/v4/draftSuggestedPromptItems.js";

type RecommendedPrompt = DraftSuggestedPromptItem & {
  category: "development" | "office" | "finance" | "utility";
};

export const officeSuggestedPrompts: RecommendedPrompt[] = [
  {
    id: "official-0",
    category: "development",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/github/icon.png",
    label: {
      cn: "Help me check recent changes in this repository and highlight what\'s noteworthy",
      en: "Review recent changes in this repository and highlight what matters.",
    },
    prompt: {
      cn: "Help me check recent changes in this repository and highlight what\'s noteworthy",
      en: "Review recent changes in this repository and highlight what matters.",
    },
    plugin: {
      stableId: "github@cf-plugins-official",
      label: {
        cn: "GitHub",
        en: "github",
      },
    },
  },
  {
    id: "official-1",
    category: "development",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/gitlab/icon.png",
    label: {
      cn: "Review changes on the current branch and find issues to fix before submitting an MR",
      en: "Review this branch and find issues to fix before submitting a merge request.",
    },
    prompt: {
      cn: "Review changes on the current branch and find issues to fix before submitting an MR",
      en: "Review this branch and find issues to fix before submitting a merge request.",
    },
    plugin: {
      stableId: "gitlab@cf-plugins-official",
      label: {
        cn: "GitLab",
        en: "gitlab",
      },
    },
  },
  {
    id: "official-2",
    category: "development",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/mimosa/icon.png",
    label: {
      cn: "Scan this project for security vulnerabilities and prioritize fixing high-risk issues",
      en: "Scan this project for security issues and prioritize high-risk fixes.",
    },
    prompt: {
      cn: "Scan this project for security vulnerabilities and prioritize fixing high-risk issues",
      en: "Scan this project for security issues and prioritize high-risk fixes.",
    },
    plugin: {
      stableId: "mimosa@cf-plugins-official",
      label: {
        cn: "Code Security Protection",
        en: "mimosa",
      },
    },
  },
  {
    id: "official-3",
    category: "development",
    iconUrl: "https://docs.cloudbase.net/en/img/favicon.png",
    label: {
      cn: "Build a to-do mini-program with login and data storage",
      en: "Build a to-do mini program with sign-in and data storage.",
    },
    prompt: {
      cn: "Build a to-do mini-program with login and data storage",
      en: "Build a to-do mini program with sign-in and data storage.",
    },
    plugin: {
      stableId: "cloudbase-skills@cf-plugins-official",
      label: {
        cn: "CloudBase",
        en: "cloudbase-skills",
      },
    },
  },
  {
    id: "official-4",
    category: "development",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/video2code/icon.png",
    label: {
      cn: "Convert my provided screen recording into an interactive web page",
      en: "Recreate my website recording as an interactive page.",
    },
    prompt: {
      cn: "Convert my provided screen recording into an interactive web page",
      en: "Recreate my website recording as an interactive page.",
    },
    plugin: {
      stableId: "video2code@cf-plugins-official",
      label: {
        cn: "Video2Code",
        en: "video2code",
      },
    },
  },
  {
    id: "official-5",
    category: "development",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/browser-use/icon.png",
    label: {
      cn: "Check my local webpage and find layout and interaction issues",
      en: "Check my local website for layout and interaction issues.",
    },
    prompt: {
      cn: "Check my local webpage and find layout and interaction issues",
      en: "Check my local website for layout and interaction issues.",
    },
    plugin: {
      stableId: "browser-use@cf-plugins-official",
      label: {
        cn: "浏览器操作",
        en: "browser-use",
      },
    },
  },
  {
    id: "official-6",
    category: "office",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/lark-cli/icon.png",
    label: {
      cn: "Organize my Feishu work log from yesterday and list today\'s follow-up items",
      en: "Review yesterday’s Lark work records and list today’s follow-ups.",
    },
    prompt: {
      cn: "Organize my Feishu work log from yesterday and list today\'s follow-up items",
      en: "Review yesterday’s Lark work records and list today’s follow-ups.",
    },
    plugin: {
      stableId: "lark-cli@cf-plugins-official",
      label: {
        cn: "Feishu CLI",
        en: "lark-cli",
      },
    },
  },
  {
    id: "official-7",
    category: "office",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/tencent-meeting-cli/icon.png",
    label: {
      cn: "Summarize attendance for the latest meeting and generate a briefing",
      en: "Summarize attendance at my most recent Tencent Meeting.",
    },
    prompt: {
      cn: "Summarize attendance for the latest meeting and generate a briefing",
      en: "Summarize attendance at my most recent Tencent Meeting.",
    },
    plugin: {
      stableId: "tencent-meeting-cli@cf-plugins-official",
      label: {
        cn: "腾讯会议 CLI",
        en: "tencent-meeting-cli",
      },
    },
  },
  {
    id: "official-8",
    category: "office",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/wecom-cli/icon.png",
    label: {
      cn: "Check my schedule and to-dos for today and prioritize my tasks",
      en: "Review today’s WeCom calendar and to-dos and organize my work.",
    },
    prompt: {
      cn: "Check my schedule and to-dos for today and prioritize my tasks",
      en: "Review today’s WeCom calendar and to-dos and organize my work.",
    },
    plugin: {
      stableId: "wecom-cli@cf-plugins-official",
      label: {
        cn: "企业微信 CLI",
        en: "wecom-cli",
      },
    },
  },
  {
    id: "official-9",
    category: "office",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/document-skills/icon.png",
    label: {
      cn: "把我的笔记整理成一份排版清晰的 Word 文档",
      en: "Turn my notes into a clearly formatted Word document.",
    },
    prompt: {
      cn: "把我的笔记整理成一份排版清晰的 Word 文档",
      en: "Turn my notes into a clearly formatted Word document.",
    },
    plugin: {
      stableId: "documents@cf-plugins-official",
      label: {
        cn: "Word文档",
        en: "documents",
      },
    },
  },
  {
    id: "official-10",
    category: "office",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/document-skills/icon.png",
    label: {
      cn: "分析这份 Excel，找出关键趋势并生成图表",
      en: "Analyze this Excel file, identify key trends and create charts.",
    },
    prompt: {
      cn: "分析这份 Excel，找出关键趋势并生成图表",
      en: "Analyze this Excel file, identify key trends and create charts.",
    },
    plugin: {
      stableId: "spreadsheets@cf-plugins-official",
      label: {
        cn: "电子表格",
        en: "spreadsheets",
      },
    },
  },
  {
    id: "official-11",
    category: "office",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/video-agent/icon.png",
    label: {
      cn: "Help me trim this long video into a one-minute highlight clip with subtitles",
      en: "Edit this long video into a one-minute highlight reel with subtitles.",
    },
    prompt: {
      cn: "Help me trim this long video into a one-minute highlight clip with subtitles",
      en: "Edit this long video into a one-minute highlight reel with subtitles.",
    },
    plugin: {
      stableId: "video-agent-kit@cf-plugins-official",
      label: {
        cn: "Video Agent Kit",
        en: "video-agent-kit",
      },
    },
  },
  {
    id: "official-12",
    category: "finance",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/corporate-due-diligence/icon.png",
    label: {
      cn: "帮我对这家公司做一份尽调，重点看看关联关系和经营风险",
      en: "Perform due diligence on this company, focusing on relationships and business risks.",
    },
    prompt: {
      cn: "帮我对这家公司做一份尽调，重点看看关联关系和经营风险",
      en: "Perform due diligence on this company, focusing on relationships and business risks.",
    },
    plugin: {
      stableId: "vet-companies@cf-plugins-official",
      label: {
        cn: "Corporate Due Diligence",
        en: "vet-companies",
      },
    },
  },
  {
    id: "official-13",
    category: "finance",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/business-analysis/icon.png",
    label: {
      cn: "根据这份收支数据，做一份未来 13 周的现金流预测",
      en: "Use this income and expense data to forecast cash flow for the next 13 weeks.",
    },
    prompt: {
      cn: "根据这份收支数据，做一份未来 13 周的现金流预测",
      en: "Use this income and expense data to forecast cash flow for the next 13 weeks.",
    },
    plugin: {
      stableId: "run-fpa@cf-plugins-official",
      label: {
        cn: "经营分析",
        en: "run-fpa",
      },
    },
  },
  {
    id: "official-14",
    category: "finance",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/portfolio-tracking/icon.png",
    label: {
      cn: "Help me summarize my watchlist\'s performance today and noteworthy announcements",
      en: "Summarize today’s watchlist performance and notable announcements.",
    },
    prompt: {
      cn: "Help me summarize my watchlist\'s performance today and noteworthy announcements",
      en: "Summarize today’s watchlist performance and notable announcements.",
    },
    plugin: {
      stableId: "watch-positions@cf-plugins-official",
      label: {
        cn: "持仓跟踪",
        en: "watch-positions",
      },
    },
  },
  {
    id: "official-15",
    category: "utility",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/skill-creator/icon.png",
    label: {
      cn: "把我经常重复的工作流程做成一个可复用的技能",
      en: "Turn my recurring workflow into a reusable skill.",
    },
    prompt: {
      cn: "把我经常重复的工作流程做成一个可复用的技能",
      en: "Turn my recurring workflow into a reusable skill.",
    },
    plugin: {
      stableId: "skill-creator@cf-plugins-official",
      label: {
        cn: "技能创建器",
        en: "skill-creator",
      },
    },
  },
  {
    id: "official-16",
    category: "utility",
    iconUrl: "https://cdn-cf.z.ai/cf/official-plugin/assets/cf-guide/icon.png",
    label: {
      cn: "帮我检查当前的 CodeFusion 配置，看看有哪些可以调整",
      en: "Review my CodeFusion configuration and suggest useful adjustments.",
    },
    prompt: {
      cn: "帮我检查当前的 CodeFusion 配置，看看有哪些可以调整",
      en: "Review my CodeFusion configuration and suggest useful adjustments.",
    },
    plugin: {
      stableId: "cf-guide@cf-plugins-official",
      label: {
        cn: "CodeFusion 使用指南",
        en: "cf-guide",
      },
    },
  },
];

export function getRecommendedPromptPool(
  isOfficeMode: boolean,
  occupation?: string | null,
): DraftSuggestedPromptItem[] {
  const preferred = occupation === "finance" ? "finance" : isOfficeMode ? "office" : "development";
  const eligible = officeSuggestedPrompts.filter(
    (item) => item.category !== "finance" || occupation === "finance",
  );
  return [
    ...eligible.filter((item) => item.category === preferred),
    ...eligible.filter((item) => item.category !== preferred),
  ];
}

export const defaultSuggestedPrompts: DraftSuggestedPromptItem[] = [
  {
    id: "office-organize",
    iconUrl: finderIcon,
    label: {
      cn: "Help me see what files are taking up the most space on my computer",
      en: "Help me see which files are taking up the most space on my computer.",
    },
    prompt: {
      cn: "Help me see what files are taking up the most space on my computer",
      en: "Help me see which files are taking up the most space on my computer.",
    },
  },
  {
    id: "office-clean",
    iconUrl: terminalIcon,
    label: {
      cn: "Help me clean up redundant files on my computer using Mole CLI",
      en: "Use Mole CLI to clean redundant files on my computer.",
    },
    prompt: {
      cn: "Help me clean up redundant files on my computer using Mole CLI",
      en: "Use Mole CLI to clean redundant files on my computer.",
    },
  },
  {
    id: "office-review",
    iconUrl: feishuIcon,
    label: {
      cn: "Use Feishu CLI to fetch my work updates from yesterday and organize today\'s to-dos",
      en: "Use Feishu CLI to review my work from yesterday and organize today’s to-dos.",
    },
    prompt: {
      cn: "Use Feishu CLI to fetch my work updates from yesterday and organize today\'s to-dos",
      en: "Use Feishu CLI to review my work from yesterday and organize today’s to-dos.",
    },
  },
];
