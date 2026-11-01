

export interface UsageQuotaSnapshot {
  level: string | null;
  limits: UsageQuotaLimit[];
}

export interface UsageQuotaLimit {
  type: string;
  
  bucketId?: string;
  userPlanId?: string;
  periodStart?: number;
  periodEnd?: number;
  
  period?: string;
  meter?: string;
  unitType?: string;
  
  planId?: string;
  unit?: number;
  number?: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  percentage?: number;
  nextResetTime?: number;
  usageDetails: UsageQuotaUsageDetail[];
}

export interface UsageQuotaUsageDetail {
  modelCode: string;
  displayName?: string;
  usage: number;
}

export const MCP_USAGE_QUOTA_LIMIT_TYPE = "MCP_USAGE_LIMIT" as const;

export type UsageMcpQuotaScope =
  | {
      providerFamily: "zai" | "bigmodel";
      targetType: "PERSONAL";
    }
  | {
      providerFamily: "zai" | "bigmodel";
      targetType: "TEAM";
      organizationId: string;
      projectId: string;
    };

export interface UsageMcpQuotaSnapshot {
  
  serverTime: number;
  level: string | null;
  scope: UsageMcpQuotaScope;
  
  aggregate: UsageQuotaLimit;
}
