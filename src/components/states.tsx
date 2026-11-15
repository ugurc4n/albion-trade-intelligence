"use client";

import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientApiError } from "@/lib/api-client";

export function TableSkeleton({ rows = 8, note }: { rows?: number; note?: string }) {
  return (
    <div className="space-y-1.5 p-3" aria-busy="true">
      {note && <p className="pb-2 text-xs text-muted-foreground">{note}</p>}
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Inbox className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-md text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

function useCountdown(target?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  return target ? Math.max(0, Math.ceil((target - now) / 1000)) : null;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const apiErr = error instanceof ClientApiError ? error : null;
  const seconds = useCountdown(apiErr?.retryAt);
  const message = error instanceof Error ? error.message : "Bilinmeyen hata";
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center" role="alert">
      <AlertTriangle className="size-6 text-loss" aria-hidden />
      <p className="text-sm font-medium">Piyasa verisi alınamadı</p>
      <p className="max-w-md text-xs text-muted-foreground">{message}</p>
      {apiErr?.kind === "rate_limited" && seconds !== null && (
        <p className="num text-xs text-warn">
          {seconds > 0 ? `API limiti: ${seconds} sn sonra tekrar denenebilir.` : "Tekrar denenebilir."}
        </p>
      )}
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} disabled={!!seconds} className="mt-1">
          <RefreshCw /> Tekrar dene
        </Button>
      )}
    </div>
  );
}
