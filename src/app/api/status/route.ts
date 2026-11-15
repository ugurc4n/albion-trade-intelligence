import type { NextRequest } from "next/server";
import { CATALOG_GENERATED_AT } from "@/lib/catalog/catalog";
import { getServiceStatus } from "@/lib/market/service";

export async function GET(request: NextRequest) {
  // Reading the request keeps this handler dynamic (Cache Components would otherwise prerender it).
  void request.nextUrl.searchParams;
  return Response.json({ ...getServiceStatus(), catalogGeneratedAt: CATALOG_GENERATED_AT, now: Date.now() });
}
