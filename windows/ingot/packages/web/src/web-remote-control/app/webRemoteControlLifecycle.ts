interface WebRemoteControlLifecycleTarget {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

interface WebRemoteControlDocumentLifecycleTarget extends WebRemoteControlLifecycleTarget {
  visibilityState: DocumentVisibilityState;
}

interface WebRemoteControlLifecycleRecoveryOptions {
  documentTarget: WebRemoteControlDocumentLifecycleTarget;
  windowTarget: WebRemoteControlLifecycleTarget;
  onSuspend(): void;
  onRecover(reason: "visible" | "pageshow" | "online" | "resume"): void;
}

export function createWebRemoteControlLifecycleRecovery({
  documentTarget,
  windowTarget,
  onSuspend,
  onRecover,
}: WebRemoteControlLifecycleRecoveryOptions): { dispose(): void } {
  let suspended = false;
  const suspend = () => {
    suspended = true;
    onSuspend();
  };
  const recover = (reason: "visible" | "pageshow" | "online" | "resume") => {
    if (!suspended) {
      return;
    }
    suspended = false;
    onRecover(reason);
  };
  const handleVisibilityChange = () => {
    if (documentTarget.visibilityState === "hidden") {
      suspend();
      return;
    }
    recover("visible");
  };
  const handlePageShow = () => recover("pageshow");
  const handleOnline = () => recover("online");
  const handleResume = () => recover("resume");
  const handlePageHide = () => suspend();
  const handleFreeze = () => suspend();

  documentTarget.addEventListener("visibilitychange", handleVisibilityChange);
  documentTarget.addEventListener("freeze", handleFreeze);
  documentTarget.addEventListener("resume", handleResume);
  windowTarget.addEventListener("pageshow", handlePageShow);
  windowTarget.addEventListener("pagehide", handlePageHide);
  windowTarget.addEventListener("online", handleOnline);

  return {
    dispose() {
      documentTarget.removeEventListener("visibilitychange", handleVisibilityChange);
      documentTarget.removeEventListener("freeze", handleFreeze);
      documentTarget.removeEventListener("resume", handleResume);
      windowTarget.removeEventListener("pageshow", handlePageShow);
      windowTarget.removeEventListener("pagehide", handlePageHide);
      windowTarget.removeEventListener("online", handleOnline);
    },
  };
}
