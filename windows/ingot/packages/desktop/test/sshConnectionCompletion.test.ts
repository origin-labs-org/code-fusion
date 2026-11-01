import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureSSHProjectDirectoryStep, waitForSSHDirectoryStep } from "#e2e/helpers/ssh-remote-p0";

vi.mock("#e2e/helpers/desktop-app", () => ({}));
vi.mock("#e2e/helpers/custom-openai-provider-store", () => ({}));
vi.mock("#e2e/helpers/v4-conversation", () => ({
  startNewV4Draft: vi.fn(() => {
    throw new Error("Current project selection is still in progress; should not create new draft and reopen wizard");
  }),
}));

type Step =
  | "install"
  | "connecting"
  | "directory"
  | "project-form"
  | "closing-form"
  | "project-picker"
  | "project-picker-loading"
  | "project-picker-error"
  | "closed"
  | "error"
  | "unexpected-confirm";

function installBrowserFixture(initialStep: Step) {
  let step = initialStep;
  const install = {
    textContent: "Install and continue",
    disabled: false,
    getClientRects: () => [1],
    click: vi.fn(() => {
      step = "closed";
    }),
  };
  const dialog = { querySelectorAll: () => (step === "install" ? [install] : []) };
  const confirmation = {
    disabled: false,
    getClientRects: () => [1],
    closest: () => ({ dataset: { confirmIntent: "source-server-force-update" } }),
    click: vi.fn(),
  };
  const document = {
    querySelectorAll: () =>
      ["project-form", "closing-form"].includes(step)
        ? [
            {
              closest: () => ({
                getAttribute: () => (step === "project-form" ? "open" : "closed"),
              }),
            },
          ]
        : [],
    querySelector: (selector: string) => {
      if (selector === '[data-testid="ssh-dialog"]')
        return [
          "closed",
          "project-picker",
          "project-picker-loading",
          "project-picker-error",
        ].includes(step)
          ? null
          : dialog;
      if (selector === '[data-testid="remote-project-new"]' && step.startsWith("project-picker"))
        return {
          disabled: step !== "project-picker",
          closest: () => ({
            querySelector: () =>
              step === "project-picker-error"
                ? {
                    getClientRects: () => [1],
                    innerText: "SourceServerWorkspaceIdentityConflictError: /work",
                  }
                : null,
          }),
        };
      if (selector === '[data-testid="ssh-success"]' && step === "directory") {
        return { getClientRects: () => [1] };
      }
      if (selector === '[data-testid="ssh-error"]' && step === "error") {
        return { getClientRects: () => [1], innerText: "Authentication failed" };
      }
      if (selector === '[data-testid="confirm-dialog-confirm"]' && step === "unexpected-confirm") {
        return confirmation;
      }
      return null;
    },
  };
  const waitUntil = vi.fn(
    async (predicate: () => Promise<boolean>, options: { timeoutMsg: string }) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (await predicate()) return;
      }
      throw new Error(options.timeoutMsg);
    },
  );
  vi.stubGlobal("browser", {
    execute: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      runInNewContext(`(${fn.toString()})(...args)`, { document, args }),
    waitUntil,
  });
  return { install, confirmation };
}

afterEach(() => vi.unstubAllGlobals());

describe("Wait for SSH connection completion", () => {
  it("Return closed when wizard is actually closed and has no project selection page", async () => {
    installBrowserFixture("closed");
    await expect(waitForSSHDirectoryStep("E2E_SSH_COMPLETION")).resolves.toBe("closed");
  });

  it("Can still complete even if wizard is closed after initial install confirmation", async () => {
    const { install } = installBrowserFixture("install");
    await expect(waitForSSHDirectoryStep("E2E_SSH_COMPLETION")).resolves.toBe("closed");
    expect(install.click).toHaveBeenCalledOnce();
  });

  it("目录页仍返回独立的 directory 完成态", async () => {
    installBrowserFixture("directory");
    await expect(waitForSSHDirectoryStep("E2E_SSH_COMPLETION")).resolves.toBe("directory");
  });

  it("Project selection page resumes current flow after replacing connection wizard without reopening covered sidebar", async () => {
    installBrowserFixture("project-picker");
    await expect(
      ensureSSHProjectDirectoryStep(
        { host: "127.0.0.1", port: 43210, username: "dev", password: "fixture" },
        "E2E_SSH_COMPLETION",
      ),
    ).resolves.toBeUndefined();
  });

  it("项目列表尚在加载时不把连接向导消失当作完成", async () => {
    installBrowserFixture("project-picker-loading");
    await expect(waitForSSHDirectoryStep("E2E_SSH_COMPLETION")).rejects.toThrow(
      "SSH 部署/连接没有完成",
    );
  });

  it("连接中不提前宣告成功", async () => {
    installBrowserFixture("connecting");
    await expect(waitForSSHDirectoryStep("E2E_SSH_COMPLETION")).rejects.toThrow(
      "SSH 部署/连接没有完成",
    );
  });

  it("Project list error immediately reports original cause without waiting for mistakenly disabled new project button", async () => {
    installBrowserFixture("project-picker-error");
    await expect(waitForSSHDirectoryStep("E2E_SSH_COMPLETION")).rejects.toThrow(
      "SourceServerWorkspaceIdentityConflictError: /work",
    );
  });

  it("Connection error fails directly carrying original cause", async () => {
    installBrowserFixture("error");
    await expect(waitForSSHDirectoryStep("E2E_SSH_COMPLETION")).rejects.toThrow(
      "SSH 连接失败: Authentication failed",
    );
  });

  it("不确认安装和边界提示以外的动作", async () => {
    const { confirmation } = installBrowserFixture("unexpected-confirm");
    await expect(waitForSSHDirectoryStep("E2E_SSH_COMPLETION")).rejects.toThrow(
      "unexpected confirmation intent: source-server-force-update",
    );
    expect(confirmation.click).not.toHaveBeenCalled();
  });
});

it("Existing device connection completed and returned to open project form; directory intent can proceed", async () => {
  installBrowserFixture("project-form");
  await expect(waitForSSHDirectoryStep("E2E_PROJECT_FORM")).resolves.toBe("directory");
});
it("原表单正在收起时不把未完成连接误判为完成", async () => {
  installBrowserFixture("closing-form");
  await expect(waitForSSHDirectoryStep("E2E_PROJECT_FORM")).rejects.toThrow(
    "SSH 部署/连接没有完成",
  );
});
