import type { Metadata } from "next";
import { Suspense } from "react";
import { PlayerDetailView } from "@/components/player-view";

export const metadata: Metadata = { title: "Player · Albion Trade Intelligence" };

export default function PlayerPage() {
  return (
    <Suspense>
      <PlayerDetailView />
    </Suspense>
  );
}
