import { posix } from "node:path";

export const REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME = "packages";

export const REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES = [
  "android-emulator-plugin",
  "browser-use-plugin",
  "cf-cua-plugin",
  "documents-plugin",
  "pdf-plugin",
  "presentations-plugin",
  "spreadsheets-plugin",
  "image-search-plugin",
  "ios-simulator-plugin",
  "restore-legacy-sessions-plugin",
  "skill-creator-plugin",
  "plugin-creator-plugin",
  "cf-guide-plugin",
  "visualize-plugin",
] as const;

export const REMOTE_AGENT_OFFICIAL_PLUGIN_INCLUDED_TOP_LEVEL_PATHS = [
  ".mcp.json",
  ".cf-plugin",
  "README.md",
  "agents",
  "commands",
  "dist",
  "docs",
  "hooks",
  "output-styles",
  "package.json",
  "scripts",
  "skills",
  "templates",
] as const;

export const REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS = [
  "bundled-skills/skills/dynamic-workflows/SKILL.md",
  "bundled-skills/skills/dynamic-workflows/patterns.md",
  "bundled-skills/skills/dynamic-workflows/examples.md",
  ...REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES.map(
    (packageName) => `${packageName}/.cf-plugin/plugin.json`,
  ),
  //
  "visualize-plugin/skills/visualize/SKILL.md",
  "visualize-plugin/skills/visualize/references/api.md",
  "visualize-plugin/skills/visualize/references/styles.md",
  "visualize-plugin/skills/visualize/tweak.md",
  "visualize-plugin/skills/visualize/LICENSE.md",
  "visualize-plugin/skills/visualize/scripts/render.py",
  "visualize-plugin/skills/visualize/assets/visualize.css",
  "visualize-plugin/skills/visualize/assets/visualize.html",
  "visualize-plugin/skills/visualize/assets/calendar.js",
  "visualize-plugin/skills/visualize/assets/runtime-manifest.json",
  "visualize-plugin/skills/visualize/scripts/vendor.py",
  "visualize-plugin/skills/visualize/assets/vendor/manifest.json",
  "visualize-plugin/skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js",
  "visualize-plugin/skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js",
  "visualize-plugin/skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/vendor/lucide-1.17.0.js",
  "visualize-plugin/skills/visualize/assets/vendor/lucide-1.17.0.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/vendor/d3-7.9.0.min.js",
  "visualize-plugin/skills/visualize/assets/vendor/d3-7.9.0.min.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/standalone-host-bridge.js",
  "visualize-plugin/skills/visualize/assets/standalone-shell.js",
  "visualize-plugin/skills/visualize/widgets/calendar.md",
  "visualize-plugin/skills/visualize/examples/calendar.html",
  "browser-use-plugin/docs/api.json",
  "browser-use-plugin/docs/documents.json",
  "browser-use-plugin/docs/overview.md",
  "browser-use-plugin/docs/recording.md",
  "browser-use-plugin/docs/workflow.md",
  "browser-use-plugin/scripts/browser-client.mjs",
  "browser-use-plugin/skills/control-browser/SKILL.md",
  "browser-use-plugin/skills/web-gui-tester/SKILL.md",
  "image-search-plugin/.mcp.json",
  "documents-plugin/agents/visual-judge.md",
  "documents-plugin/skills/docx/SKILL.md",
  "documents-plugin/skills/docx-viewer/SKILL.md",
  "documents-plugin/dist/server.mjs",
  "documents-plugin/dist/ui/assets.json",
  "documents-plugin/dist/ui/panel.html",
  "pdf-plugin/agents/visual-judge.md",
  "pdf-plugin/skills/pdf/SKILL.md",
  "pdf-plugin/skills/pdf-viewer/SKILL.md",
  "pdf-plugin/dist/server.mjs",
  "pdf-plugin/dist/ui/assets.json",
  "pdf-plugin/dist/ui/panel.html",
  "presentations-plugin/agents/visual-judge.md",
  "presentations-plugin/skills/pptx/SKILL.md",
  "presentations-plugin/skills/pptx-viewer/SKILL.md",
  "presentations-plugin/dist/server.mjs",
  "presentations-plugin/dist/ui/assets.json",
  "presentations-plugin/dist/ui/panel.html",
  "spreadsheets-plugin/agents/visual-judge.md",
  "spreadsheets-plugin/skills/xlsx/SKILL.md",
  "spreadsheets-plugin/skills/xlsx-viewer/SKILL.md",
  "spreadsheets-plugin/dist/server.mjs",
  "spreadsheets-plugin/dist/ui/assets.json",
  "spreadsheets-plugin/dist/ui/panel.html",
  "cf-cua-plugin/docs/computer-use.md",
  "cf-cua-plugin/scripts/computer-use-client.mjs",
  "cf-cua-plugin/skills/computer-use/SKILL.md",
] as const;

export function buildRemoteAgentOfficialPluginDir(remoteProviderDir: string): string {
  return posix.join(remoteProviderDir, REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME);
}

export function buildRemoteAgentOfficialPluginSourceRelativePath(params: {
  runtimeResourceDir: string;
  platformArch: string;
}): string {
  return posix.join(
    params.runtimeResourceDir,
    params.platformArch,
    REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME,
  );
}

export function buildRemoteAgentOfficialPluginRequiredPaths(remoteProviderDir: string): string[] {
  const remoteOfficialPluginDir = buildRemoteAgentOfficialPluginDir(remoteProviderDir);
  return REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS.map((relativePath) =>
    posix.join(remoteOfficialPluginDir, relativePath),
  );
}
