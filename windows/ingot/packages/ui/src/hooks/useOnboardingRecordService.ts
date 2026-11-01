import { useServices } from "./useServices.js";

export function useOnboardingRecordService() {
  try {
    const services = useServices();
    return services.onboardingRecordService ?? null;
  } catch {
    return null;
  }
}
