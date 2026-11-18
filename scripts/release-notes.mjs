/**
 * Writes build/release-notes.md for electron-builder (see releaseInfo in electron-builder.yml): one line per
 * commit since the previous release tag. It becomes the GitHub Release text and the notes in latest.yml, which
 * the app links to when an update is ready. "Release x.y.z" version-bump commits and merges are left out.
 *
 * Runs before every package (`npm run dist:win`, `npm run release:win`), because electron-builder refuses to
 * build when the configured notes file is missing.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const out = path.join("build", "release-notes.md");

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function changes() {
  try {
    // The newest v* tag reachable from HEAD that is not this version itself (on a tag build HEAD carries it).
    const previous = git("tag", "--merged", "HEAD", "--list", "v*", "--sort=-v:refname")
      .split("\n")
      .map((t) => t.trim())
      .find((t) => t && t !== `v${version}`);
    const range = previous ? `${previous}..HEAD` : "HEAD";
    return git("log", range, "--no-merges", "--pretty=format:%s")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s && !/^Release \d+\.\d+\.\d+/.test(s));
  } catch {
    return []; // no git or no history (e.g. a shallow checkout): ship without a change list
  }
}

const lines = changes();
const body = lines.length ? lines.map((s) => `- ${s}`).join("\n") : "- Fixes and improvements.";
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `## What's new in ${version}\n\n${body}\n`);
console.log(`Release notes for ${version}: ${lines.length} change(s) -> ${out}`);
