import { describe, expect, it } from "vitest";
import {
  getLocalizedSidePaneTabTitle,
  getSidePaneTabSearchHint,
  getSidePaneTabTypeLabel,
  type SidePaneTabPresentationLabels,
} from "@/app-shell/sidePaneTabPresentation.js";
import type { WorkspaceSidePaneTab } from "@/lib/workspaceSidePane.js";

const labels: SidePaneTabPresentationLabels = {
  browserTitle: "Browser",
  reviewTitle: "Review",
  codeViewerTitle: "Code preview",
  treemappingTitle: "Treemapping",
  whiteboardTitle: "Whiteboard",
  modelTrajectoryTitle: "Model trajectory",
  developerToolsTitle: "Developer tools",
  pluginMarketTitle: "Plugins",
  terminalTitle: "Terminal",
  subagentTypeLabel: "Subagent",
  subagentDirectoryTitle: "Subagents",
  selectionChatTitle: "Auxiliary conversation",
  planTitle: "Plan",
  workflowRunTitle: "Workflow run",
  workflowActorTitle: "Workflow subagent",
  workflowArtifactTitle: "Artifact",
  workflowScriptTitle: "Script steps",
};

const workflowActorTab: Extract<WorkspaceSidePaneTab, { type: "workflow-actor-session" }> = {
  id: "workflow-actor-session:%2Fworkspace:parent-a:dwf-dwfrun-1-actor_1%401",
  type: "workflow-actor-session",
  workspaceKey: "/workspace",
  workspacePath: "/workspace",
  parentSessionId: "parent-a",
  runId: "dwfrun-1",
  actorSessionId: "dwf-dwfrun-1-actor_1@1",
  siteId: "actor#1",
  ordinal: 2,
  actorName: "reviewer",
};

const workflowRunTab: Extract<WorkspaceSidePaneTab, { type: "workflow-run" }> = {
  id: "workflow-run:%2Fworkspace:parent-a:dwfrun-1",
  type: "workflow-run",
  workspaceKey: "/workspace",
  workspacePath: "/workspace",
  parentSessionId: "parent-a",
  toolCallId: "tool-wf-1",
  runId: "dwfrun-1",
  workflowName: "Three-way review",
};

const workflowArtifactTab: Extract<WorkspaceSidePaneTab, { type: "workflow-artifact" }> = {
  id: "workflow-artifact:%2Fworkspace:parent-a:dwfrun-1:book",
  type: "workflow-artifact",
  workspaceKey: "/workspace",
  workspacePath: "/workspace",
  parentSessionId: "parent-a",
  runId: "dwfrun-1",
  artifactId: "book",
  title: "审计报告",
};

describe("workflow-run tab presentation", () => {
  it("makes the run searchable by run id, tool call id and parent session", () => {
    const hint = getSidePaneTabSearchHint(workflowRunTab);
    expect(hint).toContain("dwfrun-1");
    expect(hint).toContain("tool-wf-1");
    expect(hint).toContain("parent-a");
    expect(hint).toContain("Three-way review");
    expect(hint).toContain("workflow");
  });

  it("labels the type as a workflow run rather than falling through to code preview", () => {
    expect(getSidePaneTabTypeLabel(workflowRunTab, labels)).toBe("Workflow run");
  });

  it("localizes the generic title but keeps a captured workflow name verbatim", () => {
    expect(getLocalizedSidePaneTabTitle(workflowRunTab, labels)).toBe("Three-way review");
    const { workflowName: _dropped, ...unnamed } = workflowRunTab;
    expect(getLocalizedSidePaneTabTitle(unnamed, labels)).toBe("Workflow run");
  });
});

describe("workflow-actor-session tab presentation", () => {
  it("makes the actor searchable by run, site, ordinal and session id", () => {
    const hint = getSidePaneTabSearchHint(workflowActorTab);
    expect(hint).toContain("dwfrun-1");
    expect(hint).toContain("actor#1");
    expect(hint).toContain("dwf-dwfrun-1-actor_1@1");
    expect(hint).toContain("parent-a");
    expect(hint).toContain("reviewer");
    expect(hint).toContain("workflow subagent actor transcript");
  });

  it("labels the type as a workflow actor rather than falling through to code preview", () => {
    expect(getSidePaneTabTypeLabel(workflowActorTab, labels)).toBe("Workflow subagent");
  });

  it("keeps the script-authored actor name verbatim and always carries the instance ordinal", () => {
    expect(getLocalizedSidePaneTabTitle(workflowActorTab, labels)).toBe("reviewer #2");
    const { actorName: _dropped, ...unnamed } = workflowActorTab;
    expect(getLocalizedSidePaneTabTitle(unnamed, labels)).toBe("Workflow subagent #2");
  });
});

describe("workflow-artifact tab presentation", () => {
  it("makes the artifact searchable by its id, run and parent session", () => {
    const hint = getSidePaneTabSearchHint(workflowArtifactTab);
    expect(hint).toContain("book");
    expect(hint).toContain("dwfrun-1");
    expect(hint).toContain("parent-a");
    expect(hint).toContain("审计报告");
    expect(hint).toContain("workflow artifact deliverable");
  });

  it("labels the type as an artifact rather than falling through to code preview", () => {
    expect(getSidePaneTabTypeLabel(workflowArtifactTab, labels)).toBe("Artifact");
  });

  it("keeps the captured title verbatim, then the artifact id, then the generic label", () => {
    expect(getLocalizedSidePaneTabTitle(workflowArtifactTab, labels)).toBe("审计报告");
    const { title: _dropped, ...untitled } = workflowArtifactTab;
    expect(getLocalizedSidePaneTabTitle(untitled, labels)).toBe("book");
    expect(getLocalizedSidePaneTabTitle({ ...untitled, artifactId: "" }, labels)).toBe("Artifact");
  });
});

describe("workflow-workspace tab presentation", () => {
  const workflowWorkspaceTab: Extract<WorkspaceSidePaneTab, { type: "workflow-workspace" }> = {
    id: "workflow-workspace:%2Fworkspace:parent-a:dwfrun-1",
    type: "workflow-workspace",
    workspaceKey: "/workspace",
    workspacePath: "/workspace",
    parentSessionId: "parent-a",
    toolCallId: "tool-wf-1",
    runId: "dwfrun-1",
    workflowName: "Fan-out review",
  };

  it("makes the transcript searchable by run, tool call, parent session and the facade words", () => {
    const hint = getSidePaneTabSearchHint(workflowWorkspaceTab);
    expect(hint).toContain("dwfrun-1");
    expect(hint).toContain("tool-wf-1");
    expect(hint).toContain("parent-a");
    expect(hint).toContain("Fan-out review");
    expect(hint).toContain("workflow script steps workspace transcript files git run");
  });

  it("labels the type as a workflow workspace rather than falling through to code preview", () => {
    expect(getSidePaneTabTypeLabel(workflowWorkspaceTab, labels)).toBe("Script steps");
  });

  it("titles the tab with the run name and falls back to the generic label", () => {
    expect(getLocalizedSidePaneTabTitle(workflowWorkspaceTab, labels)).toBe("Fan-out review");
    const { workflowName: _dropped, ...unnamed } = workflowWorkspaceTab;
    expect(getLocalizedSidePaneTabTitle(unnamed, labels)).toBe("Script steps");
  });
});
