import { useContext, useSyncExternalStore } from "react";
import { isMarketingBannerRenderable } from "@/components/marketing-touch/marketingTouchController.js";
import { MarketingTouchContext } from "@/components/marketing-touch/MarketingTouchProvider.js";

const subscribeNoop = () => () => {};

export function useMarketingBannerVisible(): boolean {
  const controller = useContext(MarketingTouchContext);
  return useSyncExternalStore(
    controller ? controller.store.subscribe : subscribeNoop,
    () => (controller ? isMarketingBannerRenderable(controller.store.getState().banner) : false),
    () => false,
  );
}
