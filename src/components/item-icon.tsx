"use client";

import { useState } from "react";
import { ICON_URL } from "@/lib/albion/constants";
import { cn } from "@/lib/utils";

/** Item icon from the official render service. Plain <img>: next/image would proxy thousands of icons for no gain. */
export function ItemIcon({ itemId, quality = 1, size = 32, className }: { itemId: string; quality?: number; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className={cn("shrink-0 rounded bg-muted", className)} style={{ width: size, height: size }} aria-hidden />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ICON_URL(itemId, quality, size <= 40 ? 64 : 128)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("shrink-0", className)}
    />
  );
}
