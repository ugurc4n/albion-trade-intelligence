import { errorResponse } from "@/lib/api-errors";
import { runOpportunities } from "@/lib/opportunities";
import { opportunitiesRequestSchema } from "@/lib/settings/schema";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const parsed = opportunitiesRequestSchema.parse(body);
    const result = await runOpportunities(parsed);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
