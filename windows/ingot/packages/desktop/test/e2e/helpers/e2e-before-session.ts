export interface E2EBeforeSessionSetupOptions {
  cid: string;
  specs: string[];
  configureAgentServerEnv: () => void;
  configureCodingPlanTeamMockForSpecs: (specs: string[]) => Promise<void>;
  recordBeforeSession: (cid: string, specs: string[]) => void;
  resetHome: (specs: string[]) => Promise<void>;
  startCodingPlanTeamMockIfNeeded: (specs: string[]) => Promise<void>;
  startCodingPlanDataPlaneProxyIfNeeded: (specs: string[]) => Promise<void>;
  startCodingPlanUpgradeMockIfNeeded: (specs: string[]) => Promise<void>;
  startUpstreamHttpIfNeeded: (specs: string[]) => Promise<void>;
  startPluginCdnZipFixtureIfNeeded: (specs: string[]) => Promise<void>;
  startOffPeakMockIfNeeded: (specs: string[]) => Promise<void>;
}

export async function runE2EBeforeSessionSetup(options: E2EBeforeSessionSetupOptions) {
  options.recordBeforeSession(options.cid, options.specs);
  options.configureAgentServerEnv();
  await options.startCodingPlanTeamMockIfNeeded(options.specs);
  await options.configureCodingPlanTeamMockForSpecs(options.specs);
  await options.startUpstreamHttpIfNeeded(options.specs);
  await options.startCodingPlanDataPlaneProxyIfNeeded(options.specs);
  await options.startCodingPlanUpgradeMockIfNeeded(options.specs);
  await options.startPluginCdnZipFixtureIfNeeded(options.specs);
  await options.startOffPeakMockIfNeeded(options.specs);
  await options.resetHome(options.specs);
}
