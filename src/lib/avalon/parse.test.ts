import { describe, expect, it } from "vitest";
import {
  buildZone,
  classifyChest,
  classifyDungeonLayer,
  countDungeonMarkers,
  parseClusterInstances,
  parseResources,
  parseTemplateLayers,
  parseWorldRoads,
  tierFromClusterFile,
} from "./parse";

const WORLD = `<world>
  <clusters>
    <cluster id="0000_CTY" file="x.cluster.xml" displayname="Somewhere" enabled="true" type="CITY" />
    <cluster id="TNL-001" file="TNL-001_RDS_RO_AUTO_T4_AVA_AVA.cluster.xml" displayname="Ouyos-Aoeuam" enabled="true" type="TUNNEL_ROYAL">
      <minimapmarkers>
        <marker type="dungeon_group" pos="-161 -296" />
        <marker type="Ore" pos="35 -85" />
      </minimapmarkers>
      <distribution realestates="0">
        <resource name="ORE" tier="6" count="3" />
        <resource name="ORE" tier="4" count="2" />
        <resource name="WOOD" tier="1" count="2" />
      </distribution>
    </cluster>
    <cluster id="TNL-002" file="TNL-002_RDS_RO_AUTO_T6_AVA_AVA.cluster.xml" displayname="Off-Zone" enabled="false" type="TUNNEL_LOW" />
  </clusters>
  <criticalObjects>
    <cluster id="TNL-001"><tunnelexit path="a" /></cluster>
  </criticalObjects>
</world>`;

const CLUSTER = `<cluster>
  <templateinstance id="instanceslot_00" ref="S_ROADS_PVE_RAID_01" pos="0 0 0">
    <activelayer id="Layer_01" />
    <activelayer id="Layer_06" />
  </templateinstance>
  <templateinstance id="instanceslot_01" ref="S_ROADS_DNG_GROUP_Entrance_01" pos="1 0 1">
    <activelayer id="Layer_02" />
  </templateinstance>
  <templateinstance id="instanceslot_02" ref="S_ROADS_Portal_01" pos="2 0 2" />
  <templateinstance id="instanceslot_03" ref="S_ROADS_MISSING" pos="3 0 3">
    <activelayer id="Layer_01" />
  </templateinstance>
</cluster>`;

// Mirrors the real S_ROADS_PVE_RAID_01 shape: self-closing atmosphere layers precede the chest layer.
const RAID_TEMPLATE = `<template>
  <layergroup name="Atmosphere">
    <layer id="Layer_05" name="Atmosphere_T4" activationRule="X_X_T4_X_X_X" />
    <layer id="Layer_06" name="Atmosphere_T6" activationRule="X_X_T6_X_X_X" />
  </layergroup>
  <layergroup name="Encounter">
    <layer id="Layer_01" name="PVE_Raid_T6">
      <tile name="SpawnPoint_LOOTCHEST_SMALL_AVALON_ROAD_ELITE_T6" pos="-19 -8 26" />
      <tile name="SpawnPoint_LOOTCHEST_MEDIUM_AVALON_ROAD_ELITE_T6" pos="1 1 1" />
      <tile name="SpawnPoint_RANDOM_AVALON_ELITE_KNIGHT_T6" pos="0 0 0" />
    </layer>
    <layer id="Layer_02" name="PVE_Raid_T8">
      <tile name="SpawnPoint_LOOTCHEST_SMALL_AVALON_ROAD_ELITE_T8" pos="0 0 0" />
    </layer>
  </layergroup>
</template>`;

const DUNGEON_TEMPLATE = `<template>
  <layer id="Layer_01" name="DNG_Group_T8_KPR"></layer>
  <layer id="Layer_02" name="DNG_Group_T6_HER"><tile name="SpawnPoint_DUNGEON" /></layer>
</template>`;

describe("parseWorldRoads", () => {
  it("returns only TNL clusters from the <clusters> section, handling self-closing tags", () => {
    const zones = parseWorldRoads(WORLD);
    expect(zones.map((z) => z.id)).toEqual(["TNL-001", "TNL-002"]);
    expect(zones[0]).toMatchObject({ name: "Ouyos-Aoeuam", type: "TUNNEL_ROYAL", enabled: true });
    expect(zones[0].body).toContain("dungeon_group");
    expect(zones[1]).toMatchObject({ enabled: false, body: "" });
  });

  it("throws when the clusters section is missing", () => {
    expect(() => parseWorldRoads("<world />")).toThrow();
  });
});

describe("parseTemplateLayers", () => {
  it("does not let a self-closing layer swallow the next layer's chests", () => {
    const layers = parseTemplateLayers(RAID_TEMPLATE);
    expect(layers.get("Layer_06")).toEqual({ name: "Atmosphere_T6", chests: [] });
    expect(layers.get("Layer_01")?.chests).toEqual(["LOOTCHEST_SMALL_AVALON_ROAD_ELITE_T6", "LOOTCHEST_MEDIUM_AVALON_ROAD_ELITE_T6"]);
    expect(layers.get("Layer_02")?.chests).toEqual(["LOOTCHEST_SMALL_AVALON_ROAD_ELITE_T8"]);
  });
});

describe("classifiers", () => {
  it("classifies chest spawns by size, grade and tier", () => {
    expect(classifyChest("LOOTCHEST_SMALL_AVALON_ROAD_T4")).toEqual({ size: "small", grade: "standard", tier: 4 });
    expect(classifyChest("LOOTCHEST_MEDIUM_AVALON_ROAD_VETERAN_T8")).toEqual({ size: "medium", grade: "veteran", tier: 8 });
    expect(classifyChest("LOOTCHEST_SMALL_AVALON_ROAD_ELITE_T6")).toEqual({ size: "small", grade: "elite", tier: 6 });
    expect(classifyChest("LOOTCHEST_SOMETHING_ELSE")).toBeNull();
  });

  it("classifies dungeon entrance layers (names may carry trailing spaces)", () => {
    expect(classifyDungeonLayer("DNG_Solo_T6_KPR")).toEqual({ kind: "solo", tier: 6, faction: "KPR" });
    expect(classifyDungeonLayer("DNG_Group_T4_UND ")).toEqual({ kind: "group", tier: 4, faction: "UND" });
    expect(classifyDungeonLayer("DNG_Raid_T8_AVA")).toEqual({ kind: "avalonian", tier: 8, faction: "AVA" });
    expect(classifyDungeonLayer("PVE_Solo_T4")).toBeNull();
  });

  it("reads the tier from the cluster file name", () => {
    expect(tierFromClusterFile("TNL-001_RDS_RO_AUTO_T4_AVA_AVA.cluster.xml")).toBe(4);
    expect(tierFromClusterFile("weird.xml")).toBeNull();
  });

  it("drops placeholder resources below tier 4 and counts dungeon markers", () => {
    const body = parseWorldRoads(WORLD)[0].body;
    expect(parseResources(body)).toEqual([
      { type: "ORE", tier: 4, count: 2 },
      { type: "ORE", tier: 6, count: 3 },
    ]);
    expect(countDungeonMarkers(body)).toBe(1);
  });
});

describe("buildZone", () => {
  it("counts only chests and dungeons on the layers the zone switches on", () => {
    const world = parseWorldRoads(WORLD)[0];
    const instances = parseClusterInstances(CLUSTER);
    expect(instances.map((i) => i.ref)).toEqual(["S_ROADS_PVE_RAID_01", "S_ROADS_DNG_GROUP_Entrance_01", "S_ROADS_Portal_01", "S_ROADS_MISSING"]);
    expect(instances[2].activeLayers).toEqual([]);

    const templates = new Map([
      ["S_ROADS_PVE_RAID_01", parseTemplateLayers(RAID_TEMPLATE)],
      ["S_ROADS_DNG_GROUP_Entrance_01", parseTemplateLayers(DUNGEON_TEMPLATE)],
      ["S_ROADS_Portal_01", new Map()],
    ]);
    const { zone, missingTemplates, unknownChests } = buildZone(world, instances, templates);

    expect(zone).toMatchObject({ id: "TNL-001", name: "Ouyos-Aoeuam", tier: 4 });
    // Layer_02 of the raid template (T8) is not active, so its chest must not be counted.
    expect(zone.chests).toEqual([
      { size: "medium", grade: "elite", tier: 6, count: 1 },
      { size: "small", grade: "elite", tier: 6, count: 1 },
    ]);
    expect(zone.dungeons).toEqual([{ kind: "group", tier: 6, faction: "HER", count: 1 }]);
    expect(missingTemplates).toEqual(["S_ROADS_MISSING"]);
    expect(unknownChests).toEqual([]);
  });
});
