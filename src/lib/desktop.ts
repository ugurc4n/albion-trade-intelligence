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
};

export const OVERLAY_TOGGLE_KEYS = "Ctrl+Shift+O";
export const OVERLAY_LOCK_KEYS = "Ctrl+Shift+L";

export function desktopApi(): DesktopApi | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { atiDesktop?: DesktopApi }).atiDesktop ?? null;
}
