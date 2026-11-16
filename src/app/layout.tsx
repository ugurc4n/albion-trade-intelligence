import type { Metadata } from "next";
import { Barlow, Chakra_Petch, IBM_Plex_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { Providers } from "./providers";
import "./globals.css";

// Body text: Barlow (plain, slightly narrow). Headings and big figures: Chakra Petch (angular, game-HUD feel).
// Prices and tables: IBM Plex Mono with tabular figures. All self-hosted by next/font, so the app works offline.
const body = Barlow({ variable: "--ff-body", weight: ["400", "500", "600"], subsets: ["latin", "latin-ext"] });
const display = Chakra_Petch({ variable: "--ff-display", weight: ["500", "600", "700"], subsets: ["latin", "latin-ext"] });
const numeric = IBM_Plex_Mono({ variable: "--ff-num", weight: ["400", "500"], subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "Albion Trade Intelligence",
  description: "Market flipping and cross-city trade decisions for Albion Online, backed by live market data.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${body.variable} ${display.variable} ${numeric.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
