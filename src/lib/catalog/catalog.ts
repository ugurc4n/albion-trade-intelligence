import catalogJson from "@/data/catalog.json";
import { matchesItemQuery, type CatalogItem } from "./types";

type CatalogFile = { generatedAt: string; source: string; items: CatalogItem[] };

const catalog = catalogJson as CatalogFile;
const byId = new Map<string, CatalogItem>(catalog.items.map((item) => [item.id, item]));

export const CATALOG_GENERATED_AT = catalog.generatedAt;
export const CATALOG_SOURCE = catalog.source;

export function getCatalogItem(id: string): CatalogItem | undefined {
  return byId.get(id);
}

export function allCatalogItems(): readonly CatalogItem[] {
  return catalog.items;
}

/** Search across item id and names (English shown in the UI; Turkish names still match). */
export function searchCatalog(query: string, limit = 20): CatalogItem[] {
  if (query.trim().length < 2) return [];
  const results: CatalogItem[] = [];
  for (const item of catalog.items) {
    if (matchesItemQuery(item, query)) {
      results.push(item);
      if (results.length >= limit) break;
    }
  }
  return results;
}
