import type { NextRequest } from "next/server";
import { getDamageState } from "@/lib/damage/service";
import { damageErrorResponse } from "../errors";

export async function GET(request: NextRequest) {
  // Read the request outside try/catch so the dynamic opt-out is never swallowed; the port is used to print the ingest URL.
  void request.nextUrl.searchParams;
  const port = request.nextUrl.port || null;
  try {
    return Response.json(await getDamageState(port));
  } catch (err) {
    return damageErrorResponse(err);
  }
}
