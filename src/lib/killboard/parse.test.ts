import { describe, expect, it } from "vitest";
import { itemsToPrice, toKillEvent, toProfile, valueEvent } from "./parse";
import { rawEventSchema, rawPlayerSchema, searchResponseSchema } from "./types";

/** Trimmed from a live Europe killboard event (field names and nulls as the API sends them). */
const player = (name: string, extra: Record<string, unknown> = {}) => ({
  Id: `${name}-id-0000000`,
  Name: name,
  GuildName: "Cape Dancers",
  GuildId: "g1",
  AllianceName: "PRESS",
  AllianceId: "a1",
  AllianceTag: "",
  Avatar: "",
  KillFame: 100,
  DeathFame: 50,
  FameRatio: 2,
  AverageItemPower: 1268.744,
  Inventory: [],
  ...extra,
});

const liveEvent = {
  EventId: 462484094,
  TimeStamp: "2026-11-16T11:21:09.786776400Z",
  Version: 4,
  numberOfParticipants: 1,
  groupMemberCount: 1,
  TotalVictimKillFame: 1152,
  Location: null,
  KillArea: "OPEN_WORLD",
  Killer: player("CraftHQ", {
    Equipment: {
      MainHand: { Type: "T4_2H_DOUBLEBLADEDSTAFF_CRYSTAL@4", Count: 1, Quality: 4, ActiveSpells: [], PassiveSpells: [], LegendarySoul: {} },
      OffHand: null,
      Potion: { Type: "T8_POTION_COOLDOWN", Count: 6, Quality: 0 },
    },
  }),
  Victim: player("Hybridomania", {
    AverageItemPower: 1262,
    Equipment: {
      MainHand: { Type: "T4_2H_CLEAVER_HELL@3", Count: 1, Quality: 3 },
      Head: null,
      Food: { Type: "T8_MEAL_STEW@1", Count: 5, Quality: 0 },
    },
    Inventory: [
      { Type: "T1_SILVERBAG_NONTRADABLE", Count: 9, Quality: 0 },
      { Type: "T4_RUNE", Count: 42, Quality: 0 },
      null,
      null,
    ],
  }),
  Participants: [player("CraftHQ", { DamageDone: 1530.0, SupportHealingDone: 0.0 }), player("Helper", { DamageDone: 10, SupportHealingDone: 900 })],
  GroupMembers: [],
  GvGMatch: null,
  Type: "KILL",
};

describe("killboard parsing", () => {
  it("trims a live event to the loadouts, inventory and participants", () => {
    const e = toKillEvent(rawEventSchema.parse(liveEvent));
    expect(e).toMatchObject({ id: 462484094, fame: 1152, area: "OPEN_WORLD", partySize: 2, value: null });
    expect(e.killer).toMatchObject({ name: "CraftHQ", guild: "Cape Dancers", alliance: "PRESS", itemPower: 1269 });
    expect(Object.keys(e.killer.equipment)).toEqual(["MainHand", "Potion"]);
    expect(e.killer.equipment.Potion).toMatchObject({ count: 6, quality: 0 });
    expect(e.victim.equipment.MainHand).toMatchObject({ type: "T4_2H_CLEAVER_HELL@3", quality: 3 });
    expect(e.victim.inventory.map((i) => i.type)).toEqual(["T1_SILVERBAG_NONTRADABLE", "T4_RUNE"]);
    expect(e.participants.map((p) => p.name)).toEqual(["CraftHQ", "Helper"]);
  });

  it("values the victim's losses, skipping non-tradable items and counting unpriced ones", () => {
    const e = toKillEvent(rawEventSchema.parse(liveEvent));
    const prices: Record<string, number> = { "T4_2H_CLEAVER_HELL@3|3": 250_000, "T4_RUNE|1": 120 };
    const value = valueEvent(e, (type, quality) => prices[`${type}|${Math.max(1, quality)}`] ?? null);
    expect(value).toEqual({ equipment: 250_000, inventory: 42 * 120, unpriced: 1 }); // the stew has no price
    expect(itemsToPrice([e]).map((i) => i.type)).toEqual(["T4_2H_CLEAVER_HELL@3", "T8_MEAL_STEW@1", "T4_RUNE"]);
  });

  it("reports no value rather than zero when nothing could be priced", () => {
    const e = toKillEvent(rawEventSchema.parse(liveEvent));
    expect(valueEvent(e, () => null)).toEqual({ equipment: null, inventory: null, unpriced: 3 });
  });

  it("reads lifetime statistics and tolerates missing or null fields", () => {
    const profile = toProfile(
      rawPlayerSchema.parse(
        player("CraftHQ", {
          GuildName: null,
          LifetimeStatistics: {
            PvE: { Total: 230_023_468, Royal: 6_376_180, Avalon: 70_642_418 },
            Gathering: { Fiber: { Total: 12_824 }, All: { Total: 217_695 } },
            Crafting: { Total: 18_887_660 },
            FishingFame: 300,
            Timestamp: null,
          },
        }),
      ),
    );
    expect(profile).toMatchObject({ name: "CraftHQ", guild: "", killFame: 100, fameRatio: 2 });
    expect(profile.lifetime).toMatchObject({
      pve: { total: 230_023_468, royal: 6_376_180, avalon: 70_642_418, hellgate: 0 },
      gathering: { fiber: 12_824, hide: 0, total: 217_695 },
      crafting: 18_887_660,
      fishing: 300,
      farming: 0,
    });
  });

  it("parses the search response", () => {
    const body = searchResponseSchema.parse({ guilds: [], players: [player("Test0", { GuildName: null, KillFame: 0 })] });
    expect(body.players[0]).toMatchObject({ Id: "Test0-id-0000000", Name: "Test0", GuildName: "", KillFame: 0 });
  });
});
