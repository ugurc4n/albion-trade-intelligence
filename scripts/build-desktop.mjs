/**
 * Cross-platform desktop build step (npm scripts run under cmd.exe on Windows, so no `VAR=1 cmd` syntax):
 * builds the Next standalone server with ATI_STANDALONE=1, then prepares it for packaging.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const run = (cmd, args, env = {}) => {
  // Only .cmd shims need a shell; through one, an unquoted "C:\Program Files\nodejs\node.exe" breaks.
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: cmd.endsWith(".cmd"), env: { ...process.env, ...env } });
  if (res.status !== 0) process.exit(res.status ?? 1);
};

run(path.join("node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next"), ["build"], {
  ATI_STANDALONE: "1",
  NEXT_TELEMETRY_DISABLED: "1",
});
run(process.execPath, [path.join("scripts", "prepare-standalone.mjs")]);
