import { deleteSession, getSession } from "@/lib/damage/service";
import { damageErrorResponse } from "../../errors";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await getSession((await params).id);
    if (!session) return Response.json({ error: { kind: "not_found", message: "Oturum bulunamadı." } }, { status: 404 });
    return Response.json({ session });
  } catch (err) {
    return damageErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const ok = await deleteSession((await params).id);
    if (!ok) return Response.json({ error: { kind: "not_found", message: "Oturum bulunamadı." } }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return damageErrorResponse(err);
  }
}
