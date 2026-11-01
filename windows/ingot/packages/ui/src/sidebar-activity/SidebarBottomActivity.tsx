import { MarketingBanner } from "@/components/marketing-touch/MarketingTouchProvider.js";
import { useMarketingBannerVisible } from "@/components/marketing-touch/useMarketingBannerVisible.js";
import { GlobalNoticeSurface } from "@/global-notice/GlobalNoticeSurface.js";
import type { GlobalNoticeStore } from "@/global-notice/globalNoticeStore.js";

export function SidebarBottomActivity({
  noticeStore,
}: {
  noticeStore?: GlobalNoticeStore | null;
} = {}) {
  const bannerVisible = useMarketingBannerVisible();
  if (bannerVisible) return <MarketingBanner />;
  return <GlobalNoticeSurface store={noticeStore ?? undefined} />;
}
