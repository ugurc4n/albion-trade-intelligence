export type CatalogItem = {
  id: string;
  nameEn: string;
  nameTr: string;
  tier: number;
  enchant: number;
  category: string;
  subcategory: string;
  weight: number;
  maxQuality: number;
};

export const CATEGORY_LABELS: Record<string, string> = {
  crafting: "Kaynaklar",
  weapons: "Silahlar",
  armors: "Zırhlar",
  head: "Başlıklar",
  shoes: "Ayakkabılar",
  offhands: "Yan Eller",
  capes: "Pelerinler",
  bags: "Çantalar",
  consumables: "Tüketilebilir",
  mounts: "Binekler",
  artefacts: "Artefaktlar",
  gathering: "Toplama Ekipmanı",
  farming: "Çiftçilik",
  furniture: "Mobilya",
};

/**
 * Case-insensitive match on id, English and Turkish names. English text is lowercased with the
 * default locale (the Turkish locale would turn "I" into "ı" and break queries like "imbuer").
 */
export function matchesItemQuery(item: Pick<CatalogItem, "id" | "nameEn" | "nameTr">, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const en = q.toLowerCase();
  if (item.id.toLowerCase().includes(en) || item.nameEn.toLowerCase().includes(en)) return true;
  return item.nameTr.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr"));
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}
