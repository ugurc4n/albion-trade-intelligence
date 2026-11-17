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
        // The damage service builds its data path from process.cwd() (used only in development), so the
        // tracer pulls in the whole project: sources, local .data and earlier dist-electron builds nested in
        // each other. Deep nesting pushed paths past Windows' 260-character limit and broke updates.
        outputFileTracingExcludes: {
          "/**": [
            "./dist-electron/**/*",
            "./.data/**/*",
            "./.claude/**/*",
            "./src/**/*",
            "./build/**/*",
            "./tools/**/*",
            "./scripts/**/*",
            "./tsconfig.json",
          ],
        },
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
