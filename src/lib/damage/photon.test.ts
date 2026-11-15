import { describe, expect, it } from "vitest";
import { eventMessage, f, fragments, i, l, packet, reliable, responseMessage, s, unreliable } from "@/test/photon-encoder";
import { messageSignature, PhotonDecoder } from "./photon";
import { Reader } from "./protocol18";

describe("Protocol18 reader", () => {
  it("reads little-endian scalars, zigzag varints, strings and typed arrays", () => {
    const msg = eventMessage(6, {
      0: i(4242),
      1: l(638_000_000_000_000_000),
      2: f(-123.5),
      3: s("Çağrı"),
      5: { t: "y", el: "f", v: [1.5, -2] },
      6: { t: "o", v: true },
      7: i(-82045),
    });
    const r = new Reader(msg.subarray(3));
    const { params, types } = r.paramTable();
    expect(params.get(0)).toBe(4242);
    expect(params.get(1)).toBe(638_000_000_000_000_000);
    expect(params.get(2)).toBe(-123.5);
    expect(params.get(3)).toBe("Çağrı");
    expect(params.get(5)).toEqual([1.5, -2]);
    expect(params.get(6)).toBe(true);
    expect(params.get(7)).toBe(-82045);
    expect(params.get(252)).toBe(6);
    expect(types.get(2)).toBe("f");
    expect(types.get(5)).toBe("y:f");
    expect(types.get(1)).toBe("l");
    expect(r.remaining).toBe(0);
  });
});

describe("PhotonDecoder", () => {
  it("decodes reliable and unreliable events with the Albion code from parameter 252", () => {
    const d = new PhotonDecoder();
    const msgs = d.decodePacket(
      packet([reliable(eventMessage(6, { 0: i(10), 2: f(-50) })), unreliable(eventMessage(3, { 0: i(10) }))]),
      1000,
    );
    expect(msgs.map(messageSignature)).toEqual(["event:6", "event:3"]);
    expect(msgs[0].params.get(2)).toBe(-50);
    expect(msgs[0].at).toBe(1000);
    expect(d.stats).toMatchObject({ packets: 1, messages: 2, errors: 0 });
  });

  it("decodes operation responses with the code from parameter 253", () => {
    const d = new PhotonDecoder();
    const [m] = d.decodePacket(packet([reliable(responseMessage(2, { 0: i(77), 2: s("Ugur") }))]), 0);
    expect(m).toMatchObject({ kind: "response", code: 2 });
    expect(m.params.get(2)).toBe("Ugur");
  });

  it("reassembles fragmented messages across packets, in any order", () => {
    const big = eventMessage(29, { 0: i(5), 1: s("x".repeat(500)) });
    const parts = fragments(big, 200);
    expect(parts).toHaveLength(3);
    const d = new PhotonDecoder();
    expect(d.decodePacket(packet([parts[2]]), 0)).toEqual([]);
    expect(d.decodePacket(packet([parts[0]]), 0)).toEqual([]);
    const [m] = d.decodePacket(packet([parts[1]]), 0);
    expect(m.code).toBe(29);
    expect(m.params.get(1)).toBe("x".repeat(500));
  });

  it("counts malformed and encrypted packets instead of throwing", () => {
    const d = new PhotonDecoder();
    expect(d.decodePacket(Uint8Array.from([1, 2, 3]), 0)).toEqual([]);
    const encrypted = eventMessage(6, { 0: i(1) });
    encrypted[1] = 0x84;
    expect(d.decodePacket(packet([reliable(encrypted)]), 0)).toEqual([]);
    const truncated = packet([reliable(eventMessage(6, { 0: i(1) }))]).subarray(0, 30); // command header says more data than the packet holds
    expect(d.decodePacket(truncated, 0)).toEqual([]);
    expect(d.stats.errors).toBe(2);
    expect(d.stats.encrypted).toBe(1);
  });
});

describe("real Albion traffic (regression)", () => {
  // A "Move" event captured from the live game (Protocol18): object id as compressed long + 30-byte position blob.
  const MOVE_EVENT = Uint8Array.from(
    "f3 04 03 02 00 0a fa 81 0a 01 43 1e 03 0b 95 22 d4 0f 43 df 08 d5 df 53 66 05 56 57 6f aa cd cc 0c 41 ca 13 93 66 55 4d 2f 6f"
      .split(" ")
      .map((h) => parseInt(h, 16)),
  );

  it("decodes a captured Protocol18 event", () => {
    const [m] = new PhotonDecoder().decodePacket(packet([reliable(MOVE_EVENT)]), 0);
    expect(m).toMatchObject({ kind: "event", code: 3 });
    expect(m.params.get(0)).toBe(82045);
    expect(m.types.get(0)).toBe("l");
    expect((m.params.get(1) as Uint8Array).length).toBe(30);
    expect(m.types.get(1)).toBe("x");
  });
});

describe("Protocol18 nested arrays (captured)", () => {
  it("reads an array of arrays where each element has its own type byte", () => {
    // key 4: Array(0x40) of 2 elements: CompressedIntArray [15] and CompressedIntArray [] — then key 252 (short 155).
    const bytes = Uint8Array.from([0x02, 0x04, 0x40, 0x02, 0x49, 0x01, 0x1e, 0x49, 0x00, 0xfc, 0x04, 0x9b, 0x00]);
    const { params } = new Reader(bytes).paramTable();
    expect(params.get(4)).toEqual([[15], []]);
    expect(params.get(252)).toBe(155);
  });
});
