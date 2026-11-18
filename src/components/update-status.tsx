"use client";

import { Download, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { desktopApi, type UpdateState } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/** Desktop app only: the installed version and the state of automatic updates (electron/updater.js). */
function useUpdateState() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const updates = desktopApi()?.updates;
    if (!updates) return;
    void updates.getState().then(setState);
    return updates.onStateChange(setState);
  }, []);
  return state;
}

/** Sidebar block: "Restart to update" once a new version is downloaded, otherwise a quiet version line. */
export function UpdateStatus() {
  const state = useUpdateState();
  if (!state) return null;
  const updates = desktopApi()?.updates;

  if (state.phase === "ready" || state.phase === "installing") {
    const installing = state.phase === "installing";
    return (
      <div className="space-y-2 rounded-md border border-violet-400/40 bg-violet-500/10 p-2.5 text-xs">
        <div className="flex items-center gap-2">
          <Download className="size-3.5 text-violet-300" />
          <span className="font-medium">Version {state.version} is ready</span>
        </div>
        <Button size="sm" className="w-full" disabled={installing} onClick={() => updates?.install()}>
          {installing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {installing ? "Installing…" : "Restart to update"}
        </Button>
        <p className="leading-snug text-muted-foreground">
          Otherwise it installs when you close the app.{" "}
          <button type="button" className="text-violet-300 underline-offset-2 hover:underline" onClick={() => updates?.openNotes()}>
            What&apos;s new
          </button>
        </p>
      </div>
    );
  }

  const canCheck = state.phase === "idle" || state.phase === "latest" || state.phase === "error";
  return (
    <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
      <span className="num shrink-0 whitespace-nowrap">v{state.current}</span>
      <span
        className={cn("ml-auto min-w-0 truncate text-right", state.phase === "error" && "text-amber-300")}
        title={state.phase === "error" ? state.message : undefined}
      >
        {state.phase === "checking" && "Checking for updates…"}
        {state.phase === "downloading" && `Downloading v${state.version} · ${state.percent}%`}
        {state.phase === "latest" && "Up to date"}
        {state.phase === "error" && "Update check failed"}
      </span>
      {canCheck && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => void updates?.check()}
          aria-label="Check for updates"
          title="Check for updates"
        >
          <RefreshCw />
        </Button>
      )}
    </div>
  );
}
