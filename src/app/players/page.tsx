import type { Metadata } from "next";
import { PlayerSearchView } from "@/components/player-view";

export const metadata: Metadata = { title: "Player Lookup · Albion Trade Intelligence" };

export default function PlayersPage() {
  return <PlayerSearchView />;
}
