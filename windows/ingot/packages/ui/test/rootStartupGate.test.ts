import { describe, expect, it } from "vitest";
import {
  isProviderStartupSyncPending,
  shouldEnableProviderAvailabilityLoginEntryGuard,
  shouldResolveProviderStartupState,
  shouldBlockRootRender,
  shouldShowRootStartupLoading,
  shouldOpenFallbackWorkspaceAfterCreate,
} from "@/lib/rootStartupGate.js";

describe("Root startup gate", () => {
  it("Blocks first screen while restoring tabs", () => {
    expect(
      shouldBlockRootRender({
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: false,
        isRestoring: true,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(true);
  });

  it("Blocks first screen while injecting initial workspace", () => {
    expect(
      shouldBlockRootRender({
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: false,
        isRestoring: false,
        isBootstrappingInitialWorkspace: true,
      }),
    ).toBe(true);
  });

  it("Blocks first screen while startup auth state is pending", () => {
    expect(
      shouldBlockRootRender({
        isResolvingStartupAuthState: true,
        isResolvingProviderStartupState: false,
        isRestoring: false,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(true);
  });

  it("Blocks first screen while provider login entry determination is pending", () => {
    expect(
      shouldBlockRootRender({
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: true,
        isRestoring: false,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(true);
  });

  it("Unblocks first screen only after all startup checks complete", () => {
    expect(
      shouldBlockRootRender({
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: false,
        isRestoring: false,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(false);
  });

  it("Postpones first screen release when provider startup sync is incomplete", () => {
    const providerStartupSyncPending = isProviderStartupSyncPending({
      providerFamilyDomainMigrationComplete: false,
      modelSelectionViewHydrated: true,
    });
    expect(providerStartupSyncPending).toBe(true);
    expect(
      shouldBlockRootRender({
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: providerStartupSyncPending,
        isRestoring: false,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(true);
  });

  it("Web remote control Root does not run provider login entry guards", () => {
    expect(
      shouldEnableProviderAvailabilityLoginEntryGuard({
        isWebRemoteControlRoot: true,
      }),
    ).toBe(false);
  });

  it("Web remote control Root does not gate workspace injection on provider startup state", () => {
    expect(
      shouldResolveProviderStartupState({
        isWebRemoteControlRoot: true,
        providerStartupSyncPending: true,
        providerAvailabilityStartupCheckCompleted: false,
      }),
    ).toBe(false);
  });

  it("Desktop Root continues to await provider startup check resolution", () => {
    expect(
      shouldResolveProviderStartupState({
        isWebRemoteControlRoot: false,
        providerStartupSyncPending: false,
        providerAvailabilityStartupCheckCompleted: false,
      }),
    ).toBe(true);
  });

  it("Should not continue displaying startup loading when the login entry is already open", () => {
    expect(
      shouldShowRootStartupLoading({
        isDesktop: true,
        welcomeScreenOpen: true,
        isResolvingStartupAuthState: false,
        isResolvingProviderStartupState: true,
        isRestoring: false,
        isBootstrappingInitialWorkspace: false,
      }),
    ).toBe(false);
  });

  it("When fallback default workspace returns, do not preempt current tab if active workspace is already restored", () => {
    expect(
      shouldOpenFallbackWorkspaceAfterCreate({
        isMounted: true,
        activeWorkspacePath: "/Users/dev/workspace/cgx-dev-web",
      }),
    ).toBe(false);
  });
});
