import { ingestBodySchema } from "@/lib/damage/api-schemas";
import { ingestPackets } from "@/lib/damage/service";
import { damageErrorResponse } from "../errors";

/** Receives raw UDP payloads from tools/albion-capture (the Windows capture program). */
export async function POST(request: Request) {
  try {
    const body = ingestBodySchema.parse(await request.json());
    return Response.json(await ingestPackets(body.packets));
  } catch (err) {
    return damageErrorResponse(err);
  }
}
