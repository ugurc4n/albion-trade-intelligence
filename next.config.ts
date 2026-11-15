import type { NextConfig } from "next";

// Desktop (Electron) builds set ATI_STANDALONE=1: Next emits a self-contained server under
// <distDir>/standalone that the app runs locally. A separate distDir keeps that build from touching the
// .next folder of a running `next dev`.
const desktop = process.env.ATI_STANDALONE === "1";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  ...(desktop
    ? {
        output: "standalone" as const,
        distDir: ".next-electron",
        // Trace from this folder only (stray lockfiles higher up must not move the standalone root).
        outputFileTracingRoot: process.cwd(),
      }
    : {}),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
