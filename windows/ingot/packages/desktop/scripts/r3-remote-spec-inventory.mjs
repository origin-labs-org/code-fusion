import { readdirSync } from "node:fs";
import { join } from "node:path";

const REMOTE_SPEC_PREFIXES = [
  "conversation-session-r3-",
  "conversation-session-rdux-",
  "conversation-session-ssh-remote-",
  "conversation-session-remote-",
  "conversation-session-plugin-remote-",
];

const EXTRA_REMOTE_SPECS = [
  "conversation-session/manual-review/pending/conversation-session-settings-connection-completion.test.ts",
  "conversation-session/manual-review/pending/conversation-session-project-device-selection.test.ts",
  "conversation-session/manual-review/pending/conversation-session-project-settings-return.test.ts",
  "conversation-session/manual-review/pending/conversation-session-existing-remote-project.test.ts",
  "conversation-session/manual-review/pending/conversation-session-chat-device-return.test.ts",
  "conversation-session/manual-review/pending/conversation-session-chat-remote-folder.test.ts",
  "conversation-session/manual-review/pending/conversation-session-chat-remote-folder-create.test.ts",
  "conversation-session/manual-review/pending/conversation-session-chat-remote-project-choice.test.ts",
  "conversation-session/manual-review/pending/conversation-session-background-connection.test.ts",
  "conversation-session/manual-review/pending/conversation-session-ssh-disconnect-experience.test.ts",
  "conversation-session/manual-review/pending/conversation-session-ssh-provisioning-failure.test.ts",
  "conversation-session/manual-review/pending/conversation-session-share-ssh-artifact.test.ts",
  "bots/bot-remote-disconnected.test.ts",
  "bots/manual-review/pending/bot-r3-workspace-identity.test.ts",
  "bots/bot-runtime-authority.test.ts",
  "conversation-session/manual-review/pending/conversation-session-rpn-project-navigation.test.ts",
  "settings/settings-ui-polish.test.ts",
];

export const DEDICATED_FIXTURE_SPECS = [];

const SCANNED_DIRECTORIES = ["conversation-session", "conversation-session/manual-review/pending"];

function listTestFiles(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isRemoteSpecName(name) {
  return REMOTE_SPEC_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function listRemoteE2ESpecs({ e2eRoot }) {
  const found = new Set(EXTRA_REMOTE_SPECS);
  for (const directory of SCANNED_DIRECTORIES) {
    for (const name of listTestFiles(join(e2eRoot, directory))) {
      if (isRemoteSpecName(name)) {
        found.add(`${directory}/${name}`);
      }
    }
  }
  return [...found].sort();
}

export function extractQueuedSpecs(queueSource) {
  const queued = new Set();
  for (const match of queueSource.matchAll(/\$PENDING\/([\w.-]+\.test\.ts)/gu)) {
    queued.add(`conversation-session/manual-review/pending/${match[1]}`);
  }
  for (const match of queueSource.matchAll(/\$FORMAL\/([\w.-]+\.test\.ts)/gu)) {
    queued.add(`conversation-session/${match[1]}`);
  }
  for (const match of queueSource.matchAll(/test\/e2e\/([\w./-]+\.test\.ts)/gu)) {
    queued.add(match[1]);
  }
  return [...queued].sort();
}

export function diffRemoteSpecCoverage({
  specs,
  queueSource,
  dedicatedFixtureSpecs = DEDICATED_FIXTURE_SPECS,
}) {
  const queued = new Set(extractQueuedSpecs(queueSource));
  const inventory = new Set(specs);
  const dedicated = new Set(dedicatedFixtureSpecs);
  return {
    missing: specs.filter((spec) => !queued.has(spec) && !dedicated.has(spec)),
    unknown: [...queued].filter((spec) => !inventory.has(spec)).sort(),
    staleDedicated: dedicatedFixtureSpecs
      .filter((spec) => !inventory.has(spec) || queued.has(spec))
      .sort(),
  };
}
