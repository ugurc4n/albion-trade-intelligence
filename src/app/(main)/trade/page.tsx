import type { Metadata } from "next";
import { OpportunitiesView } from "@/components/opportunities-view";

export const metadata: Metadata = { title: "Cross-City Trade · Albion Trade Intelligence" };

export default function TradePage() {
  return <OpportunitiesView variant="trade" />;
}
