import type { NextRequest } from "next/server";
import { z } from "zod";
import { SERVER_IDS, type ServerId } from "@/lib/albion/constants";
import { errorResponse } from "@/lib/api-errors";
import { getPlayer, isValidPlayerId } from "@/lib/killboard/service";

const serverSchema = z.enum(SERVER_IDS as [ServerId, ...ServerId[]]).catch("europe");

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isValidPlayerId(id)) {
      return Response.json({ error: { kind: "bad_request", message: "Invalid player id." } }, { status: 400 });
    }
    const server = serverSchema.parse(request.nextUrl.searchParams.get("server"));
    return Response.json(await getPlayer(server, id));
  } catch (err) {
    return errorResponse(err);
  }
}
