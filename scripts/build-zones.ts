/**
 * Builds src/data/zones.json — zone id → display name — from ao-data/ao-bin-dumps cluster/world.xml.
 * The damage meter reads the zone id from the join reply ("3207") and shows this name for its runs.
 *
 * Usage: npm run zones
 * The download is cached in .cache/ao-bin-dumps (gitignored). Delete it to refresh.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseAttributes } from "../src/lib/avalon/parse";

const URL = "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/cluster/world.xml";
const CACHE_FILE = path.join(process.cwd(), ".cache", "ao-bin-dumps", "world.xml");
const OUT_FILE = path.join(process.cwd(), "src", "data", "zones.json");

async function worldXml(): Promise<string> {
  try {
    if ((await stat(CACHE_FILE)).size > 0) return readFile(CACHE_FILE, "utf8");
  } catch {
    // not cached yet
  }
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const text = await res.text();
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, text);
  return text;
}

async function main() {
  const xml = await worldXml();
  const zones: Record<string, string> = {};
  for (const m of xml.matchAll(/<cluster\b([^>]*?)\/?>/g)) {
    const a = parseAttributes(m[1]);
    if (a.id && a.displayname && a.enabled !== "false") zones[a.id] = a.displayname;
  }
  const count = Object.keys(zones).length;
  if (count === 0) throw new Error("No clusters found in world.xml");
  await writeFile(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), source: URL, zones }) + "\n");
  console.log(`${count} zones → ${path.relative(process.cwd(), OUT_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
