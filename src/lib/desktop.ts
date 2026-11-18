/** Controls exposed by the desktop shell's preload script (electron/preload.js); absent in a normal browser. */
export type DesktopApi = {
  overlay: {
    toggle: () => void;
    close: () => void;
    setLocked: (locked: boolean) => void;
    isOpen: () => Promise<boolean>;
    onOpenChange: (callback: (open: boolean) => void) => () => void;
    onLockChange: (callback: (locked: boolean) => void) => () => void;
  };
  updates: {
    getState: () => Promise<UpdateState>;
    /** Asks the feed now; the result arrives through onStateChange. */
    check: () => Promise<UpdateState>;
    /** Closes the app, installs the downloaded version and starts it again. */
    install: () => void;
    /** Opens the release page of the version being installed. */
    openNotes: () => void;
    onStateChange: (callback: (state: UpdateState) => void) => () => void;
  };
};

/** Mirrors the state in electron/updater.js. `current` is the installed version. */
export type UpdateState = { current: string } & (
  | { phase: "unsupported" | "idle" | "checking" | "latest" }
  | { phase: "downloading"; version: string; percent: number }
  | { phase: "ready" | "installing"; version: string }
  | { phase: "error"; message: string }
);

export const OVERLAY_TOGGLE_KEYS = "Ctrl+Shift+O";
export const OVERLAY_LOCK_KEYS = "Ctrl+Shift+L";

export function desktopApi(): DesktopApi | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { atiDesktop?: DesktopApi }).atiDesktop ?? null;
}
