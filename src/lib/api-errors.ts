import { ZodError } from "zod";
import { AlbionApiError } from "@/lib/albion/client";

export type ApiErrorBody = { error: { kind: string; message: string; retryAt?: number } };

/** Maps internal errors to a JSON response with a user-facing Turkish message. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    return Response.json(
      { error: { kind: "bad_request", message: "Geçersiz istek parametreleri.", issues: err.issues.slice(0, 5) } },
      { status: 400 },
    );
  }
  if (err instanceof AlbionApiError) {
    const status = err.kind === "rate_limited" ? 503 : err.kind === "timeout" ? 504 : 502;
    return Response.json(
      { error: { kind: err.kind, message: err.message, retryAt: err.retryAt } } satisfies ApiErrorBody,
      { status },
    );
  }
  console.error("[api] unexpected error", err);
  return Response.json(
    { error: { kind: "internal", message: "Beklenmeyen bir sunucu hatası oluştu." } } satisfies ApiErrorBody,
    { status: 500 },
  );
}
