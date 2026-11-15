import type { NextRequest } from "next/server";
import { searchCatalog } from "@/lib/catalog/catalog";

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 60);
  const items = searchCatalog(q, 15).map(({ id, nameTr, nameEn, tier, enchant, category }) => ({
    id,
    nameTr,
    nameEn,
    tier,
    enchant,
    category,
  }));
  return Response.json({ items });
}
