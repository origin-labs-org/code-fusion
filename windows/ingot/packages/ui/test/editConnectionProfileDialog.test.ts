// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile, SourceServerRecord } from "@origin-ai/cf-shared";
import { EditConnectionProfileDialog } from "@/remote-connection/EditConnectionProfileDialog.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: { formatMessage: ({ id }: { id: string }) => id },
  }),
}));

const platform = vi.hoisted(() => ({
  listSSHConfigAliases: vi.fn(async () => []),
  listWSLDistros: vi.fn(async () => []),
  isDockerAvailable: vi.fn(async () => false),
  listDockerContainers: vi.fn(async () => []),
  selectFile: vi.fn(async () => "/keys/id_ed25519"),
}));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => platform }));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  platform.listSSHConfigAliases.mockResolvedValue([]);
  platform.isDockerAvailable.mockResolvedValue(false);
  platform.listDockerContainers.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EditConnectionProfileDialog", () => {
  it("updates an SSH connection in a centered save/cancel dialog", async () => {
    const profile: ConnectionProfile = {
      profileId: "17ef20b3-622d-4a53-98c1-0cdff29f3e6d",
      sourceServerId: "3cd4f9da-cd79-426c-9d70-75f36e9f6a87",
      transport: "ssh",
      displayName: "primary",
      target: {
        kind: "ssh",
        host: "old.example.com",
        port: 22,
        username: "old-user",
        passwordCredentialKey: "connection-profile:p:password",
      },
      createdAt: 1,
      lifecycleState: "active",
    };
    const source: SourceServerRecord = {
      sourceServerId: profile.sourceServerId!,
      displayName: "Old device",
      preferredProfileId: profile.profileId,
      installState: "installed",
      declaredWorkspaces: [],
    };
    const updateProfile = vi.fn(async () => ({ generation: 2 }));
    const onOpenChange = vi.fn();

    render(
      createElement(EditConnectionProfileDialog, {
        open: true,
        profile,
        source,
        management: { updateProfile } as never,
        onOpenChange,
      }),
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      (screen.getByLabelText("settings.source.connectionName") as HTMLInputElement).value,
    ).toBe("primary");
    expect((screen.getByLabelText("settings.source.deviceName") as HTMLInputElement).value).toBe(
      "Old device",
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.change(screen.getByLabelText("settings.source.connectionName"), {
      target: { value: "Build server" },
    });
    fireEvent.change(screen.getByLabelText("ssh.host"), {
      target: { value: "new.example.com" },
    });
    fireEvent.change(screen.getByLabelText("ssh.port"), {
      target: { value: "2222" },
    });
    fireEvent.change(screen.getByLabelText("ssh.username"), {
      target: { value: "dev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.saveChanges" }));

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({
        profileId: profile.profileId,
        profileDisplayName: "Build server",
        sshAuthMethod: "password",
        target: {
          kind: "ssh",
          host: "new.example.com",
          port: 2222,
          username: "dev",
          assetInstallMode: "local-download-upload",
        },
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Prevent duplicate submit and close while saving; show original cause on failure and allow retry", async () => {
    const profile: ConnectionProfile = {
      profileId: "p",
      transport: "docker",
      displayName: "Container connection",
      target: { kind: "docker", container: "dev" },
      createdAt: 1,
    };
    let fail!: (error: Error) => void;
    const updateProfile = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const onOpenChange = vi.fn();
    render(
      createElement(EditConnectionProfileDialog, {
        open: true,
        profile,
        management: { updateProfile } as never,
        onOpenChange,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "common.saveChanges" }));
    const saving = screen.getByRole("button", { name: "common.saving" });
    expect(saving.getAttribute("aria-busy")).toBe("true");
    fireEvent.submit(saving.closest("form")!);
    fireEvent.keyDown(saving, { key: "Escape" });
    expect(updateProfile).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => fail(new Error("Credential vault is locked")));
    expect(screen.getByRole("alert").textContent).toBe("Credential vault is locked");
    expect(
      screen.getByRole("button", { name: "common.saveChanges" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("Share auth segment, private key selection and download method; device name saved separately", async () => {
    const profile: ConnectionProfile = {
      profileId: "p",
      sourceServerId: "s",
      transport: "ssh",
      displayName: "SSH route",
      target: { kind: "ssh", host: "build", username: "dev", passwordCredentialKey: "secret" },
      createdAt: 1,
    };
    const source: SourceServerRecord = {
      sourceServerId: "s",
      displayName: "Build device",
      installState: "installed",
    };
    const updateProfile = vi.fn(async () => ({}));
    render(
      createElement(EditConnectionProfileDialog, {
        open: true,
        profile,
        source,
        management: { updateProfile } as never,
        onOpenChange: vi.fn(),
      }),
    );
    fireEvent.change(screen.getByLabelText("settings.source.deviceName"), {
      target: { value: "Renamed device" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ssh.auth.privateKey" }));
    expect(
      screen.getByRole("button", { name: "ssh.auth.privateKey" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByTitle("ssh.privateKeySelect"));
    await waitFor(() =>
      expect((screen.getByTestId("ssh-private-key-input") as HTMLInputElement).value).toBe(
        "/keys/id_ed25519",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /ssh.advancedOptions/ }));
    fireEvent.click(screen.getByRole("button", { name: "ssh.assetInstallMode.remote-download" }));
    fireEvent.click(screen.getByRole("button", { name: "common.saveChanges" }));
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          profileDisplayName: "SSH route",
          sourceDisplayName: "Renamed device",
          sshAuthMethod: "privateKey",
          target: expect.objectContaining({
            privateKeyPath: "/keys/id_ed25519",
            assetInstallMode: "remote-download",
          }),
        }),
      ),
    );
  });

  it("Saved alias shown in control; will not write back old alias after explicit clear", async () => {
    const profile: ConnectionProfile = {
      profileId: "p",
      transport: "ssh",
      displayName: "Route",
      target: {
        kind: "ssh",
        host: "build",
        username: "dev",
        sshConfigAlias: "build-alias",
        passwordCredentialKey: "secret",
      },
      createdAt: 1,
    };
    const updateProfile = vi.fn(async () => ({}));
    render(
      createElement(EditConnectionProfileDialog, {
        open: true,
        profile,
        management: { updateProfile } as never,
        onOpenChange: vi.fn(),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "ssh.advancedOptions" }));
    const trigger = screen.getByTestId("ssh-config-alias-select");
    await waitFor(() => expect(trigger.textContent).toContain("build-alias"));
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "ssh.configAliasPlaceholder" }));
    fireEvent.click(screen.getByRole("button", { name: "common.saveChanges" }));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledOnce());
    expect(updateProfile.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        target: {
          kind: "ssh",
          host: "build",
          username: "dev",
          port: 22,
          assetInstallMode: "local-download-upload",
        },
      }),
    );
  });

  it("Save with default 22 when selecting config alias with no Port specified", async () => {
    platform.listSSHConfigAliases.mockResolvedValue([
      { alias: "new-alias", host: "new-host", username: "dev" },
    ] as never);
    const profile: ConnectionProfile = {
      profileId: "p",
      transport: "ssh",
      displayName: "Route",
      target: { kind: "ssh", host: "build", username: "dev", passwordCredentialKey: "secret" },
      createdAt: 1,
    };
    const updateProfile = vi.fn(async () => ({}));
    render(
      createElement(EditConnectionProfileDialog, {
        open: true,
        profile,
        management: { updateProfile } as never,
        onOpenChange: vi.fn(),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "ssh.advancedOptions" }));
    const trigger = screen.getByTestId("ssh-config-alias-select");
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /new-alias/ }));
    fireEvent.click(screen.getByRole("button", { name: "common.saveChanges" }));
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({
            host: "new-host",
            port: 22,
            sshConfigAlias: "new-alias",
          }),
        }),
      ),
    );
  });

  it("When editing an existing Docker connection, selecting a new container from dropdown replaces old manual value", async () => {
    platform.isDockerAvailable.mockResolvedValue(true);
    platform.listDockerContainers.mockResolvedValue([
      { id: "new", name: "new-container", image: "dev", status: "Up" },
    ] as never);
    const profile: ConnectionProfile = {
      profileId: "p",
      transport: "docker",
      displayName: "Dev",
      target: { kind: "docker", container: "old-container" },
      createdAt: 1,
    };
    const updateProfile = vi.fn(async () => ({}));
    render(
      createElement(EditConnectionProfileDialog, {
        open: true,
        profile,
        management: { updateProfile } as never,
        onOpenChange: vi.fn(),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "docker.inputMode.select" }));
    const trigger = screen.getByTestId("docker-container-select");
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText("new-container"));
    fireEvent.click(screen.getByRole("button", { name: "common.saveChanges" }));
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ target: { kind: "docker", container: "new-container" } }),
      ),
    );
  });

  it.each([
    {
      transport: "wsl" as const,
      target: { kind: "wsl" as const, distro: "Ubuntu", user: "old-user" },
      fieldLabel: "wsl.user",
      fieldValue: "dev",
      expectedTarget: { kind: "wsl", distro: "Ubuntu", user: "dev" },
    },
    {
      transport: "docker" as const,
      target: { kind: "docker" as const, container: "old-container" },
      fieldLabel: "docker.container",
      fieldValue: "cf-dev",
      expectedTarget: { kind: "docker", container: "cf-dev" },
    },
  ])("updates a $transport connection without exposing SSH-only fields", async (entry) => {
    const profile: ConnectionProfile = {
      profileId: "17ef20b3-622d-4a53-98c1-0cdff29f3e6d",
      transport: entry.transport,
      displayName: "saved connection",
      target: entry.target,
      createdAt: 1,
      lifecycleState: "active",
    } as ConnectionProfile;
    const updateProfile = vi.fn(async () => ({ generation: 2 }));

    render(
      createElement(EditConnectionProfileDialog, {
        open: true,
        profile,
        management: { updateProfile } as never,
        onOpenChange: vi.fn(),
      }),
    );

    expect(screen.queryByLabelText("ssh.username")).toBeNull();
    fireEvent.change(screen.getByLabelText(entry.fieldLabel), {
      target: { value: entry.fieldValue },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.saveChanges" }));

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({
        profileId: profile.profileId,
        profileDisplayName: "saved connection",
        target: entry.expectedTarget,
      }),
    );
  });
});

it("Prompt for device name when it is empty; do not falsely report connection name", async () => {
  const updateProfile = vi.fn();
  render(
    createElement(EditConnectionProfileDialog, {
      open: true,
      profile: {
        profileId: "p",
        sourceServerId: "source",
        transport: "ssh",
        displayName: "connection",
        target: { kind: "ssh", host: "host", username: "dev", passwordCredentialKey: "key" },
        createdAt: 1,
      },
      source: {
        sourceServerId: "source",
        displayName: "Device",
        preferredProfileId: "p",
        installState: "installed",
        declaredWorkspaces: [],
      },
      management: { updateProfile } as never,
      onOpenChange: vi.fn(),
    }),
  );
  fireEvent.change(screen.getByLabelText("settings.source.deviceName"), { target: { value: " " } });
  fireEvent.click(screen.getByRole("button", { name: "common.saveChanges" }));
  expect(screen.getByRole("alert").textContent).toBe("settings.source.deviceNameRequired");
  expect(updateProfile).not.toHaveBeenCalled();
});

it("Connection field error appears below the corresponding field, focusing on the first erroneous field", async () => {
  const updateProfile = vi.fn();
  render(
    createElement(EditConnectionProfileDialog, {
      open: true,
      profile: {
        profileId: "p",
        transport: "ssh",
        displayName: "connection",
        target: { kind: "ssh", host: "host", username: "dev", passwordCredentialKey: "key" },
        createdAt: 1,
      },
      management: { updateProfile } as never,
      onOpenChange: vi.fn(),
    }),
  );
  const host = screen.getByLabelText("ssh.host");
  fireEvent.change(host, { target: { value: " " } });
  fireEvent.change(screen.getByLabelText("ssh.port"), { target: { value: "70000" } });
  fireEvent.click(screen.getByRole("button", { name: "common.saveChanges" }));

  const hostError = (await screen.findByText("ssh.validation.hostRequired")).closest("p")!;
  expect(host.getAttribute("aria-describedby")).toBe(hostError.id);
  expect(screen.getByText("ssh.validation.port")).toBeTruthy();
  expect(screen.queryByText("ssh.validation.passwordRequired")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.activeElement).toBe(host);
  expect(updateProfile).not.toHaveBeenCalled();
});

it("When opened via Edit Host, validation failure focuses on the field that actually errored rather than the prompted host", async () => {
  const updateProfile = vi.fn();
  render(
    createElement(EditConnectionProfileDialog, {
      open: true,
      focusField: "host",
      profile: {
        profileId: "p",
        transport: "ssh",
        displayName: "connection",
        target: { kind: "ssh", host: "host", username: "dev", passwordCredentialKey: "key" },
        createdAt: 1,
      },
      management: { updateProfile } as never,
      onOpenChange: vi.fn(),
    }),
  );
  const username = screen.getByLabelText("ssh.username");
  fireEvent.change(username, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "common.saveChanges" }));

  await screen.findByText("ssh.validation.usernameRequired");
  expect(document.activeElement).toBe(username);
  expect(updateProfile).not.toHaveBeenCalled();
});
