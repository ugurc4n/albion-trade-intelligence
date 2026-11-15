import { z } from "zod";
import { damageConfigSchema, damageSettingsSchema } from "./types";

export const ingestBodySchema = z.object({
  packets: z
    .array(z.object({ t: z.number().int().nonnegative(), d: z.string().min(1).max(8192) }))
    .max(5000),
});

export const controlBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("session-start"), label: z.string().max(80).default("") }),
  z.object({ action: z.literal("session-stop") }),
  z.object({ action: z.literal("recording-start") }),
  z.object({ action: z.literal("recording-stop") }),
  z.object({ action: z.literal("config-save"), config: damageConfigSchema }),
  z.object({ action: z.literal("config-clear") }),
  z.object({ action: z.literal("settings-save"), settings: damageSettingsSchema }),
]);

export const calibrateBodySchema = z.object({
  /** Empty = detect character names automatically. */
  names: z.array(z.string().trim().min(1).max(40)).max(20),
});

export type ControlBody = z.input<typeof controlBodySchema>;
