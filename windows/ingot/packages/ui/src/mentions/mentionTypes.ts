export type MentionCategory =
  | "files"
  | "skills"
  | "commands"
  | "subagents"
  | "whiteboards"
  | "sessions"
  | "plugins";

export interface MentionItemData {
  kind?: "file" | "directory" | "whiteboard";
  path?: string;
  relativePath?: string;
  
  rootName?: string;
  boardId?: string;
  scope?: "built-in" | "workspace" | "user" | "plugin";
  source?: "built-in" | "user" | "plugin";
  model?: string;
  
  pluginId?: string;
  
  icon?: string;
}

export interface MentionItem {
  id: string;
  category: MentionCategory;
  label: string;
  description: string;
  value: string;
  markdown: string;
  keywords?: string[];
  data?: MentionItemData;
  
  displayLabel?: string;
  
  disabled?: boolean;
  
  disabledReason?: string;
}

export interface MentionCategoryResult {
  items: MentionItem[];
  groups?: Array<{ id: string; title: string; items: MentionItem[] }>;
  loading: boolean;
  error: Error | null;
  emptyText: string;
  title: string;
  refresh?: () => Promise<void>;
}
