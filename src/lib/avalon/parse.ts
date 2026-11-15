/**
 * Pure parsers for the ao-bin-dumps world/cluster/template XML files (no fs, no network).
 * The files are machine-generated with a stable shape, so targeted regexes are enough here.
 */
import type { AvalonChest, AvalonDungeon, AvalonResource, AvalonZone, ChestGrade, ChestSize, DungeonKind } from "./types";

export type WorldCluster = {
  id: string;
  file: string;
  name: string;
  type: string;
  enabled: boolean;
  /** Inner XML of the <cluster> element ("" when self-closing). */
  body: string;
};

export type TemplateLayer = { name: string; chests: string[] };
export type ClusterInstance = { ref: string; activeLayers: string[] };

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[m[1]] = decodeEntities(m[2]);
  return attrs;
}

/** Roads of Avalon clusters (id TNL-*) from the <clusters> section of cluster/world.xml. */
export function parseWorldRoads(worldXml: string): WorldCluster[] {
  const start = worldXml.indexOf("<clusters>");
  const end = worldXml.indexOf("</clusters>", start);
  if (start < 0 || end < 0) throw new Error("world.xml: <clusters> section not found");
  const section = worldXml.slice(start, end);

  const out: WorldCluster[] = [];
  const tagRe = /<cluster\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(section))) {
    const attrs = parseAttributes(m[1]);
    let body = "";
    if (m[2] !== "/") {
      const close = section.indexOf("</cluster>", tagRe.lastIndex);
      if (close < 0) break;
      body = section.slice(tagRe.lastIndex, close);
      tagRe.lastIndex = close + "</cluster>".length;
    }
    if (!attrs.id?.startsWith("TNL-") || !attrs.file || !attrs.displayname) continue;
    out.push({
      id: attrs.id,
      file: attrs.file,
      name: attrs.displayname,
      type: attrs.type ?? "",
      enabled: attrs.enabled !== "false",
      body,
    });
  }
  return out;
}

/** Zone tier from the cluster file name, e.g. TNL-001_RDS_RO_AUTO_T4_AVA_AVA.cluster.xml → 4. */
export function tierFromClusterFile(file: string): number | null {
  const m = file.match(/_T(\d)_/);
  return m ? Number(m[1]) : null;
}

/** Template instances placed in a cluster file and the layers switched on for each. */
export function parseClusterInstances(clusterXml: string): ClusterInstance[] {
  const out: ClusterInstance[] = [];
  const re = /<templateinstance\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clusterXml))) {
    const ref = parseAttributes(m[1]).ref;
    let inner = "";
    if (m[2] !== "/") {
      const close = clusterXml.indexOf("</templateinstance>", re.lastIndex);
      if (close < 0) break;
      inner = clusterXml.slice(re.lastIndex, close);
      re.lastIndex = close;
    }
    if (!ref) continue;
    out.push({ ref, activeLayers: [...inner.matchAll(/<activelayer id="([^"]+)"/g)].map((a) => a[1]) });
  }
  return out;
}

/** Layer id → layer name and the loot chest spawn points it contains. */
export function parseTemplateLayers(templateXml: string): Map<string, TemplateLayer> {
  const layers = new Map<string, TemplateLayer>();
  for (const m of templateXml.matchAll(/<layer\b([^>]*?)(?:\/>|>([\s\S]*?)<\/layer>)/g)) {
    const attrs = parseAttributes(m[1]);
    if (!attrs.id) continue;
    const body = m[2] ?? "";
    layers.set(attrs.id, {
      name: (attrs.name ?? "").trim(),
      chests: [...body.matchAll(/name="SpawnPoint_(LOOTCHEST_[A-Z0-9_]+)"/g)].map((c) => c[1]),
    });
  }
  return layers;
}

/** LOOTCHEST_SMALL_AVALON_ROAD_T6 / LOOTCHEST_MEDIUM_AVALON_ROAD_VETERAN_T8 / ..._ELITE_T6 */
export function classifyChest(spawn: string): { size: ChestSize; grade: ChestGrade; tier: number } | null {
  const m = spawn.match(/^LOOTCHEST_(SMALL|MEDIUM|LARGE)_AVALON_ROAD_(?:(VETERAN|ELITE)_)?T(\d)$/);
  if (!m) return null;
  return {
    size: m[1].toLowerCase() as ChestSize,
    grade: (m[2]?.toLowerCase() ?? "standard") as ChestGrade,
    tier: Number(m[3]),
  };
}

/** DNG_Solo_T6_KPR / DNG_Group_T4_HER / DNG_Raid_T8_AVA */
export function classifyDungeonLayer(layerName: string): { kind: DungeonKind; tier: number; faction: string } | null {
  const m = layerName.trim().match(/^DNG_(Solo|Group|Raid)_T(\d)_([A-Z]+)$/);
  if (!m) return null;
  const kind: DungeonKind = m[1] === "Solo" ? "solo" : m[1] === "Group" ? "group" : "avalonian";
  return { kind, tier: Number(m[2]), faction: m[3] };
}

/** Resource distribution of a world cluster; tiers below 4 are editor placeholders and dropped. */
export function parseResources(clusterBody: string): AvalonResource[] {
  const out: AvalonResource[] = [];
  for (const m of clusterBody.matchAll(/<resource name="(\w+)" tier="(\d+)" count="(\d+)"/g)) {
    const tier = Number(m[2]);
    if (tier < 4) continue;
    out.push({ type: m[1], tier, count: Number(m[3]) });
  }
  return out.sort((a, b) => a.type.localeCompare(b.type) || a.tier - b.tier);
}

/** Minimap dungeon markers — an independent count used to cross-check the layer-derived dungeons. */
export function countDungeonMarkers(clusterBody: string): number {
  return [...clusterBody.matchAll(/<marker type="dungeon_\w+"/g)].length;
}

export type ZoneBuildResult = { zone: AvalonZone; unknownChests: string[]; missingTemplates: string[] };

export function buildZone(
  world: WorldCluster,
  instances: ClusterInstance[],
  templates: ReadonlyMap<string, ReadonlyMap<string, TemplateLayer>>,
): ZoneBuildResult {
  const chests = new Map<string, AvalonChest>();
  const dungeons = new Map<string, AvalonDungeon>();
  const unknownChests: string[] = [];
  const missingTemplates: string[] = [];

  for (const inst of instances) {
    const layers = templates.get(inst.ref);
    if (!layers) {
      missingTemplates.push(inst.ref);
      continue;
    }
    for (const layerId of inst.activeLayers) {
      const layer = layers.get(layerId);
      if (!layer) continue;
      for (const spawn of layer.chests) {
        const c = classifyChest(spawn);
        if (!c) {
          unknownChests.push(spawn);
          continue;
        }
        const key = `${c.size}|${c.grade}|${c.tier}`;
        const prev = chests.get(key);
        chests.set(key, { ...c, count: (prev?.count ?? 0) + 1 });
      }
      const d = classifyDungeonLayer(layer.name);
      if (d) {
        const key = `${d.kind}|${d.tier}|${d.faction}`;
        const prev = dungeons.get(key);
        dungeons.set(key, { ...d, count: (prev?.count ?? 0) + 1 });
      }
    }
  }

  const sizeOrder: Record<ChestSize, number> = { large: 0, medium: 1, small: 2 };
  const gradeOrder: Record<ChestGrade, number> = { elite: 0, veteran: 1, standard: 2 };
  const kindOrder: Record<DungeonKind, number> = { avalonian: 0, group: 1, solo: 2 };

  return {
    zone: {
      id: world.id,
      name: world.name,
      type: world.type,
      tier: tierFromClusterFile(world.file) ?? 0,
      chests: [...chests.values()].sort((a, b) => sizeOrder[a.size] - sizeOrder[b.size] || gradeOrder[a.grade] - gradeOrder[b.grade] || b.tier - a.tier),
      dungeons: [...dungeons.values()].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.tier - a.tier),
      resources: parseResources(world.body),
    },
    unknownChests,
    missingTemplates,
  };
}
