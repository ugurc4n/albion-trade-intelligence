import { controlBodySchema } from "@/lib/damage/api-schemas";
import { saveConfig, saveSettings, startRecording, startSession, stopRecording, stopSession } from "@/lib/damage/service";
import { damageErrorResponse } from "../errors";

export async function POST(request: Request) {
  try {
    const body = controlBodySchema.parse(await request.json());
    switch (body.action) {
      case "session-start":
        return Response.json({ session: await startSession(body.label) });
      case "session-stop":
        return Response.json({ session: await stopSession() });
      case "recording-start":
        return Response.json(startRecording());
      case "recording-stop":
        return Response.json(await stopRecording());
      case "config-save":
        await saveConfig(body.config);
        return Response.json({ ok: true });
      case "config-clear":
        await saveConfig(null);
        return Response.json({ ok: true });
      case "settings-save":
        await saveSettings(body.settings);
        return Response.json({ ok: true });
    }
  } catch (err) {
    return damageErrorResponse(err);
  }
}
