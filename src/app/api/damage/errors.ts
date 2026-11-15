import { errorResponse } from "@/lib/api-errors";
import { DamageStateError } from "@/lib/damage/service";

/** Invalid state transitions (e.g. stopping a session that is not running) are 409s with a Turkish message. */
export function damageErrorResponse(err: unknown): Response {
  if (err instanceof DamageStateError) {
    return Response.json({ error: { kind: "conflict", message: err.message } }, { status: 409 });
  }
  return errorResponse(err);
}
