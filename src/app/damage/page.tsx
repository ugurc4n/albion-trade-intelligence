import type { Metadata } from "next";
import { DamageView } from "@/components/damage-view";

export const metadata: Metadata = { title: "Damage Meter · Albion Trade Intelligence" };

export default function DamagePage() {
  return <DamageView />;
}
