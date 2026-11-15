import type { NextRequest } from "next/server";
import { listSessions } from "@/lib/damage/service";
import { damageErrorResponse } from "../errors";

export async function GET(request: NextRequest) {
  // Read the request outside try/catch: under Cache Components this is how the handler opts out of
  // prerendering, and that signal must not be swallowed by our error handler.
  void request.nextUrl.searchParams;
  try {
    return Response.json({ sessions: await listSessions() });
  } catch (err) {
    return damageErrorResponse(err);
  }
}
