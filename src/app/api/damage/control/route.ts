import type { NextRequest } from "next/server";
import { controlBodySchema } from "@/lib/damage/api-schemas";
import {
  saveConfig,
  saveSettings,
  startCapture,
  startRecording,
  startSession,
  stopCapture,
  stopRecording,
  stopSession,
} from "@/lib/damage/service";
import { damageErrorResponse } from "../errors";

export async function POST(request: NextRequest) {
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
      case "capture-start": {
        // The capture posts back to this same server over loopback.
        const port = process.env.PORT ?? request.nextUrl.port;
        startCapture(`http://127.0.0.1:${port}`);
        return Response.json({ ok: true });
      }
      case "capture-stop":
        stopCapture();
        return Response.json({ ok: true });
    }
  } catch (err) {
    return damageErrorResponse(err);
  }
}
