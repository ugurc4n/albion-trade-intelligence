"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { ItemSearch } from "@/components/item-search";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/use-settings";
import { SERVERS } from "@/lib/albion/constants";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS, SECTIONS } from "./sections";
import { TONES } from "./tone";

function Brand({ markOnly }: { markOnly?: boolean }) {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5 px-1" aria-label="Albion Trade Intelligence — Dashboard">
      <span className="chamfer grid size-8 place-items-center bg-violet-500 font-display text-[13px] font-bold tracking-wide text-white">
        AT
      </span>
      <span className={cn("leading-tight whitespace-nowrap", markOnly && "hidden sm:block")}>
        <span className="block font-display text-[14px] font-semibold tracking-wide">ALBION TRADE</span>
        <span className="block text-[11px] tracking-[0.2em] text-violet-300/80">INTELLIGENCE</span>
      </span>
    </Link>
  );
}

/** usePathname is request data under Cache Components, so the active-state nav streams in behind Suspense. */
function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavList pathname={null} onNavigate={onNavigate} />}>
      <ActiveNavList onNavigate={onNavigate} />
    </Suspense>
  );
}

function ActiveNavList({ onNavigate }: { onNavigate?: () => void }) {
  return <NavList pathname={usePathname()} onNavigate={onNavigate} />;
}

function NavList({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Main menu">
      {NAV_SECTIONS.map((key) => {
        const { href, label, icon: Icon, tone } = SECTIONS[key];
        const t = TONES[tone];
        const active = pathname !== null && (href === "/" ? pathname === "/" : pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
              active ? cn(t.soft, "text-foreground ring-1", t.ring) : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "chamfer grid size-7 place-items-center transition-colors",
                active ? t.solid : cn(t.soft, t.text, "group-hover:brightness-125"),
              )}
            >
              <Icon className="size-4" />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function ProfileSummary() {
  const { settings } = useSettings();
  return (
    <Link href="/settings" className="block rounded-md border border-sidebar-border bg-white/[0.03] p-2.5 text-xs hover:bg-white/[0.06]">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-muted-foreground">Profile</span>
        <span className={cn("text-[11px]", settings.premium ? "text-amber-300" : "text-muted-foreground")}>
          {settings.premium ? "Premium" : "No Premium"}
        </span>
      </div>
      <dl className="space-y-0.5">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Server</dt>
          <dd>{SERVERS[settings.server].label}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Home city</dt>
          <dd>{settings.homeCity}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Budget</dt>
          <dd className="num">
            {formatCompact(settings.tradeBudget)} / {formatCompact(settings.totalSilver)}
          </dd>
        </div>
      </dl>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3 py-4 lg:flex">
        <Brand />
        <NavLinks />
        <div className="mt-auto space-y-2">
          <ProfileSummary />
          <p className="px-1 text-[10px] leading-snug text-muted-foreground/70">
            Data comes from the Albion Online Data Project (player clients). This is a decision aid; profit is not guaranteed.
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/70 px-3 backdrop-blur-md lg:px-4">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <div className="lg:hidden">
            <Brand markOnly />
          </div>
          <div className="ml-auto flex w-full max-w-sm justify-end">
            <ItemSearch />
          </div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-4">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="flex h-full flex-col gap-5">
            <Brand />
            <NavLinks onNavigate={() => setMenuOpen(false)} />
            <div className="mt-auto">
              <ProfileSummary />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
