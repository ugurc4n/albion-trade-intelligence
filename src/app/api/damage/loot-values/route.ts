import type { NextRequest } from "next/server";
import { z } from "zod";
import { isValidItemId } from "@/lib/albion/batching";
import { SERVER_IDS, type ServerId } from "@/lib/albion/constants";
import { getItemValues } from "@/lib/market/service";
import { damageErrorResponse } from "../errors";

const serverSchema = z.enum(SERVER_IDS as [ServerId, ...ServerId[]]).catch("europe");
const MAX_IDS = 300;

/**
 * Estimated unit value of looted items: the median of the Royal Cities' lowest Sell Orders of the last week,
 * at Normal quality (the loot message does not carry the Quality). null when there is no recent price.
 */
export async function GET(request: NextRequest) {
  // Read the request outside try/catch: under Cache Components this opts the handler out of prerendering.
  const params = request.nextUrl.searchParams;
  const server = serverSchema.parse(params.get("server"));
  const ids = [...new Set((params.get("ids") ?? "").split(",").filter(isValidItemId))].slice(0, MAX_IDS);
  try {
    if (ids.length === 0) return Response.json({ server, values: {} });
    const value = await getItemValues(server, ids);
    return Response.json({ server, values: Object.fromEntries(ids.map((id) => [id, value(id, 1)])) });
  } catch (err) {
    return damageErrorResponse(err);
  }
}
