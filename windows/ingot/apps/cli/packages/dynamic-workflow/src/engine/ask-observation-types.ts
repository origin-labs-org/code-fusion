

export interface AskStats {
  tokens: number;
  toolCalls: number;
  turns: number;
  
  worldToolCalls?: number;
}

export const INSTRUCTIONS_HEAD_MAX_CHARS = 240;

export const LAST_TOOL_NAME_MAX_CHARS = 64;

export const LAST_TOOL_TARGET_MAX_CHARS = 120;

export interface AskLastTool {
  
  name: string;
  
  target?: string;
}

export interface AskProgress {
  
  turn: number;
  
  toolCalls: number;
  lastTool?: AskLastTool;
}
