"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsProvider } from "@/hooks/use-settings";
import { ClientApiError } from "@/lib/api-client";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            // Never hammer the API after rate limiting or bad requests; one retry for transient errors.
            retry: (count, err) => {
              if (err instanceof ClientApiError && (err.kind === "rate_limited" || err.status < 500)) return false;
              return count < 1;
            },
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <SettingsProvider>
        <TooltipProvider delay={150}>{children}</TooltipProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
