/**
 * Builds src/data/avalon.json — static Roads of Avalon zone layouts — from ao-data/ao-bin-dumps.
 *
 * Sources:
 *  - cluster/world.xml              : every zone (TNL-*) with display name, type, resource distribution, minimap markers
 *  - cluster/<file>.cluster.xml     : template instances placed in the zone and which layers are switched on
 *  - templates/NONE/<ref>.template.xml : layer contents (loot chest spawn points, dungeon entrance layers)
 *
 * Chest rarity (green/blue/gold) and the live portal connections between zones are decided at
 * runtime by the game server and are NOT in these files, so they are not produced here.
 *
 * Usage: npm run avalon
 * Downloads are cached in .cache/ao-bin-dumps/avalon (gitignored). Delete that folder to refresh.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildZone,
  countDungeonMarkers,
  parseClusterInstances,
  parseTemplateLayers,
  parseWorldRoads,
  type TemplateLayer,
} from "../src/lib/avalon/parse";
import type { AvalonDataFile, AvalonZone } from "../src/lib/avalon/types";

const BASE = "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master";
const CACHE_DIR = path.join(process.cwd(), ".cache", "ao-bin-dumps", "avalon");
const OUT_FILE = path.join(process.cwd(), "src", "data", "avalon.json");
const CONCURRENCY = 6;

async function download(file: string): Promise<string> {
  const target = path.join(CACHE_DIR, file.replace(/\//g, "_"));
  try {
    const s = await stat(target);
    if (s.size > 0) return readFile(target, "utf8");
  } catch {
    // not cached yet
  }
  const res = await fetch(`${BASE}/${file}`, { headers: { "Accept-Encoding": "gzip" } });
  if (!res.ok) throw new Error(`Download failed for ${file}: HTTP ${res.status}`);
  const text = await res.text();
  await writeFile(target, text);
  return text;
}

async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });

  console.log("Reading cluster/world.xml ...");
  const world = parseWorldRoads(await download("cluster/world.xml")).filter((c) => c.enabled);
  if (world.length === 0) throw new Error("No Roads of Avalon (TNL-*) clusters found in world.xml");

  const clusterFiles = [...new Set(world.map((c) => c.file))];
  console.log(`${world.length} zones, ${clusterFiles.length} unique layouts. Downloading cluster files ...`);
  const clusterXml = new Map(
    await mapLimited(clusterFiles, CONCURRENCY, async (f) => [f, await download(`cluster/${f}`)] as const),
  );
  const instancesByFile = new Map([...clusterXml].map(([f, xml]) => [f, parseClusterInstances(xml)] as const));

  const refs = [...new Set([...instancesByFile.values()].flat().map((i) => i.ref))];
  console.log(`${refs.length} templates. Downloading ...`);
  const templates = new Map<string, Map<string, TemplateLayer>>();
  await mapLimited(refs, CONCURRENCY, async (ref) => {
    try {
      templates.set(ref, parseTemplateLayers(await download(`templates/NONE/${ref}.template.xml`)));
    } catch (err) {
      console.warn(`  template ${ref}: ${(err as Error).message}`);
    }
  });

  const zones: AvalonZone[] = [];
  const unknownChests = new Set<string>();
  const missingTemplates = new Set<string>();
  let markerMismatches = 0;

  for (const w of world) {
    const result = buildZone(w, instancesByFile.get(w.file) ?? [], templates);
    result.unknownChests.forEach((c) => unknownChests.add(c));
    result.missingTemplates.forEach((t) => missingTemplates.add(t));
    const dungeonCount = result.zone.dungeons.reduce((s, d) => s + d.count, 0);
    if (dungeonCount !== countDungeonMarkers(w.body)) {
      markerMismatches++;
      console.warn(`  ${w.id} ${w.name}: ${dungeonCount} dungeon layers vs ${countDungeonMarkers(w.body)} minimap markers`);
    }
    zones.push(result.zone);
  }

  if (unknownChests.size) console.warn(`Unrecognised chest spawns: ${[...unknownChests].join(", ")}`);
  if (missingTemplates.size) console.warn(`Missing templates: ${[...missingTemplates].join(", ")}`);
  if (markerMismatches > world.length * 0.05) {
    throw new Error(`${markerMismatches} zones disagree with their minimap markers — the dump format may have changed.`);
  }

  zones.sort((a, b) => a.name.localeCompare(b.name));
  const out: AvalonDataFile = {
    generatedAt: new Date().toISOString(),
    source: `${BASE}/cluster/world.xml + cluster/*.cluster.xml + templates/NONE/*.template.xml`,
    zones,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(out));
  const chests = zones.reduce((s, z) => s + z.chests.reduce((a, c) => a + c.count, 0), 0);
  const dungeons = zones.reduce((s, z) => s + z.dungeons.reduce((a, d) => a + d.count, 0), 0);
  console.log(
    `Wrote ${zones.length} zones (${chests} chests, ${dungeons} dungeon entrances, ${markerMismatches} marker mismatches) to ${path.relative(process.cwd(), OUT_FILE)}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
