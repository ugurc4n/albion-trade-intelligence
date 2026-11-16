import { Compass, LayoutDashboard, Repeat, Route, Settings2, Swords, Wallet, type LucideIcon } from "lucide-react";
import type { Tone } from "./tone";

export type SectionKey = "dashboard" | "flipping" | "trade" | "optimizer" | "avalon" | "damage" | "settings" | "item";

export const SECTIONS: Record<SectionKey, { href: string; label: string; icon: LucideIcon; tone: Tone }> = {
  dashboard: { href: "/", label: "Dashboard", icon: LayoutDashboard, tone: "violet" },
  flipping: { href: "/flipping", label: "Market Flipping", icon: Repeat, tone: "cyan" },
  trade: { href: "/trade", label: "Cross-City Trade", icon: Route, tone: "sky" },
  optimizer: { href: "/optimizer", label: "Budget Optimizer", icon: Wallet, tone: "amber" },
  avalon: { href: "/avalon", label: "Roads of Avalon", icon: Compass, tone: "emerald" },
  damage: { href: "/damage", label: "Damage Meter", icon: Swords, tone: "fuchsia" },
  settings: { href: "/settings", label: "Settings", icon: Settings2, tone: "slate" },
  item: { href: "/item", label: "Item", icon: Repeat, tone: "cyan" },
};

export const NAV_SECTIONS: SectionKey[] = ["dashboard", "flipping", "trade", "optimizer", "avalon", "damage", "settings"];
