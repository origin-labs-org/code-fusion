import { initArmsBrowserRumOnce } from "../../shared/armsBrowserInit.js";

export function bootstrapArmsBrowserRum(): void {
  initArmsBrowserRumOnce(import.meta.env.DEV ? "development" : "production");
}
