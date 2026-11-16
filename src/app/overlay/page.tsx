import type { Metadata } from "next";
import { OverlayView } from "@/components/overlay-view";

export const metadata: Metadata = { title: "Overlay · Albion Trade Intelligence" };

export default function OverlayPage() {
  return <OverlayView />;
}
