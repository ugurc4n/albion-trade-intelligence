/**
 * Local pipeline check WITHOUT the game: posts a SYNTHETIC fight (src/test/damage-scenario.ts) to
 * /api/damage/ingest the same way tools/albion-capture does. Only for testing the app — the data is fake
 * and the codes are invented, so do not keep a calibration made from it.
 *
 * Usage: npm run damage:simulate -- [appUrl] [seed]
 */
import { buildScenario } from "../src/test/damage-scenario";

async function main() {
  const app = (process.argv[2] ?? "http://localhost:3100").replace(/\/$/, "");
  const seed = Number(process.argv[3] ?? 7);
  const { packets, expected, unattributed } = buildScenario({ seed, hits: 120 });
  const now = Date.now();
  const raw = packets.map((p, i) => ({ t: now + i * 50, d: Buffer.from(p).toString("base64") }));
  for (let i = 0; i < raw.length; i += 200) {
    const res = await fetch(`${app}/api/damage/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packets: raw.slice(i, i + 200) }),
    });
    if (!res.ok) throw new Error(`ingest failed: HTTP ${res.status} ${await res.text()}`);
  }
  console.log(`Sent ${raw.length} synthetic packets. Expected totals:`);
  console.table(expected);
  console.log(`Unattributed: ${unattributed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
