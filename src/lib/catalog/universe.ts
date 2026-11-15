import type { CatalogItem } from "./types";

/**
 * The set of items scanned for opportunities. Kept deliberately bounded so a full refresh stays
 * around ~45 batched price requests (the API allows 300 requests / 5 minutes).
 * Excluded: T1–T3 (low value), enchant 4 gear (thin markets), artefacts, vanity, furniture, farming.
 */
export function isInScanUniverse(item: CatalogItem): boolean {
  const { category, subcategory, tier, enchant } = item;
  if (tier < 4) return false;
  switch (category) {
    case "crafting":
      return subcategory === "resources" || subcategory === "refinedresources";
    case "bags":
    case "capes":
    case "weapons":
    case "armors":
    case "head":
    case "shoes":
    case "offhands":
      return enchant <= 3;
    case "consumables":
      return subcategory === "potions" || subcategory === "food";
    case "mounts":
      return subcategory === "basemounts";
    default:
      return false;
  }
}

export function buildScanUniverse(items: readonly CatalogItem[]): string[] {
  return items.filter(isInScanUniverse).map((i) => i.id);
}
