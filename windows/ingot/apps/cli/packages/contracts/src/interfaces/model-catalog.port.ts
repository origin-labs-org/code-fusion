// ============================================================
// ============================================================
//

export interface ModelCatalogEntry {
  providerId: string;
  modelId: string;
  
  providerLabel?: string;
  
  reasoningLevels: string[];
  
  defaultReasoningLevel?: string;
  contextWindow?: number;
  
  current: boolean;
  
  disabledReason?: string;
}

export interface ModelCatalogPort {
  
  listModels(): ModelCatalogEntry[];
}
