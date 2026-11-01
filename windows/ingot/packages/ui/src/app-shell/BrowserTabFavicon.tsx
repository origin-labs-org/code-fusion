import { useState } from "react";
import { GlobeIcon } from "lucide-react";

function BrowserTabFaviconImage({ faviconUrl }: { faviconUrl: string }) {
  const [hasFailed, setHasFailed] = useState(false);

  if (hasFailed) return <GlobeIcon className="size-3.5" />;

  return (
    <img
      src={faviconUrl}
      alt=""
      className="size-3.5 rounded-sm object-contain"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setHasFailed(true)}
    />
  );
}

export function BrowserTabFavicon({ faviconUrl }: { faviconUrl?: string | null }) {
  if (!faviconUrl) return <GlobeIcon className="size-3.5" />;

  return <BrowserTabFaviconImage key={faviconUrl} faviconUrl={faviconUrl} />;
}
