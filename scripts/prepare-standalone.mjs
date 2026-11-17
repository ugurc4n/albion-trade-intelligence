/**
 * Makes the Next standalone output (from `ATI_STANDALONE=1 next build`) ready to ship inside the desktop app:
 *  1. copies .next-electron/static and public/ next to server.js (the standalone server serves them from there),
 *  2. replaces every symlink/junction with a real copy — on Windows, Next may create junctions with absolute
 *     paths of the build machine, which would break on any other PC,
 *  3. checks that server.js and the `next` package are present.
 */
import { cpSync, existsSync, lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, ".next-electron");
const standalone = path.join(distDir, "standalone");

if (!existsSync(path.join(standalone, "server.js"))) {
  console.error(`No standalone server found at ${standalone}. Run "ATI_STANDALONE=1 next build" first.`);
  process.exit(1);
}

cpSync(path.join(distDir, "static"), path.join(standalone, ".next-electron", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });

let replaced = 0;
function dereference(dir) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      const target = realpathSync(p);
      rmSync(p, { recursive: true, force: true });
      cpSync(target, p, { recursive: true, dereference: true });
      replaced++;
    } else if (st.isDirectory()) {
      dereference(p);
    }
  }
}
dereference(standalone);

for (const required of ["server.js", path.join("node_modules", "next", "package.json")]) {
  if (!existsSync(path.join(standalone, required))) {
    console.error(`Standalone output is missing ${required}.`);
    process.exit(1);
  }
}
// Project folders must never ship: local data is private, and nested builds exceed Windows' path limit.
for (const forbidden of ["dist-electron", ".data", ".claude", "src", "tools", "scripts", "electron"]) {
  if (existsSync(path.join(standalone, forbidden))) {
    console.error(`Standalone output must not contain ${forbidden}/ (check outputFileTracingExcludes in next.config.ts).`);
    process.exit(1);
  }
}
console.log(`Standalone server ready at ${path.relative(root, standalone)} (${replaced} symlink(s) replaced by copies).`);
