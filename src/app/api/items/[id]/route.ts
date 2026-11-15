import type { NextRequest } from "next/server";
import { z } from "zod";
import { isValidItemId } from "@/lib/albion/batching";
import { SERVER_IDS, type ServerId } from "@/lib/albion/constants";
import { errorResponse } from "@/lib/api-errors";
import { getCatalogItem } from "@/lib/catalog/catalog";
import { getItemDetail, isInUniverse } from "@/lib/market/service";

const serverSchema = z.enum(SERVER_IDS as [ServerId, ...ServerId[]]).catch("europe");

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: raw } = await ctx.params;
    const id = decodeURIComponent(raw);
    const server = serverSchema.parse(request.nextUrl.searchParams.get("server"));
    if (!isValidItemId(id)) {
      return Response.json({ error: { kind: "bad_request", message: "Geçersiz item id." } }, { status: 400 });
    }
    const item = getCatalogItem(id);
    if (!item) {
      return Response.json({ error: { kind: "not_found", message: "Ürün katalogda bulunamadı." } }, { status: 404 });
    }
    const detail = await getItemDetail(server, id);
    return Response.json({ item, server, inScanUniverse: isInUniverse(id), ...detail });
  } catch (err) {
    return errorResponse(err);
  }
}
