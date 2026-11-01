
import finderIcon from "@/onboarding/assets/finder.png";
import terminalIcon from "@/onboarding/assets/terminal.png";
import feishuIcon from "@/onboarding/assets/feishu.png";
import documentsIcon from "@/assets/plugin-icons/documents.png";
import pdfIcon from "@/assets/plugin-icons/pdf.png";
import presentationsIcon from "@/assets/plugin-icons/presentations.png";
import spreadsheetsIcon from "@/assets/plugin-icons/spreadsheets.png";
import type { DraftSuggestedPromptItem } from "@/v4/draftSuggestedPromptItems.js";

const ASSETS = "https://cdn-cf.z.ai/cf/official-plugin/assets";

type FeatureRecommendedPrompt = DraftSuggestedPromptItem & {
  mode: "office" | "coding";
};

export const featureSuggestedPrompts: FeatureRecommendedPrompt[] = [
  {
    id: "feature-recvvsPdvcWQzF",
    mode: "office",
    iconUrl: terminalIcon,
    label: {
      cn: "Help me see what\'s taking up most of my computer\'s storage space",
      en: "Show what is using up space on my computer",
    },
    prompt: {
      cn: "Help me analyze disk usage on this computer, find the directories and large files taking up the most space, and distinguish between system files, application data, and personal files. Tell me what can be considered for cleanup and estimated space that can be freed; do not delete any files yet.",
      en: "Analyze disk usage on this computer. Identify the largest directories and files, distinguish system files, application data, and personal files, and estimate what I could safely clean up. Do not delete any files.",
    },
  },
  {
    id: "feature-recvvsQoVaqVGC",
    mode: "office",
    iconUrl: `${ASSETS}/browser-use/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Push the latest news on topics I follow daily and generate a briefing",
      en: "Send me a daily briefing on news I care about",
    },
    prompt: {
      cn: "Help me set up a scheduled task running daily at 9:00 AM: use [@Browser Use](plugin://browser-use@cf-plugins-official) to browse accessible public news sites, collect important news from the past 24 hours related to [Topic of Interest], deduplicate them, generate a brief summary, and push it to me. For each item, clearly specify the event time, publication time, source link, and why it is noteworthy; if there are no credible new updates, state so plainly, and do not repeat yesterday\'s content.",
      en: "Set up a scheduled task for 9 a.m. every day. Use [@Browser Use](plugin://browser-use@cf-plugins-official) to check accessible public news sites for important news about [topic of interest] from the past 24 hours, remove duplicates, and send me a brief digest. Include event and publication times, source links, and why each item matters. Say when there is no credible new item and do not repeat yesterday’s news.",
    },
    plugin: {
      stableId: "browser-use@cf-plugins-official",
      label: { cn: "浏览器操作", en: "Browser Use" },
    },
  },
  {
    id: "feature-office-browser-business-reading",
    mode: "office",
    iconUrl: `${ASSETS}/browser-use/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Help me pick three business articles worth reading today",
      en: "Find three business stories worth reading today",
    },
    prompt: {
      cn: "Please use [@Browser Use](plugin://browser-use@cf-plugins-official) to browse public domestic business news sites like Jiemian News, open the full articles, and select the three best business articles for working professionals today. For each, provide the core takeaways, reason for recommendation, publication time, and source link. Skip duplicate coverage, paywalled articles, and pages requiring login; if fewer than three suitable articles are found, recommend only the actual available count.",
      en: "Use [@Browser Use](plugin://browser-use@cf-plugins-official) to browse publicly accessible business coverage from The Guardian and other international news sites. Open the full articles and pick three worth reading today. For each, give me the key information, why it is worth my time, the publication time, and the original link. Skip duplicate coverage, paywalled articles, and pages requiring sign-in. Recommend fewer than three if necessary.",
    },
    plugin: {
      stableId: "browser-use@cf-plugins-official",
      label: { cn: "浏览器操作", en: "Browser Use" },
    },
  },
  {
    id: "feature-office-browser-work-reading",
    mode: "office",
    iconUrl: `${ASSETS}/browser-use/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Help me find a few great articles applicable to work",
      en: "Find practical articles I can use at work",
    },
    prompt: {
      cn: "Please use [@Browser Use](plugin://browser-use@cf-plugins-official) to view public articles on woshipm.com, and pick three recently published articles that offer practical help for daily office work, collaboration, or productivity. After opening the full text, explain who it is for, actionable takeaways, caveats when applying them, and include the original link. Do not recommend based solely on headlines, and avoid content requiring login or payment.",
      en: "Use [@Browser Use](plugin://browser-use@cf-plugins-official) to read recent, publicly accessible articles from Microsoft WorkLab and Atlassian Team Playbook. Pick three with concrete ideas for everyday work or collaboration. Read each page before explaining who it helps, what I could try, what to watch out for, and where to read the original. Do not recommend from titles alone or include pages that require sign-in or payment.",
    },
    plugin: {
      stableId: "browser-use@cf-plugins-official",
      label: { cn: "浏览器操作", en: "Browser Use" },
    },
  },
  {
    id: "feature-office-browser-economic-data",
    mode: "office",
    iconUrl: `${ASSETS}/browser-use/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Help me understand the recently released key economic data",
      en: "Explain the latest economic data in plain language",
    },
    prompt: {
      cn: "Please use [@Browser Use](plugin://browser-use@cf-plugins-official) to check the most recently released major economic data from the National Bureau of Statistics public website. Select three indicators related to consumption, employment, or business operations, explain the reporting period, metric changes, and why office workers might care, and attach official source links. Separate factual data from your interpretation; if there is no new data this week, clearly state the actual release date.",
      en: "Use [@Browser Use](plugin://browser-use@cf-plugins-official) to review the latest publicly released OECD economic data. Choose three indicators relevant to consumers, employment, or business activity. Explain the reporting period, what changed, and why someone working in an office might care, with links to the original OECD releases. Separate reported facts from your interpretation and state the actual release dates if there is nothing new this week.",
    },
    plugin: {
      stableId: "browser-use@cf-plugins-official",
      label: { cn: "浏览器操作", en: "Browser Use" },
    },
  },
  {
    id: "feature-recvvsPdvcUwzl",
    mode: "office",
    iconUrl: presentationsIcon,
    iconStyle: "plugin",
    label: {
      cn: "Generate a presentation that is ready to share",
      en: "Create a presentation I can share",
    },
    prompt: {
      cn: "Please use [@Presentations](plugin://presentations@cf-plugins-official) to create a ready-to-share presentation around [Topic]. First gather background context from public sources, form a clear core viewpoint and narrative structure, then generate slides complete with titles, key takeaways, and sources. Do not make up facts; mark any unconfirmed information.",
      en: "Use [@Presentations](plugin://presentations@cf-plugins-official) to create a shareable presentation about [topic]. Research public background, develop a clear argument and narrative, and produce slides with titles, conclusions, and sources. Label uncertain claims instead of inventing facts.",
    },
    plugin: {
      stableId: "presentations@cf-plugins-official",
      label: { cn: "演示文档", en: "Presentations" },
    },
  },
  {
    id: "feature-recvvsPdvcA0k8",
    mode: "office",
    iconUrl: feishuIcon,
    label: {
      cn: "Automatically review yesterday\'s work and organize today\'s to-do list daily",
      en: "Review yesterday’s work and plan today automatically",
    },
    prompt: {
      cn: "Help me set up a scheduled task running every workday at 9:00 AM: use [@Feishu CLI](plugin://lark-cli@cf-plugins-official) to read my Feishu calendar, tasks, and accessible work records from yesterday, generate a brief daily recap for yesterday, and compile the top three things to prioritize today. Include only documented facts; if the plugin is not enabled or lacks access permissions, inform me first of what configuration is required.",
      en: "Set up a scheduled task for 9 a.m. every workday. Use [@Lark CLI](plugin://lark-cli@cf-plugins-official) to read my accessible calendar events, tasks, and work records from yesterday. Give me a brief daily report and the three most important things to do today. Only include claims supported by those records; tell me what to connect if access is missing.",
    },
    plugin: {
      stableId: "lark-cli@cf-plugins-official",
      label: { cn: "Feishu CLI", en: "飞书 CLI" },
    },
  },
  {
    id: "feature-recvvsS2usyGu7",
    mode: "office",
    iconUrl: `${ASSETS}/cf-cua/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Help me set up an idle task to experience a website\'s end-to-end user journey",
      en: "Review a website’s complete first-time user journey",
    },
    prompt: {
      cn: "Help me set up an idle task using [@Computer Use](plugin://computer-use@cf-plugins-official) to open [Target Website] and interact with it like a first-time visitor. Choose the website\'s most core public user journey, navigate from the homepage to the final step before task completion, and record each step\'s page, friction points, and blockers, accompanied by key screenshots. Finally, provide a detailed user experience report listing issues ranked by impact, rationale, and specific recommendations for improvement. Do not register, pay, or submit real information; explain any uncovered steps if hitting a login barrier. If a local project has not been selected yet, prompt me to choose one to save the report.",
      en: "Set up an idle-time task using [@Computer Use](plugin://computer-use@cf-plugins-official) to open [target website] and act like a first-time user. Follow its main public journey from the home page to the step before final submission, documenting each step, confusion, blockers, and key screenshots. Produce a detailed UX report with evidence and prioritized improvements. Do not register, pay, or submit real information. If no local project is selected, ask me to choose one for the report.",
    },
    plugin: {
      stableId: "computer-use@cf-plugins-official",
      label: { cn: "电脑控制", en: "Computer Use" },
    },
  },
  {
    id: "feature-recvvsPdvcPqQQ",
    mode: "office",
    iconUrl: finderIcon,
    label: {
      cn: "Help me see how to organize this computer\'s Downloads folder",
      en: "Find what I should clean up in Downloads",
    },
    prompt: {
      cn: "Help me check the Downloads folder on this computer for duplicate files, old installers, and obvious temporary files, sort them by estimated reclaimable space, and provide cleanup recommendations. Do not move or delete any files yet.",
      en: "Inspect this computer’s Downloads folder for duplicates, old installers, and obvious temporary files. Rank the opportunities by space they could free and suggest an organization plan. Do not move or delete anything yet.",
    },
  },
  {
    id: "feature-recvvsPdvcgq6k",
    mode: "office",
    iconUrl: pdfIcon,
    iconStyle: "plugin",
    label: {
      cn: "Generate a sourced PDF research report on a topic",
      en: "Create a sourced PDF research report on a topic",
    },
    prompt: {
      cn: "Please use [@PDF](plugin://pdf@cf-plugins-official) to generate a shareable PDF research report around [Research Topic]. First look up recent credible public sources, then organize the background, key facts, differing perspectives, and open questions; cite dates and sources for key figures, and attach reference links at the end. Clearly flag anything lacking reliable evidence, and do not make up facts.",
      en: "Use [@PDF](plugin://pdf@cf-plugins-official) to create a shareable PDF research report on [research topic]. Find recent credible public sources, then cover the background, key facts, differing views, and open questions. Date and source important figures and include references. Mark claims without reliable evidence instead of inventing them.",
    },
    plugin: {
      stableId: "pdf@cf-plugins-official",
      label: { cn: "PDF", en: "PDF" },
    },
  },
  {
    id: "feature-recvvsPdvciNsr",
    mode: "office",
    iconUrl: feishuIcon,
    label: {
      cn: "Automatically summarize weekly progress and prepare next week\'s priorities",
      en: "Summarize this week and prepare next week’s priorities",
    },
    prompt: {
      cn: "Help me set up a scheduled task running every Friday at 5:00 PM: use [@Feishu CLI](plugin://lark-cli@cf-plugins-official) to read my accessible Feishu calendar, tasks, and work logs for the week, summarize completed items, ongoing work, and decisions required from me, then list three recommended priorities for next week. Do not extrapolate progress without documented records; if the plugin or permissions are not ready, prompt me to configure them first.",
      en: "Set up a scheduled task for 5 p.m. every Friday. Use [@Lark CLI](plugin://lark-cli@cf-plugins-official) to review my accessible calendar, tasks, and work records for the week. Summarize what was completed, what is ongoing, and what needs my decision, then suggest three priorities for next week. Do not invent progress that the records do not support.",
    },
    plugin: {
      stableId: "lark-cli@cf-plugins-official",
      label: { cn: "Feishu CLI", en: "飞书 CLI" },
    },
  },
  {
    id: "feature-recvvsPdvcsDgI",
    mode: "office",
    iconUrl: documentsIcon,
    iconStyle: "plugin",
    label: {
      cn: "Generate an editable project proposal document",
      en: "Create an editable project proposal",
    },
    prompt: {
      cn: "Please use [@Word Documents](plugin://documents@cf-plugins-official) to generate an editable Word project proposal around [Project Topic]. Detail target users and problem statement, solution options, main tasks, milestones, risks, and open items. Where business context is missing, use reasonable assumptions clearly marked as such, and list the top three pieces of information I need to provide at the end; do not invent internal data.",
      en: "Use [@Documents](plugin://documents@cf-plugins-official) to create an editable Word proposal for [project topic]. Cover users and their problem, options, work plan, milestones, risks, and open decisions. When business context is missing, label reasonable assumptions and list the three most useful details for me to add. Do not invent internal data.",
    },
    plugin: {
      stableId: "documents@cf-plugins-official",
      label: { cn: "Word文档", en: "Documents" },
    },
  },
  {
    id: "feature-recvvsPdvcSvEZ",
    mode: "office",
    iconUrl: spreadsheetsIcon,
    iconStyle: "plugin",
    label: {
      cn: "Generate a ready-to-use monthly budget spreadsheet",
      en: "Create a ready-to-use monthly income and expense tracker",
    },
    prompt: {
      cn: "Please use [@Spreadsheets](plugin://spreadsheets@cf-plugins-official) to generate an Excel monthly budget spreadsheet that is ready for immediate bookkeeping. Each entry should allow date, transaction type, category, amount, and notes; provide common categories, automated summaries by month and category, along with income, expenses, and balance. Include a few records clearly marked as examples to show how to fill it out, ensuring the final summary excludes examples from actual balances. No need to ask me for income or expense details first.",
      en: "Use [@Spreadsheets](plugin://spreadsheets@cf-plugins-official) to create an editable Excel monthly income and expense tracker I can start using right away. Let each entry capture its date, income or expense type, category, amount, and note. Include common categories and automatic monthly and category totals, including income, expenses, and balance. Add a few clearly marked example entries to show how it works, but exclude them from real totals. Do not ask for my financial details before creating the template.",
    },
    plugin: {
      stableId: "spreadsheets@cf-plugins-official",
      label: { cn: "电子表格", en: "Spreadsheets" },
    },
  },
  {
    id: "feature-recvvsPdvcK0EZ",
    mode: "office",
    iconUrl: terminalIcon,
    label: {
      cn: "Check why my computer has been running slow recently",
      en: "Find out why my computer feels slow",
    },
    prompt: {
      cn: "Help me check this computer\'s current resource usage to identify processes, disk pressure, and memory pressure that might be slowing it down. Distinguish observable facts from potential causes, and tell me a few safe initial actions I can take. Do not terminate processes or modify system settings.",
      en: "Check current resource use on this computer and identify processes, disk pressure, or memory pressure that may explain why it feels slow. Separate what you can observe from possible causes, and suggest safe first steps. Do not terminate processes or change system settings.",
    },
  },
  {
    id: "feature-recvvsPdvclWR1",
    mode: "office",
    iconUrl: `${ASSETS}/cf-cua/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Help me batch archive screenshots in Downloads by month",
      en: "File my downloaded screenshots by month",
    },
    prompt: {
      cn: "Please use [@Computer Use](plugin://computer-use@cf-plugins-official) to open this computer\'s file manager, categorize screenshots in the Downloads folder by month, and show me first which files will be moved and where they will go; proceed with batch archiving only after my confirmation. Do not touch other images or delete any files.",
      en: "Use [@Computer Use](plugin://computer-use@cf-plugins-official) to open this computer’s file manager and sort screenshots in Downloads by month. Show me which files would move and where; after I approve, file them in batches. Leave other images alone and do not delete files.",
    },
    plugin: {
      stableId: "computer-use@cf-plugins-official",
      label: { cn: "电脑控制", en: "Computer Use" },
    },
  },
  {
    id: "feature-recvvsV4e4aOFp",
    mode: "office",
    iconUrl: `${ASSETS}/wind/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Use Wind to see recent industry changes",
      en: "See what has changed in an industry with Wind",
    },
    prompt: {
      cn: "I want to understand what has changed in [Target Industry] over the past three months. Please use connected [@Wind](plugin://wind@cf-plugins-official) data to summarize key industry indicators, major events, and research opinions, specifying the direction of change, data as-of dates, and sources, and provide an actionable industry brief for follow-up. If Wind is not connected or lacks data, explain the gap first rather than spoofing Wind with other sources.",
      en: "I want to understand changes in [target industry] over the past three months. Use connected [@Wind](plugin://wind@cf-plugins-official) data to review key indicators, major events, and research views. Explain the direction of change, data dates, and sources in a concise industry brief. If Wind is unavailable, describe the gap rather than substituting another source without saying so.",
    },
    plugin: {
      stableId: "wind@cf-plugins-official",
      label: { cn: "Wind 万得", en: "Wind" },
    },
  },
  {
    id: "feature-recvvsV4e4bCq1",
    mode: "office",
    iconUrl: `${ASSETS}/wind/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Analyze a company\'s operational and market performance with Wind",
      en: "Review a company’s operating and market performance",
    },
    prompt: {
      cn: "Help me research the operational changes of [Target Company] over the past four quarters. Please use connected [@Wind](plugin://wind@cf-plugins-official) data to compile available key indicators such as revenue, profit, and cash flow; if it is a public company, supplement with its past-year market performance and peers. Clearly label data periods, accounting standards, and sources, keeping facts, analysis, and unconfirmed questions distinct.",
      en: "Research [target company] over the past four quarters using connected [@Wind](plugin://wind@cf-plugins-official) data. Summarize available revenue, profit, and cash-flow metrics. If it is listed, add one year of market performance and relevant peers. State periods, definitions, and sources; separate facts, analysis, and open questions.",
    },
    plugin: {
      stableId: "wind@cf-plugins-official",
      label: { cn: "Wind 万得", en: "Wind" },
    },
  },
  {
    id: "feature-recvvsV4e4ivrd",
    mode: "office",
    iconUrl: `${ASSETS}/hexin/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Compare industry leaders using Hithink RoyalFlush iFinD",
      en: "Compare leading companies in an industry",
    },
    prompt: {
      cn: "I want to quickly understand the major players in [Target Industry]. Please use connected [@RoyalFlush](plugin://hexin@cf-plugins-official) data to select three to five representative companies and compare their growth, profitability, cash flow, and available valuation metrics over the past four quarters, explaining differences and anomalies. Label the period, accounting standard, and source for each data point; leave missing metrics blank, and do not provide buy/sell advice.",
      en: "Help me understand the main companies in [target industry]. Use connected [@RoyalFlush iFinD](plugin://hexin@cf-plugins-official) data to compare three to five representative companies on recent growth, profitability, cash flow, and available valuation metrics. Explain differences and anomalies, show dates and sources, leave missing values blank, and avoid buy or sell advice.",
    },
    plugin: {
      stableId: "hexin@cf-plugins-official",
      label: { cn: "RoyalFlush", en: "RoyalFlush iFinD" },
    },
  },
  {
    id: "feature-recvvsV4e4g9yq",
    mode: "office",
    iconUrl: `${ASSETS}/hexin/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Summarize a company\'s key announcements using Hithink RoyalFlush iFinD",
      en: "Summarize a company’s important recent filings",
    },
    prompt: {
      cn: "Help me review noteworthy announcements for [Target Company] over the past 90 days. Please use connected [@RoyalFlush](plugin://hexin@cf-plugins-official) to chronologically organize key facts, related figures or metrics, and open questions that could affect future assessments. Include announcement dates and links to original sources; do not portray speculation as company-confirmed plans.",
      en: "Use connected [@RoyalFlush iFinD](plugin://hexin@cf-plugins-official) to review [target company] announcements from the past 90 days. Build a timeline of important facts, figures, and questions to verify, with filing dates and original links. Do not present speculation as confirmed company plans.",
    },
    plugin: {
      stableId: "hexin@cf-plugins-official",
      label: { cn: "RoyalFlush", en: "RoyalFlush iFinD" },
    },
  },
  {
    id: "feature-recvvsV4e4AtLY",
    mode: "office",
    iconUrl: `${ASSETS}/tianyancha/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Examine an enterprise\'s shareholding structure and operating risks with TianYanCha",
      en: "Check a company’s ownership and business risks",
    },
    prompt: {
      cn: "I want to evaluate whether [Target Enterprise] is worth engaging further. Please use connected [@TianYanCha](plugin://tianyancha@cf-plugins-official) to verify its registration status, major shareholders, beneficial owner, external investments, and available operational and legal risks. Compile this into a concise due diligence checklist, noting update dates and sources; verify corporate identity for homonymous entities, and do not equate risk records directly with legal violations.",
      en: "Use connected [@Tianyancha](plugin://tianyancha@cf-plugins-official) to review [target company] before I contact it. Verify the legal entity, registration status, key shareholders, controlling parties, investments, and available business or legal risk records. Provide a concise due-diligence checklist with source dates. Do not treat a risk record alone as proof of wrongdoing.",
    },
    plugin: {
      stableId: "tianyancha@cf-plugins-official",
      label: { cn: "TianYanCha", en: "天眼查" },
    },
  },
  {
    id: "feature-recvvsV4e4Hsa3",
    mode: "office",
    iconUrl: `${ASSETS}/tianyancha/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Verify an enterprise\'s affiliates and key personnel using TianYanCha",
      en: "Map a company’s related entities and key people",
    },
    prompt: {
      cn: "Help me map out the relationships among shareholders, external investments, branches, and key personnel of [Target Enterprise]. Please use connected [@TianYanCha](plugin://tianyancha@cf-plugins-official) to first verify the corporate entity, distinguish direct relationships from indirect ones, and provide a relationship list explaining the basis, update time, and aspects requiring manual verification for each link.",
      en: "Use connected [@Tianyancha](plugin://tianyancha@cf-plugins-official) to map shareholders, investments, branches, and key people for [target company]. Verify the legal entity first, distinguish direct from indirect links, and provide a relationship list with evidence, update dates, and points requiring manual confirmation.",
    },
    plugin: {
      stableId: "tianyancha@cf-plugins-official",
      label: { cn: "TianYanCha", en: "天眼查" },
    },
  },
  {
    id: "feature-recvvsV4e4FqWU",
    mode: "office",
    iconUrl: `${ASSETS}/wind/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Research an enterprise using Wind, RoyalFlush, and TianYanCha combined",
      en: "Research a company across three data sources",
    },
    prompt: {
      cn: "I want a comprehensive understanding of [Target Enterprise]. Please combine my connected [@Wind](plugin://wind@cf-plugins-official), [@RoyalFlush](plugin://hexin@cf-plugins-official), and [@TianYanCha](plugin://tianyancha@cf-plugins-official) to verify operational and market data, recent announcements, corporate relationships, and risks respectively, then organize them into a brief research report. For conflicting figures, detail differences in accounting standards and time frames rather than forcing reconciliation; if a data source is missing, clarify the uncovered areas.",
      en: "Help me understand [target company]. Cross-check connected [@Wind](plugin://wind@cf-plugins-official), [@RoyalFlush iFinD](plugin://hexin@cf-plugins-official), and [@Tianyancha](plugin://tianyancha@cf-plugins-official) for operating and market data, recent filings, company relationships, and risks. Write a concise report, preserve conflicting figures with their dates and definitions, and say which sources were unavailable.",
    },
  },
  {
    id: "feature-coding-repo-start",
    mode: "coding",
    iconUrl: terminalIcon,
    label: {
      cn: "Help me understand and run the current repository",
      en: "Help me understand and run this repository",
    },
    prompt: {
      cn: "Help me quickly understand what the currently open repository does, where its main features reside, and how to start it on this computer. Please attempt to run a core flow in practice, and conclude with a concise onboarding guide highlighting key files, run outcomes, and encountered obstacles; if no repository is currently open, prompt me to select one first.",
      en: "Help me understand what the open repository does, where its main features live, and how to run it on this computer. Try one core workflow, then give me a concise guide with key files, what ran successfully, and any blockers. If no repository is open, ask me to select one.",
    },
  },
  {
    id: "feature-coding-branch-review",
    mode: "coding",
    iconUrl: `${ASSETS}/gitlab/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Help me check for issues on the current branch before committing",
      en: "Check this branch before I submit it",
    },
    prompt: {
      cn: "Please inspect the uncommitted or pending changes on this branch in the currently open repository. First confirm the target branch it is compared against, then identify distinct bugs, compatibility risks, and missed edge cases based on affected features; organize findings by severity with code locations, trigger conditions, and recommendations. If no issues are confirmed, state what was checked and what still needs verification.",
      en: "Review the changes on the current branch of the open repository before I submit them. Identify the target branch, then look for concrete bugs, compatibility risks, and missed edge cases in the affected features. Rank findings by severity with code locations, triggers, and suggestions. If nothing is confirmed, tell me what was checked and what still needs verification.",
    },
  },
  {
    id: "feature-coding-check-failures",
    mode: "coding",
    iconUrl: terminalIcon,
    label: {
      cn: "Help me run the project\'s existing checks and locate failures",
      en: "Run the existing checks and diagnose failures",
    },
    prompt: {
      cn: "Help me check whether the existing linters and tests pass in the current repository. Prioritize configured checks that can execute in the current environment; if any fail, locate the most likely root causes, differentiate between issues introduced in this branch and pre-existing ones, and provide actionable fix recommendations. Do not report unrun checks as passing, and do not make sweeping code changes yet.",
      en: "Check whether the open repository’s existing code checks and tests pass. Run the checks already configured and feasible in this environment. For failures, identify likely causes, separate issues introduced by this branch from existing ones, and suggest actionable fixes. Do not call unrun checks passes or make broad code changes yet.",
    },
  },
  {
    id: "feature-coding-mr-summary",
    mode: "coding",
    iconUrl: `${ASSETS}/gitlab/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Help me write the MR description for the current branch",
      en: "Draft a merge request description for this branch",
    },
    prompt: {
      cn: "Based on the actual changes of this branch relative to the target branch in the current repository, help me draft an MR description ready for review: explain the purpose, user-facing changes, implementation details, verification results, and known risks. Mark unexecuted validations as unverified; if the target branch is ambiguous, confirm with me first. Give me a draft first and do not publish the MR directly.",
      en: "Draft a merge request description from this branch’s actual changes against its target branch. Cover the purpose, user-visible behavior, main implementation, verification results, and known risks. Mark checks that were not run as unverified. Ask me if the target branch is unclear. Show me the draft without publishing the MR.",
    },
  },
  {
    id: "feature-coding-dependencies",
    mode: "coding",
    iconUrl: terminalIcon,
    label: {
      cn: "Help me inspect repository dependencies and upgrade risks",
      en: "Review this repository’s dependencies and upgrade risks",
    },
    prompt: {
      cn: "Help me inspect the main dependencies of the current repository to identify those that are outdated, carry known security risks, or block future upgrades. Based on actual usage, provide a prioritized list detailing impacts, evidence, and suggested upgrade order; do not deem something problematic solely due to age, and do not batch upgrade yet.",
      en: "Review the open repository’s main dependencies for outdated packages, confirmed security risks, and likely upgrade blockers. Consider how this project actually uses them, then give me a prioritized list with impact, evidence, and a suggested upgrade order. Do not treat age alone as a defect or upgrade everything yet.",
    },
  },
  {
    id: "feature-recvvsWf8gXmsB",
    mode: "coding",
    iconUrl: `${ASSETS}/github/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Help me set up an idle task to comprehensively verify the repo\'s test coverage",
      en: "Run a thorough test coverage review of a repository",
    },
    prompt: {
      cn: "Help me set up an idle task using the local repository [Target Repository] to comprehensively evaluate test coverage across critical features. Run environment-supported unit, integration, and E2E tests, fill major gaps, and re-run. Finally, provide a thorough report detailing coverage scope, passes, failures, unrunnable items, evidence, and residual risks. Do not mark unexecuted tests as passing; if the repository is not opened as a local project, prompt me to select it first.",
      en: "Set up an idle-time task for the local [target repository]. Review coverage of important features, run unit, integration, and end-to-end tests that the environment supports, add tests for important gaps, and rerun them. Deliver a detailed report of coverage, passes, failures, tests that could not run, evidence, and remaining risks. Never call an unrun test a pass. Ask me to select the repository if it is not open.",
    },
  },
  {
    id: "feature-recvvsWf8g0Cg0",
    mode: "coding",
    iconUrl: `${ASSETS}/github/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Help me set up an idle task to analyze the repo thoroughly and map its architecture",
      en: "Read a repository deeply and map its features",
    },
    prompt: {
      cn: "Help me set up an idle task using the local repository [Target Repository] to systematically review core features, module responsibilities, key data flows, and call chains from entry points to outputs. Read relevant code and documentation, identify key dependencies, easily misunderstood boundaries, and current documentation gaps, and finally deliver a repository walkthrough and feature map with file locations. Mark deductions lacking code evidence as speculation; if the repository is not opened as a local project, prompt me to select it first.",
      en: "Set up an idle-time task for the local [target repository]. Map the main features, module responsibilities, data flows, and paths from entry point to result. Read the relevant code and docs, identify dependencies and confusing boundaries, and deliver a repository guide with file references. Label claims without code evidence as inference. Ask me to select the repository if it is not open.",
    },
  },
  {
    id: "feature-recvvsWf8grDkJ",
    mode: "coding",
    iconUrl: `${ASSETS}/github/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Help me set up an idle task to deeply inspect potential repository issues",
      en: "Find significant issues across a repository",
    },
    prompt: {
      cn: "Help me set up an idle task using the local repository [Target Repository] to thoroughly examine critical user flows and cross-module interactions for bugs that could cause functional errors, compatibility issues, or data loss. Attempt reproduction for high-risk issues, cross-check against relevant tests, and provide a detailed report ordered by severity containing trigger conditions, code locations, evidence, remediation advice, and unverified assumptions. Do not make broad code changes yet; if the repository is not opened as a local project, prompt me to select it first.",
      en: "Set up an idle-time task for the local [target repository]. Review important user journeys and cross-module calls for functional, compatibility, or data-loss issues. Reproduce high-risk findings where possible, check relevant tests, and deliver a detailed severity-ranked report with triggers, code locations, evidence, suggested fixes, and unverified hypotheses. Avoid broad code changes. Ask me to select the repository if it is not open.",
    },
  },
  {
    id: "feature-coding-browser-deployed",
    mode: "coding",
    iconUrl: `${ASSETS}/browser-use/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Help me check the newly deployed website for obvious errors",
      en: "Check a deployed website for obvious problems",
    },
    prompt: {
      cn: "Please use [@Browser Use](plugin://browser-use@cf-plugins-official) to open [Test URL] and check the homepage navigation, primary entry points, and an unauthenticated user flow like a first-time visitor. Identify broken pages, failed interactions, or obvious content and layout bugs, accompanied by reproduction steps, page URLs, and screenshots. Do not register, pay, or submit real information; mark post-login sections as uncovered.",
      en: "Use [@Browser Use](plugin://browser-use@cf-plugins-official) to open [test URL] and check its navigation, main entry points, and one flow available without signing in. Report broken pages, controls, content, or layout with reproduction steps, URLs, and screenshots. Do not register, pay, or submit real information; mark signed-in areas as not covered.",
    },
    plugin: {
      stableId: "browser-use@cf-plugins-official",
      label: { cn: "浏览器操作", en: "Browser Use" },
    },
  },
  {
    id: "feature-coding-scheduled-ci",
    mode: "coding",
    iconUrl: `${ASSETS}/gitlab/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Check daily for new CI failures in the current repository",
      en: "Check this repository for new CI failures daily",
    },
    prompt: {
      cn: "Help me set up a scheduled task for the currently open repository running every workday at 9:00 AM to check for new remote CI failures in the past 24 hours. Report only unresolved failures, listing failed pipelines or jobs, corresponding branches and commits, failure evidence, and recommended next steps; state briefly if there are no new failures. If the repository lacks remote CI or the runtime environment lacks access permissions, inform me before creating the task.",
      en: "Set up a scheduled task for 9 a.m. every workday for the open repository. Check its remote CI for failures newly seen in the past 24 hours. Report only failures that still need attention, with the pipeline or job, branch and commit, error evidence, and a next step. Give a brief all-clear if there are none. Tell me before creating the task if the repository has no remote CI or the scheduled environment cannot access it.",
    },
  },
  {
    id: "feature-coding-scheduled-weekly-changes",
    mode: "coding",
    iconUrl: `${ASSETS}/gitlab/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Summarize weekly repository changes and pending risks",
      en: "Summarize this repository’s changes and risks weekly",
    },
    prompt: {
      cn: "Help me set up a scheduled task for the currently open repository running every Friday at 5:00 PM to review changes merged this week and unresolved failures or blockers. Give me a brief weekly report categorized by feature changes, validation status, and risks to watch next week, with links to relevant commits, MRs, or CI runs. Do not describe unmerged changes as completed; if the task environment cannot access the repository or remote, clarify before creation.",
      en: "Set up a scheduled task for 5 p.m. every Friday for the open repository. Review changes merged this week and failures or blockers still open. Send me a short update grouped by feature changes, verification, and risks to watch next week, with commit, merge request, or CI links. Do not call unmerged work complete. Tell me before creating the task if its environment cannot access the repository or remote.",
    },
  },
  {
    id: "feature-coding-idle-external-failures",
    mode: "coding",
    iconUrl: `${ASSETS}/github/icon.png`,
    iconStyle: "plugin",
    label: {
      cn: "Help me set up an idle task to deeply inspect external service failure paths",
      en: "Deeply review external-service failure paths in idle time",
    },
    prompt: {
      cn: "Help me set up an idle task using the currently open local repository to systematically evaluate how timeouts, disconnections, rate limits, and error responses from external APIs, databases, and third-party services impact key user flows. Trace impacts through callers to user-facing outcomes, attempt to reproduce high-risk gaps, and conclude with a report ranked by severity containing code locations, execution evidence, and remediation advice. Do not report unverified risks as existing outages, and do not make sweeping code changes yet; if no local repository is open, prompt me to select one first.",
      en: "Set up an idle-time task for the open local repository. Trace how timeouts, disconnections, rate limits, and errors from external APIs, databases, and third-party services affect important user flows. Follow each path to the caller and user-visible result, reproduce high-risk gaps where feasible, and deliver a severity-ranked report with code locations, runtime evidence, and fixes. Do not present unverified risks as incidents or make broad code changes. Ask me to select a local repository if none is open.",
    },
  },
];

export function getRecommendedPromptPool(isOfficeMode: boolean): DraftSuggestedPromptItem[] {
  const mode = isOfficeMode ? "office" : "coding";
  return featureSuggestedPrompts.filter((item) => item.mode === mode);
}
