import { calibrateBodySchema } from "@/lib/damage/api-schemas";
import { calibrate } from "@/lib/damage/service";
import { damageErrorResponse } from "../errors";

export async function POST(request: Request) {
  try {
    const { names } = calibrateBodySchema.parse(await request.json());
    return Response.json(await calibrate(names));
  } catch (err) {
    return damageErrorResponse(err);
  }
}
