import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "@origin-ai/cf-shared";
import type { useOnboardingRecordService } from "@/hooks/useOnboardingRecordService.js";
import { logger } from "@/logger.js";

export function useOnboardingTrigger(options: {
  onboardingRecord: ReturnType<typeof useOnboardingRecordService>;
  userId: string | null;
  loadDeviceMid: () => string;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}): [boolean | null, () => void] {
  const { onboardingRecord, userId, loadDeviceMid, update } = options;
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const lastSyncedUserIdRef = useRef<string | null | undefined>(undefined);
  const needsOnboardingRef = useRef<boolean | null>(null);
  needsOnboardingRef.current = needsOnboarding;
  const releaseDeadlineRef = useRef<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!onboardingRecord) {
      setNeedsOnboarding(false);
      return;
    }
    if (needsOnboardingRef.current === null) {
      releaseDeadlineRef.current ??= Date.now() + 3000;
    }
    const deadline = releaseDeadlineRef.current;
    const timeout =
      deadline === null
        ? null
        : setTimeout(
            () => {
              if (cancelled || needsOnboardingRef.current !== null) return;
              releaseDeadlineRef.current = null;
              logger.warn("[occupation-onboarding] shouldOnboard timed out; conservatively defaulting to no onboarding");
              setNeedsOnboarding(false);
            },
            Math.max(0, deadline - Date.now()),
          );
    onboardingRecord
      .claimAnonymousRecord()
      .catch((cause: unknown) => {
        logger.warn("[occupation-onboarding] 认领匿名引导记录失败", { error: String(cause) });
      })
      .then(() => onboardingRecord.shouldOnboard(loadDeviceMid()))
      .then(
        (result) => {
          if (!cancelled) {
            releaseDeadlineRef.current = null;
            setNeedsOnboarding(result);
          }
          const previousUserId = lastSyncedUserIdRef.current;
          lastSyncedUserIdRef.current = userId;
          if (!cancelled && !result && previousUserId != null && previousUserId !== userId) {
            void onboardingRecord
              .syncSettingsFromRecord()
              .then((patch) => {
                if (cancelled || !patch) return;
                return update(patch);
              })
              .catch((cause: unknown) => {
                logger.warn("[occupation-onboarding] Failed to sync preferences by record", {
                  error: String(cause),
                });
              });
          }
        },
        (cause) => {
          logger.warn("[occupation-onboarding] shouldOnboard check failed; conservatively defaulting to no onboarding", {
            error: String(cause),
          });
          if (!cancelled) {
            releaseDeadlineRef.current = null;
            setNeedsOnboarding(false);
          }
        },
      )
      .finally(() => {
        if (timeout !== null) clearTimeout(timeout);
      });
    return () => {
      cancelled = true;
      if (timeout !== null) clearTimeout(timeout);
    };
  }, [onboardingRecord, userId, loadDeviceMid]);
  return [
    needsOnboarding,
    () => {
      releaseDeadlineRef.current = null;
      setNeedsOnboarding(false);
    },
  ];
}
