import { describe, expect, it, vi } from "vitest";
import type { ProviderSettingsView } from "@origin-ai/cf-services";
import { createAccountConnectionRefreshObserver } from "@/root/accountConnectionRefreshObserver.js";

function view(
  revision: number,
  availability = "unavailable",
  connectionKey = "user/start",
  current = true,
): ProviderSettingsView {
  return {
    revision,
    providers: [
      {
        providerId: "account:bigmodel-individual-coding-plan",
        accountState: {
          availability,
          connectionKey,
          current,
          entitled: availability === "available",
        },
      },
    ],
  } as ProviderSettingsView;
}

describe("Plan expiration event (Todo93)", () => {
  it("Observe only paid plan expiration when both Start and paid plans are current", async () => {
    const notify = vi.fn();
    const observer = createAccountConnectionRefreshObserver(notify);
    const combined = (revision: number, start: string, paid: string) => {
      const snapshot = view(revision, paid);
      return {
        ...snapshot,
        providers: [
          { ...view(revision, start).providers[0]!, providerId: "account:bigmodel-start-plan" },
          ...snapshot.providers,
        ],
      };
    };
    await observer.accept(combined(1, "available", "available"));
    await observer.accept(combined(2, "unavailable", "available"));
    expect(notify).not.toHaveBeenCalled();
    await observer.accept(combined(3, "available", "unavailable"));
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0]![0].providerId).toBe("account:bigmodel-individual-coding-plan");
  });
  it("Discard recommendations immediately when setting intent changes before View updates", async () => {
    const notify = vi.fn();
    const observer = createAccountConnectionRefreshObserver(notify);
    await observer.accept(view(1, "available"));
    await observer.accept(view(2));
    const event = notify.mock.calls[0]![0];
    observer.invalidate();
    await observer.accept(view(3));
    expect(event.isCurrent()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("First item only establishes baseline; notify only once when same identity goes from available to expired, renotifying only after recovery", async () => {
    const notify = vi.fn();
    const observer = createAccountConnectionRefreshObserver(notify);
    await observer.accept(view(1));
    await observer.accept(view(2));
    expect(notify).not.toHaveBeenCalled();
    await observer.accept(view(3, "available"));
    await observer.accept(view(4));
    await observer.accept(view(5));
    expect(notify).toHaveBeenCalledTimes(1);
    await observer.accept(view(6, "available"));
    await observer.accept(view(7));
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it("Unknown does not determine expiration or clear definite baselines; do not prompt on first unavailable after initial unknown", async () => {
    const notify = vi.fn();
    const observer = createAccountConnectionRefreshObserver(notify);
    await observer.accept(view(1, "unknown"));
    await observer.accept(view(2));
    expect(notify).not.toHaveBeenCalled();
    await observer.accept(view(3, "pending"));
    await observer.accept(view(4, "unknown"));
    expect(notify).not.toHaveBeenCalled();
    await observer.accept(view(5));
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("Re-establish baseline on account/Team identity change; switching away and back does not revive old recommendations", async () => {
    const notify = vi.fn();
    const observer = createAccountConnectionRefreshObserver(notify);
    await observer.accept(view(1, "available", "user/team-a"));
    await observer.accept(view(2, "unavailable", "user/team-b"));
    expect(notify).not.toHaveBeenCalled();
    await observer.accept(view(3, "available"));
    await observer.accept(view(4));
    const event = notify.mock.calls[0]![0];
    expect(event.isCurrent()).toBe(true);
    await observer.accept(view(5, "unavailable", "other-user/start"));
    await observer.accept(view(6));
    expect(event.isCurrent()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("In-flight notifications do not block new facts; stale notifications must not take effect after recovery", async () => {
    let finish!: () => void;
    const notify = vi.fn(
      async (_event: { isCurrent(): boolean }) =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    const observer = createAccountConnectionRefreshObserver(notify);
    await observer.accept(view(1, "available"));
    const pending = observer.accept(view(2));
    await observer.accept(view(3, "available"));
    expect(notify.mock.calls[0]![0].isCurrent()).toBe(false);
    finish();
    await pending;
    observer.dispose();
    await observer.accept(view(4));
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("Old revisions and non-current entities do not cause cross-identity expirations", async () => {
    const notify = vi.fn();
    const observer = createAccountConnectionRefreshObserver(notify);
    await observer.accept(view(3, "available"));
    await observer.accept(view(2));
    await observer.accept(view(4, "unavailable", "user/start", false));
    await observer.accept(view(5));
    expect(notify).not.toHaveBeenCalled();
  });
});
