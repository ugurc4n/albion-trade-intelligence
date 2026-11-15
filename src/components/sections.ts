import { Compass, LayoutDashboard, Repeat, Route, Settings2, Swords, Wallet, type LucideIcon } from "lucide-react";
import type { Tone } from "./tone";

export type SectionKey = "dashboard" | "flipping" | "trade" | "optimizer" | "avalon" | "damage" | "settings" | "item";

export const SECTIONS: Record<SectionKey, { href: string; label: string; icon: LucideIcon; tone: Tone }> = {
  dashboard: { href: "/", label: "Panel", icon: LayoutDashboard, tone: "violet" },
  flipping: { href: "/flipping", label: "Market Flipping", icon: Repeat, tone: "cyan" },
  trade: { href: "/trade", label: "Şehirler Arası", icon: Route, tone: "sky" },
  optimizer: { href: "/optimizer", label: "Bütçe Optimizer", icon: Wallet, tone: "amber" },
  avalon: { href: "/avalon", label: "Avalon Yolları", icon: Compass, tone: "emerald" },
  damage: { href: "/damage", label: "Damage Meter", icon: Swords, tone: "fuchsia" },
  settings: { href: "/settings", label: "Ayarlar", icon: Settings2, tone: "slate" },
  item: { href: "/item", label: "Ürün", icon: Repeat, tone: "cyan" },
};

export const NAV_SECTIONS: SectionKey[] = ["dashboard", "flipping", "trade", "optimizer", "avalon", "damage", "settings"];
