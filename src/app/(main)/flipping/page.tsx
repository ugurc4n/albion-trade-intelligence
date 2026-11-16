import type { Metadata } from "next";
import { OpportunitiesView } from "@/components/opportunities-view";

export const metadata: Metadata = { title: "Market Flipping · Albion Trade Intelligence" };

export default function FlippingPage() {
  return <OpportunitiesView variant="flip" />;
}
