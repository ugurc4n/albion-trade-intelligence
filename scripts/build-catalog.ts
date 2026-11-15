/**
 * Builds src/data/catalog.json from the ao-data/ao-bin-dumps repository.
 *
 * Sources:
 *  - formatted/items.json : UniqueName + LocalizedNames (EN-US, TR-TR, ...) — includes every enchant variant (e.g. T5_BAG@1)
 *  - items.json           : game item definitions (tier, shop category, weight, max quality, tradable flag)
 *
 * Usage: npm run catalog
 * Downloads are cached in .cache/ao-bin-dumps (gitignored). Delete that folder to force a fresh download.
 */
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const BASE = "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master";
const CACHE_DIR = path.join(process.cwd(), ".cache", "ao-bin-dumps");
const OUT_FILE = path.join(process.cwd(), "src", "data", "catalog.json");

type FormattedItem = {
  Index: string;
  UniqueName: string;
  LocalizedNames: Record<string, string> | null;
};

type RawItem = Record<string, unknown> & { "@uniquename": string };

async function download(file: string): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const target = path.join(CACHE_DIR, file.replace(/\//g, "_"));
  try {
    const s = await stat(target);
    if (s.size > 0) return readFile(target, "utf8");
  } catch {
    // not cached yet
  }
  console.log(`Downloading ${file} ...`);
  const res = await fetch(`${BASE}/${file}`, { headers: { "Accept-Encoding": "gzip" } });
  if (!res.ok) throw new Error(`Download failed for ${file}: HTTP ${res.status}`);
  const text = await res.text();
  await writeFile(target, text);
  return text;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function parseEnchant(id: string): number {
  const at = id.match(/@(\d)$/);
  if (at) return Number(at[1]);
  const level = id.match(/_LEVEL(\d)$/);
  if (level) return Number(level[1]);
  return 0;
}

function baseId(id: string): string {
  return id.replace(/@\d$/, "");
}

async function main() {
  const formatted = JSON.parse(await download("formatted/items.json")) as FormattedItem[];
  const rawRoot = JSON.parse(await download("items.json")) as { items: Record<string, unknown> };

  const rawById = new Map<string, RawItem>();
  for (const value of Object.values(rawRoot.items)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value as RawItem[]) {
      if (entry && typeof entry["@uniquename"] === "string") rawById.set(entry["@uniquename"], entry);
    }
  }

  const items: CatalogEntry[] = [];
  let skipped = 0;

  for (const f of formatted) {
    const id = f.UniqueName;
    if (!/^T\d_/.test(id)) {
      skipped++;
      continue;
    }
    const base = baseId(id);
    const raw = rawById.get(base) ?? rawById.get(base.replace(/_LEVEL\d$/, ""));
    if (!raw) {
      skipped++;
      continue;
    }
    const category = str(raw["@shopcategory"]);
    if (!category || category === "vanity" || category === "other") {
      skipped++;
      continue;
    }
    if (raw["@tradable"] === "false" || id.includes("NONTRADABLE")) {
      skipped++;
      continue;
    }

    const tier = Number(str(raw["@tier"]) ?? id.match(/^T(\d)/)?.[1] ?? 0);
    const nameEn = f.LocalizedNames?.["EN-US"] ?? id;
    const nameTr = f.LocalizedNames?.["TR-TR"] ?? nameEn;
    const maxQuality = Number(str(raw["@maxqualitylevel"]) ?? 1);

    const index = Number(f.Index);
    if (!Number.isSafeInteger(index) || index <= 0) throw new Error(`Invalid game item index for ${id}: ${f.Index}`);

    items.push({
      id,
      index,
      nameEn,
      nameTr,
      tier,
      enchant: parseEnchant(id),
      category,
      subcategory: str(raw["@shopsubcategory1"]) ?? "other",
      weight: Number(str(raw["@weight"]) ?? 0),
      maxQuality: Number.isFinite(maxQuality) && maxQuality >= 1 ? maxQuality : 1,
    });
  }

  items.sort((a, b) => a.id.localeCompare(b.id));

  const out = {
    generatedAt: new Date().toISOString(),
    source: `${BASE}/formatted/items.json + ${BASE}/items.json`,
    items,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(out));
  console.log(`Wrote ${items.length} items to ${path.relative(process.cwd(), OUT_FILE)} (skipped ${skipped}).`);
}

type CatalogEntry = {
  id: string;
  index: number;
  nameEn: string;
  nameTr: string;
  tier: number;
  enchant: number;
  category: string;
  subcategory: string;
  weight: number;
  maxQuality: number;
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
