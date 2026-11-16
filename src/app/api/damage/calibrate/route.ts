import { calibrate } from "@/lib/damage/service";
import { damageErrorResponse } from "../errors";

export async function POST() {
  try {
    return Response.json(await calibrate());
  } catch (err) {
    return damageErrorResponse(err);
  }
}
