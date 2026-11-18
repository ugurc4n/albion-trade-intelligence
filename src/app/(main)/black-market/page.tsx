import type { Metadata } from "next";
import { OpportunitiesView } from "@/components/opportunities-view";

export const metadata: Metadata = { title: "Black Market Flipping · Albion Trade Intelligence" };

export default function BlackMarketPage() {
  return <OpportunitiesView variant="blackmarket" />;
}
