/**
 * Section colours for the "Avalon Gecesi" theme. Every section of the app has one tone; class names are
 * spelled out in full so Tailwind can see them.
 */
export type Tone = "violet" | "cyan" | "sky" | "amber" | "emerald" | "fuchsia" | "rose" | "orange" | "slate";

export const TONES: Record<Tone, { text: string; soft: string; solid: string; ring: string; border: string; bar: string }> = {
  violet: {
    text: "text-violet-300",
    soft: "bg-violet-500/15",
    solid: "bg-violet-500 text-white",
    ring: "ring-violet-400/25",
    border: "border-violet-400/35",
    bar: "bg-violet-400",
  },
  cyan: {
    text: "text-cyan-300",
    soft: "bg-cyan-400/12",
    solid: "bg-cyan-400 text-cyan-950",
    ring: "ring-cyan-300/25",
    border: "border-cyan-300/35",
    bar: "bg-cyan-300",
  },
  sky: {
    text: "text-sky-300",
    soft: "bg-sky-400/12",
    solid: "bg-sky-400 text-sky-950",
    ring: "ring-sky-300/25",
    border: "border-sky-300/35",
    bar: "bg-sky-300",
  },
  amber: {
    text: "text-amber-300",
    soft: "bg-amber-400/12",
    solid: "bg-amber-400 text-amber-950",
    ring: "ring-amber-300/25",
    border: "border-amber-300/35",
    bar: "bg-amber-300",
  },
  emerald: {
    text: "text-emerald-300",
    soft: "bg-emerald-400/12",
    solid: "bg-emerald-400 text-emerald-950",
    ring: "ring-emerald-300/25",
    border: "border-emerald-300/35",
    bar: "bg-emerald-300",
  },
  fuchsia: {
    text: "text-fuchsia-300",
    soft: "bg-fuchsia-500/14",
    solid: "bg-fuchsia-500 text-white",
    ring: "ring-fuchsia-400/25",
    border: "border-fuchsia-400/35",
    bar: "bg-fuchsia-400",
  },
  rose: {
    text: "text-rose-300",
    soft: "bg-rose-500/14",
    solid: "bg-rose-500 text-white",
    ring: "ring-rose-400/25",
    border: "border-rose-400/35",
    bar: "bg-rose-400",
  },
  orange: {
    text: "text-orange-300",
    soft: "bg-orange-500/14",
    solid: "bg-orange-500 text-white",
    ring: "ring-orange-400/25",
    border: "border-orange-400/35",
    bar: "bg-orange-400",
  },
  slate: {
    text: "text-slate-300",
    soft: "bg-slate-400/12",
    solid: "bg-slate-400 text-slate-950",
    ring: "ring-slate-300/20",
    border: "border-slate-300/30",
    bar: "bg-slate-300",
  },
};

/** Default order for colourful KPI tiles. */
export const TONE_CYCLE: Tone[] = ["violet", "cyan", "fuchsia", "emerald", "amber", "sky"];
