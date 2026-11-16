import type { NextRequest } from "next/server";
import { z } from "zod";
import { SERVER_IDS, type ServerId } from "@/lib/albion/constants";
import { errorResponse } from "@/lib/api-errors";
import { searchPlayers } from "@/lib/killboard/service";

const querySchema = z.object({
  q: z.string().trim().min(2).max(40),
  server: z.enum(SERVER_IDS as [ServerId, ...ServerId[]]).catch("europe"),
});

export async function GET(request: NextRequest) {
  try {
    const { q, server } = querySchema.parse({
      q: request.nextUrl.searchParams.get("q") ?? "",
      server: request.nextUrl.searchParams.get("server"),
    });
    return Response.json({ players: await searchPlayers(server, q) });
  } catch (err) {
    return errorResponse(err);
  }
}
